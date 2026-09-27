/**
 * Durable generation jobs (Phase 1 — Foundation).
 *
 * Provider-agnostic, resumable job records backed by the `generation_jobs`
 * and `provider_tasks` tables (pinned contract, migration
 * 20260928020200_p1_operations.sql). Distinct from `video_jobs` (the
 * browser-polled quick-generate pipeline) and `renders` (the server-FFmpeg
 * render queue): those keep their own lifecycles; the durable tables ride
 * alongside them for checkpoint/resume, idempotency keys, and per-job cost
 * tracking across Text/Image/Video/TTS providers.
 *
 * SERVER-ONLY. This module never imports the service-role client itself —
 * callers pass the client in (see src/lib/credits.ts for the pattern), so
 * nothing here can leak into a client bundle. The `failGenerationJob`
 * refund path expects the service-role client (server-side bookkeeping).
 *
 * The generated `Database` type (src/integrations/supabase/types.ts) is
 * refreshed separately from the Lovable cloud DB and does not yet include
 * the Phase 1 tables, so this module declares the pinned table shapes
 * locally and extends the schema type. If the generated types later gain
 * these tables, the local definitions shadow them (Omit) and stay
 * consistent as long as the pinned contract is unchanged.
 *
 * STATE MACHINE (generation_jobs.status):
 *
 *   queued ──claimGenerationJob──▶ running ──saveCheckpoint──▶ checkpointed
 *     │                              │                              │
 *     │                              │ completeGenerationJob        │ resumeGenerationJob
 *     │                              ▼                              ▼
 *     │                          completed ◀────────────────── queued (resume)
 *     │                              │
 *     └──── failGenerationJob ──▶ failed ──resumeGenerationJob──▶ queued
 *                                    (only when attempt_count < max_attempts)
 *
 * `completed` is terminal. `failed` is re-queueable via an explicit resume.
 * Every transition is a single conditional UPDATE … WHERE … RETURNING, so
 * concurrent workers race safely: exactly one UPDATE matches.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { refundMinutesForJob } from "../credits";

/** Job lifecycle states written by this module (no CHECK in the migration). */
export type GenerationJobStatus = "queued" | "running" | "checkpointed" | "completed" | "failed";

/** Provider-attempt lifecycle. Derived when the caller omits `status`. */
export type ProviderTaskStatus =
  "pending" | "submitted" | "running" | "succeeded" | "failed" | "cancelled";

/** Row shape mirroring the pinned `generation_jobs` contract. */
export type GenerationJobRow = {
  id: string;
  user_id: string;
  workspace_id: string | null;
  project_id: string | null;
  job_type: string;
  status: GenerationJobStatus;
  idempotency_key: string | null;
  attempt_count: number;
  max_attempts: number;
  checkpoint: Json;
  cost_estimate_credits: number | null;
  cost_actual_credits: number | null;
  provider: string | null;
  model: string | null;
  provider_task_id: string | null;
  error: Json | null;
  created_at: string;
  updated_at: string;
};

export type GenerationJobInsert = {
  user_id: string;
  workspace_id?: string | null;
  project_id?: string | null;
  job_type: string;
  status?: GenerationJobStatus;
  idempotency_key?: string | null;
  attempt_count?: number;
  max_attempts?: number;
  checkpoint?: Json;
  cost_estimate_credits?: number | null;
  cost_actual_credits?: number | null;
  provider?: string | null;
  model?: string | null;
  provider_task_id?: string | null;
  error?: Json | null;
};

export type GenerationJobUpdate = {
  status?: GenerationJobStatus;
  attempt_count?: number;
  checkpoint?: Json;
  cost_estimate_credits?: number | null;
  cost_actual_credits?: number | null;
  provider?: string | null;
  model?: string | null;
  provider_task_id?: string | null;
  error?: Json | null;
};

/** Row shape mirroring the pinned `provider_tasks` contract. */
export type ProviderTaskRow = {
  id: string;
  job_id: string;
  provider: string;
  model: string | null;
  provider_task_id: string | null;
  status: ProviderTaskStatus;
  attempt: number;
  latency_ms: number | null;
  cost_estimate: number | null;
  cost_actual: number | null;
  usage: Json;
  output_ref: string | null;
  error: Json | null;
  created_at: string;
  updated_at: string;
};

