/**
 * Sprint 1: MEASURED cost queries for the /admin panel.
 *
 * These turn the raw api_usage rows (written by recordApiCost on every
 * provider call) into the two investor-facing numbers:
 *   - cost per finished minute, per billing mode ("story" | "cinema")
 *   - plan margins: plan price vs the measured provider cost of its credits
 *
 * Window: trailing 30 days. Everything returns null (never NaN, never a
 * fabricated number) when there isn't enough measured data.
 *
 * Mode attribution: api_usage rows carry meta.mode from the pipeline that
 * incurred them ("story" default). Finished minutes come from video_jobs
 * (always story) plus renders.billed_minutes, attributed by the render's
 * meta.mode (written at enqueue time, default "story").
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { RENDER_COST_OPERATIONS } from "../api-cost";

export type BillingMode = "story" | "cinema";

export const MEASURED_WINDOW_DAYS = 30;

export interface MeasuredCostPerMinute {
  mode: BillingMode;
  windowDays: number;
  /** Sum of api_usage.estimated_cost for render-pipeline operations. */
  totalCostUsd: number;
  /** Finished minutes of completed output in the window. */
  finishedMinutes: number;
  /** totalCostUsd / finishedMinutes; null when nothing finished. */
  costPerMinuteUsd: number | null;
  costRows: number;
  jobsCounted: number;
}

export interface PlanMargin {
  slug: string;
  name: string;
  kind: string;
  priceUsd: number | null;
  creditsGranted: number;
  /** Measured provider cost of the plan's credits; null when unmeasurable. */
  estCostUsd: number | null;
  marginUsd: number | null;
  marginPct: number | null;
}

export interface PlanMargins {
  windowDays: number;
  /** Measured USD per credit consumed; null when nothing was consumed. */
  costPerCreditUsd: number | null;
  creditsConsumed: number;
  providerCostUsd: number;
  plans: PlanMargin[];
}

type Admin = SupabaseClient<Database>;

function windowStart(): string {
  return new Date(Date.now() - MEASURED_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function rowMode(meta: unknown): BillingMode {
  const m = (meta as { mode?: unknown } | null)?.mode;
  return m === "cinema" ? "cinema" : "story";
}

/** Measured provider cost per finished minute for one billing mode. */
export async function measuredCostPerMinute(
  admin: Admin,
  mode: BillingMode,
): Promise<MeasuredCostPerMinute> {
  const since = windowStart();

  // Costs: every render-pipeline api_usage row in the window.
  const { data: costRows, error: costError } = await admin
    .from("api_usage")
    .select("estimated_cost, meta")
    .gte("created_at", since)
    .in("operation", [...RENDER_COST_OPERATIONS]);
  if (costError) throw new Error(costError.message);

  let totalCostUsd = 0;
  let rows = 0;
  for (const r of costRows ?? []) {
    if (rowMode(r.meta) !== mode) continue;
    totalCostUsd += Number(r.estimated_cost ?? 0);
    rows++;
  }

  // Finished minutes, story side: quick-generate video_jobs.
  let finishedMinutes = 0;
  let jobsCounted = 0;
  if (mode === "story") {
    const { data: jobs, error: jobsError } = await admin
      .from("video_jobs")
      .select("duration_seconds")
      .eq("status", "completed")
      .gte("created_at", since);
    if (jobsError) throw new Error(jobsError.message);
    for (const j of jobs ?? []) {
      finishedMinutes += Number(j.duration_seconds ?? 0) / 60;
      jobsCounted++;
    }
  }

  // Finished minutes: server renders settled to actual (billed_minutes).
  const { data: renders, error: rendersError } = await admin
    .from("renders")
    .select("billed_minutes, meta")
    .eq("engine", "server_ffmpeg")
    .not("billed_minutes", "is", null)
    .gte("render_completed_at", since);
  if (rendersError) throw new Error(rendersError.message);
  for (const r of renders ?? []) {
    if (rowMode(r.meta) !== mode) continue;
    finishedMinutes += Number(r.billed_minutes ?? 0);
    jobsCounted++;
  }

  return {
    mode,
    windowDays: MEASURED_WINDOW_DAYS,
    totalCostUsd: Math.round(totalCostUsd * 10000) / 10000,
    finishedMinutes: Math.round(finishedMinutes * 100) / 100,
    costPerMinuteUsd:
      finishedMinutes > 0 ? Math.round((totalCostUsd / finishedMinutes) * 10000) / 10000 : null,
    costRows: rows,
    jobsCounted,
  };
}

/** Plan price vs measured provider cost per plan. */
export async function planMargins(admin: Admin): Promise<PlanMargins> {
  const since = windowStart();

  const [{ data: plans, error: plansError }, { data: costs, error: costsError }, { data: ledger, error: ledgerError }] =
    await Promise.all([
      admin
        .from("plans")
        .select("slug, name, kind, credits_granted, price_usd_cents")
        .eq("active", true)
        .order("price_usd_cents", { ascending: true }),
      admin
        .from("api_usage")
        .select("estimated_cost")
        .gte("created_at", since)
        .in("operation", [...RENDER_COST_OPERATIONS]),
      // Net render credits consumed: debits AND settle/refund grants, so the
      // reserve->actual settlement nets to the true finished minutes.
      admin
        .from("credit_ledger")
        .select("delta, reason")
        .gte("created_at", since)
        .ilike("reason", "%render%"),
    ]);
  if (plansError) throw new Error(plansError.message);
  if (costsError) throw new Error(costsError.message);
  if (ledgerError) throw new Error(ledgerError.message);

  const providerCostUsd = (costs ?? []).reduce((s, r) => s + Number(r.estimated_cost ?? 0), 0);
  // delta < 0 are debits; delta > 0 are refunds/grants. Net consumed = -sum.
  const creditsConsumed = -(ledger ?? []).reduce((s, r) => s + Number(r.delta ?? 0), 0);

  const costPerCreditUsd = creditsConsumed > 0 ? providerCostUsd / creditsConsumed : null;

  const planList: PlanMargin[] = (plans ?? []).map((p) => {
    const priceUsd = p.price_usd_cents == null ? null : p.price_usd_cents / 100;
    const creditsGranted = Number(p.credits_granted ?? 0);
    const estCostUsd = costPerCreditUsd == null ? null : creditsGranted * costPerCreditUsd;
    const marginUsd = priceUsd == null || estCostUsd == null ? null : priceUsd - estCostUsd;
    const marginPct =
      marginUsd == null || priceUsd == null || priceUsd === 0 ? null : marginUsd / priceUsd;
    return {
      slug: p.slug,
      name: p.name,
      kind: p.kind ?? "unknown",
      priceUsd,
      creditsGranted,
      estCostUsd: estCostUsd == null ? null : Math.round(estCostUsd * 100) / 100,
      marginUsd: marginUsd == null ? null : Math.round(marginUsd * 100) / 100,
      marginPct: marginPct == null ? null : Math.round(marginPct * 10000) / 10000,
    };
  });

  return {
    windowDays: MEASURED_WINDOW_DAYS,
    costPerCreditUsd:
      costPerCreditUsd == null ? null : Math.round(costPerCreditUsd * 100000) / 100000,
    creditsConsumed: Math.round(creditsConsumed * 100) / 100 + 0, // +0 normalizes -0
    providerCostUsd: Math.round(providerCostUsd * 10000) / 10000,
    plans: planList,
  };
}