export type ProviderTaskInsert = {
  job_id: string;
  provider: string;
  model?: string | null;
  provider_task_id?: string | null;
  status?: ProviderTaskStatus;
  attempt?: number;
  latency_ms?: number | null;
  cost_estimate?: number | null;
  cost_actual?: number | null;
  usage?: Json;
  output_ref?: string | null;
  error?: Json | null;
};

export type ProviderTaskUpdate = {
  model?: string | null;
  provider_task_id?: string | null;
  status?: ProviderTaskStatus;
  latency_ms?: number | null;
  cost_estimate?: number | null;
  cost_actual?: number | null;
  usage?: Json;
  output_ref?: string | null;
  error?: Json | null;
};

type DurableJobsTables = {
  generation_jobs: {
    Row: GenerationJobRow;
    Insert: GenerationJobInsert;
    Update: GenerationJobUpdate;
    Relationships: [];
  };
  provider_tasks: {
    Row: ProviderTaskRow;
    Insert: ProviderTaskInsert;
    Update: ProviderTaskUpdate;
    Relationships: [];
  };
};

/** `Database` extended with the durable-jobs tables (see module docstring). */
export type DurableJobsDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Omit<Database["public"]["Tables"], keyof DurableJobsTables> & DurableJobsTables;
  };
};

type JobsClient = SupabaseClient<DurableJobsDatabase>;

/**
 * Narrow a standard client to the durable-jobs schema. The cast is contained
 * here so every function below can use fully-typed query builders while
 * callers keep passing their ordinary `SupabaseClient<Database>`.
 */
function asJobsClient(client: SupabaseClient<Database>): JobsClient {
  return client as unknown as JobsClient;
}

function toError(error: { message: string; code?: string }): never {
  const err = new Error(error.message) as Error & { code?: string };
  if (error.code) err.code = error.code;
  throw err;
}

/** Recursive plain-object merge for checkpoint JSON (arrays replace). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function deepMergeCheckpoint(base: Json, patch: Json): Json {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const existing = (base as Record<string, unknown>)[key];
    out[key] =
      isPlainObject(existing) && isPlainObject(value)
        ? deepMergeCheckpoint(existing as Json, value as Json)
        : (value as unknown);
  }
  return out as Json;
}

/** Checkpoint namespace recording which worker holds the current claim. */
const CLAIM_KEY = "__claim";

export interface CreateGenerationJobParams {
  userId: string;
  workspaceId?: string | null;
  projectId?: string | null;
  jobType: string;
  /** Client-generated key; a retry with the same key returns the existing job. */
  idempotencyKey?: string | null;
  maxAttempts?: number;
  /** ESTIMATE in credits, set at creation before any provider spend. */
  costEstimateCredits?: number | null;
  provider?: string | null;
  model?: string | null;
}

/**
 * Insert a durable generation job. Duplicate `idempotency_key` returns the
 * existing row — no double-create. The pre-select handles the common retry
 * case; the 23505 fallback handles two creators racing past the pre-select.
 * A 23505 for a key owned by a *different* user is a conflict, never a
 * cross-user row return.
 */
export async function createGenerationJob(
  client: SupabaseClient<Database>,
  params: CreateGenerationJobParams,
): Promise<GenerationJobRow> {
  const db = asJobsClient(client);
  const key = params.idempotencyKey ?? null;

  const findByKey = async (): Promise<GenerationJobRow | null> => {
    if (!key) return null;
    const { data, error } = await db
      .from("generation_jobs")
      .select("*")
      .eq("user_id", params.userId)
      .eq("idempotency_key", key)
      .maybeSingle();
    if (error) toError(error);
    return data;
  };

  const existing = await findByKey();
  if (existing) return existing;

  const insert: GenerationJobInsert = {
    user_id: params.userId,
    workspace_id: params.workspaceId ?? null,
    project_id: params.projectId ?? null,
    job_type: params.jobType,
    status: "queued",
    idempotency_key: key,
    attempt_count: 0,
    max_attempts: params.maxAttempts ?? 3,
    checkpoint: {},
    cost_estimate_credits: params.costEstimateCredits ?? null,
    provider: params.provider ?? null,
    model: params.model ?? null,
  };

  const { data, error } = await db.from("generation_jobs").insert(insert).select().single();
  if (!error) return data;

  // Lost the insert race with the same idempotency key: return the winner's
  // row instead of failing. Anything else is a real error.
  if (error.code === "23505" && key) {
    const raced = await db
      .from("generation_jobs")
      .select("*")
      .eq("idempotency_key", key)
      .maybeSingle();
    if (raced.error) toError(raced.error);
    if (raced.data) {
      if (raced.data.user_id !== params.userId) {
        throw new Error("Idempotency key conflict: already used by another user.");
      }
      return raced.data;
    }
  }
  toError(error);
}

/**
 * Atomically claim a queued job: `queued → running` with an attempt-count
 * increment, guarded on `attempt_count < max_attempts`.
 *
 * Two-phase but race-safe: the pre-read supplies the increment value, and
 * the single conditional UPDATE (`status='queued'` AND
 * `attempt_count=<read value>`) is the atomic gate — a racing worker's
 * UPDATE re-evaluates the WHERE after the winner commits and matches zero
 * rows. Returns the claimed row for the winner, null for losers, for jobs
 * that are not queued, and when the attempt budget is exhausted.
 *
 * `workerId` is recorded in `checkpoint.__claim` (the table has no
 * worker column and migrations are out of scope) so the current holder is
 * observable for debugging and lease/reap logic.
 */
export async function claimGenerationJob(
  client: SupabaseClient<Database>,
  jobId: string,
  workerId: string,
): Promise<GenerationJobRow | null> {
  const db = asJobsClient(client);

  const { data: current, error: readError } = await db
    .from("generation_jobs")
    .select("id,status,attempt_count,max_attempts,checkpoint")
    .eq("id", jobId)
    .maybeSingle();
  if (readError) toError(readError);
  if (!current) return null;
  if (current.status !== "queued") return null;
  if (current.attempt_count >= current.max_attempts) return null;

  const claimedCheckpoint = deepMergeCheckpoint(current.checkpoint, {
    [CLAIM_KEY]: {
      worker_id: workerId,
      claimed_at: new Date().toISOString(),
      attempt: current.attempt_count + 1,
    },
  });

  const { data, error } = await db
    .from("generation_jobs")
    .update({
      status: "running",
      attempt_count: current.attempt_count + 1,
      checkpoint: claimedCheckpoint,
    })
    .eq("id", jobId)
    .eq("status", "queued")
    .eq("attempt_count", current.attempt_count)
    .select()
    .maybeSingle();
  if (error) toError(error);
  return data;
}

/**
 * Merge checkpoint state into a running (or already checkpointed) job and
 * move it to `checkpointed`. The merge is deep for plain objects so a stage
 * can update its own subtree without clobbering sibling stages. Returns the
 * updated row, or null when the job is not in a checkpointable state.
 */
export async function saveCheckpoint(
  client: SupabaseClient<Database>,
  jobId: string,
  checkpointJson: Json,
): Promise<GenerationJobRow | null> {
  const db = asJobsClient(client);

  const { data: current, error: readError } = await db
    .from("generation_jobs")
    .select("id,status,checkpoint")
    .eq("id", jobId)
    .maybeSingle();
  if (readError) toError(readError);
  if (!current) return null;
  if (current.status !== "running" && current.status !== "checkpointed") {
    return null;
  }

  const merged = deepMergeCheckpoint(current.checkpoint, checkpointJson);

  const { data, error } = await db
    .from("generation_jobs")
    .update({ checkpoint: merged, status: "checkpointed" })
    .eq("id", jobId)
    .in("status", ["running", "checkpointed"])
    .select()
    .maybeSingle();
  if (error) toError(error);
  return data;
}

export interface ResumeResult {
  job: GenerationJobRow;
  /** The stored checkpoint so the worker resumes from the first valid incomplete stage. */
  checkpoint: Json;
}

/**
 * Re-queue a `checkpointed` job, or a `failed` job whose attempt budget is
 * not exhausted (`attempt_count < max_attempts`). Returns the job plus its
 * stored checkpoint, or null when the job is not resumable (running,
 * completed, failed-with-no-attempts-left, or lost a resume race).
 */
export async function resumeGenerationJob(
  client: SupabaseClient<Database>,
  jobId: string,
): Promise<ResumeResult | null> {
  const db = asJobsClient(client);

  const { data: current, error: readError } = await db
    .from("generation_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (readError) toError(readError);
  if (!current) return null;

  const resumable =
    current.status === "checkpointed" ||
    (current.status === "failed" && current.attempt_count < current.max_attempts);
  if (!resumable) return null;

  const { data, error } = await db
    .from("generation_jobs")
    .update({ status: "queued" })
    .eq("id", jobId)
    .eq("status", current.status)
    // For a failed job the attempts guard must still hold at write time.
    .lt("attempt_count", current.max_attempts)
    .select()
    .maybeSingle();
  if (error) toError(error);
  if (!data) return null;
  return { job: data, checkpoint: data.checkpoint };
}

/**
 * Terminal transition to `completed`. `cost_actual_credits` is accumulated
 * from `provider_tasks.cost_actual` (the measured provider spend) plus any
 * explicit `costActualCredits` for costs not recorded as provider tasks
 * (e.g. fixed platform fees). Never re-completes an already terminal job:
 * returns null when the conditional UPDATE matches nothing.
 */
export async function completeGenerationJob(
  client: SupabaseClient<Database>,
  jobId: string,
  params: { costActualCredits?: number | null } = {},
): Promise<GenerationJobRow | null> {
  const db = asJobsClient(client);

  const { data: tasks, error: tasksError } = await db
    .from("provider_tasks")
    .select("cost_actual")
    .eq("job_id", jobId);
  if (tasksError) toError(tasksError);

  const measured = (tasks ?? []).reduce(
    (sum, t) => sum + (typeof t.cost_actual === "number" ? t.cost_actual : 0),
    0,
  );
  const actual =
    measured + (typeof params.costActualCredits === "number" ? params.costActualCredits : 0);

  const { data, error } = await db
    .from("generation_jobs")
    .update({ status: "completed", cost_actual_credits: actual })
    .eq("id", jobId)
    .in("status", ["queued", "running", "checkpointed"])
    .select()
    .maybeSingle();
  if (error) toError(error);
  return data;
}

/**
 * Terminal transition to `failed`, storing the error payload. When a credit
 * debit preceded the failure (ledger row with this job as ref), the debited
 * amount is refunded via `refundMinutesForJob` — the RPC is idempotent per
 * ref and never mints credits (no-op when nothing was debited), so the
 * refund is unconditional and safe. Refund failures never mask the failure
 * marking: they are swallowed, mirroring `refundDebitedMinutes`.
 *
 * Call with the service-role client (server-side bookkeeping).
 */
export async function failGenerationJob(
  client: SupabaseClient<Database>,
  jobId: string,
  errorJson: Json,
): Promise<GenerationJobRow | null> {
  const db = asJobsClient(client);

  const { data, error } = await db
    .from("generation_jobs")
    .update({ status: "failed", error: errorJson })
    .eq("id", jobId)
    .in("status", ["queued", "running", "checkpointed"])
    .select()
    .maybeSingle();
  if (error) toError(error);
  if (!data) return null;

  // Refund whatever this job was actually charged. The RPC caps the refund
  // at the real debited amount for this ref and no-ops when there was no
  // debit, so this can never mint credits.
  try {
    const cap = Math.max(
      1,
      Math.ceil(Number(data.cost_actual_credits ?? data.cost_estimate_credits ?? 1) || 1),
    );
    await refundMinutesForJob(
      client,
      data.user_id,
      jobId,
      cap,
      `Refund: failed generation job ${jobId}`,
    );
  } catch {
    // The job is already marked failed; never fail the call on refund issues.
  }
  return data;
}

export interface RecordProviderTaskParams {
  jobId: string;
  provider: string;
  model?: string | null;
  /** External provider-side task/run id — persisted so an interrupted job can poll/resume instead of re-paying. */
  providerTaskId?: string | null;
  /** 1-based attempt number for this (job, provider) pair. */
  attempt?: number;
  status?: ProviderTaskStatus;
  latencyMs?: number | null;
  costEstimate?: number | null;
  costActual?: number | null;
  usage?: Json | null;
  outputRef?: string | null;
  error?: Json | null;
}

/**
 * Upsert a provider attempt record keyed by (job_id, provider, attempt).
 * The migration has no UNIQUE constraint on that key (no migrations allowed
 * here), so the upsert is emulated: UPDATE first, INSERT when nothing
 * matched. A single worker recording its own attempt never races itself,
 * which is the only writer this path has.
 *
 * When `status` is omitted it is derived honestly from what is known:
 * error → failed, output_ref → succeeded, provider_task_id → submitted,
 * otherwise pending. An unknown provider task id is never reported as
 * succeeded — the status reflects reality.
 */
export async function recordProviderTask(
  client: SupabaseClient<Database>,
  params: RecordProviderTaskParams,
): Promise<ProviderTaskRow> {
  const db = asJobsClient(client);
  const attempt = params.attempt ?? 1;
  const status: ProviderTaskStatus =
    params.status ??
    (params.error
      ? "failed"
      : params.outputRef
        ? "succeeded"
        : params.providerTaskId
          ? "submitted"
          : "pending");

  const patch: ProviderTaskUpdate = {
    model: params.model ?? null,
    provider_task_id: params.providerTaskId ?? null,
    status,
    latency_ms: params.latencyMs ?? null,
    cost_estimate: params.costEstimate ?? null,
    cost_actual: params.costActual ?? null,
    usage: params.usage ?? {},
    output_ref: params.outputRef ?? null,
    error: params.error ?? null,
  };

  const { data: updated, error: updateError } = await db
    .from("provider_tasks")
    .update(patch)
    .eq("job_id", params.jobId)
    .eq("provider", params.provider)
    .eq("attempt", attempt)
    .select()
    .maybeSingle();
  if (updateError) toError(updateError);
  if (updated) return updated;

  const insert: ProviderTaskInsert = {
    job_id: params.jobId,
    provider: params.provider,
    attempt,
    ...patch,
  };
  const { data, error } = await db.from("provider_tasks").insert(insert).select().single();
  if (error) toError(error);
  return data;
}

export interface JobCostSummary {
  jobId: string;
  status: GenerationJobStatus;
  /** ESTIMATE set at creation — the number shown before spend, not a measurement. */
  estimateCredits: number | null;
  /** Live sum of provider_tasks.cost_actual — measured provider spend so far. */
  actualCreditsLive: number;
  /** Finalized cost written by completeGenerationJob (null until completed). */
  finalizedActualCredits: number | null;
  /** actual − estimate when an estimate exists (negative = under budget). */
  overrunCredits: number | null;
  taskCount: number;
}

/**
 * Per-job cost tracking: estimate (set at creation) vs actual (accumulated
 * from provider_tasks). The live actual is a real-time sum; the finalized
 * actual is only written on completion.
 */
export async function getJobCostSummary(
  client: SupabaseClient<Database>,
  jobId: string,
): Promise<JobCostSummary | null> {
  const db = asJobsClient(client);

  const { data: job, error: jobError } = await db
    .from("generation_jobs")
    .select("id,status,cost_estimate_credits,cost_actual_credits")
    .eq("id", jobId)
    .maybeSingle();
  if (jobError) toError(jobError);
  if (!job) return null;

  const { data: tasks, error: tasksError } = await db
    .from("provider_tasks")
    .select("cost_actual")
    .eq("job_id", jobId);
  if (tasksError) toError(tasksError);

  const actual = (tasks ?? []).reduce(
    (sum, t) => sum + (typeof t.cost_actual === "number" ? t.cost_actual : 0),
    0,
  );
  const estimate = typeof job.cost_estimate_credits === "number" ? job.cost_estimate_credits : null;

  return {
    jobId: job.id,
    status: job.status,
    estimateCredits: estimate,
    actualCreditsLive: actual,
    finalizedActualCredits:
      typeof job.cost_actual_credits === "number" ? job.cost_actual_credits : null,
    overrunCredits: estimate === null ? null : actual - estimate,
    taskCount: (tasks ?? []).length,
  };
}
