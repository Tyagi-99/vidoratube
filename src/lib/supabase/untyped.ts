/**
 * Phase 4 Stream E — structural (untyped) Supabase server client.
 *
 * SERVER-ONLY. The generated `Database` types are stale for newer tables
 * (api_keys, brand_assets, workspace_invites, …), so server code that
 * touches them goes through this minimal structural surface instead of
 * `SupabaseClient<Database>`. The runtime object is the real
 * `supabaseAdmin` client; the interface only narrows what TypeScript sees.
 *
 * Keep this surface minimal: add a method only when a server function
 * genuinely needs it.
 */
export interface UntypedQueryResult {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
}

export interface UntypedSingleResult {
  data: Record<string, unknown> | null;
  error: { message: string } | null;
}

export interface UntypedQuery extends PromiseLike<UntypedQueryResult> {
  select(cols?: string): UntypedQuery;
  eq(col: string, val: unknown): UntypedQuery;
  neq(col: string, val: unknown): UntypedQuery;
  gt(col: string, val: unknown): UntypedQuery;
  ilike(col: string, pattern: string): UntypedQuery;
  is(col: string, val: null): UntypedQuery;
  order(col: string, opts?: { ascending?: boolean }): UntypedQuery;
  limit(n: number): UntypedQuery;
  maybeSingle(): Promise<UntypedSingleResult>;
  single(): Promise<{
    data: Record<string, unknown>;
    error: { message: string } | null;
  }>;
}

export interface UntypedTable {
  select(cols?: string): UntypedQuery;
  /**
   * Insert builder — thenable like the real supabase-js client, so both
   * `await .insert(row)` and `.insert(row).select().single()` execute.
   */
  insert(row: Record<string, unknown>): UntypedQuery;
  /**
   * Upsert builder — thenable like the real supabase-js client, so both
   * `await .upsert(row, { onConflict })` and `.upsert(...).select().single()`
   * execute. (Phase 6 Stream B: onboarding progress upserts by user_id.)
   */
  upsert(
    row: Record<string, unknown>,
    opts?: { onConflict?: string },
  ): UntypedQuery;
  update(patch: Record<string, unknown>): UntypedQuery;
  delete(): UntypedQuery;
}

export interface UntypedStorageBucket {
  upload(
    path: string,
    body: ArrayBuffer | Uint8Array | Buffer | Blob | File,
    opts?: { contentType?: string; upsert?: boolean },
  ): Promise<{ error: { message: string } | null }>;
  remove(paths: string[]): Promise<{ error: { message: string } | null }>;
  createSignedUrl(
    path: string,
    expiresIn: number,
  ): Promise<{
    data: { signedUrl: string } | null;
    error: { message: string } | null;
  }>;
}

export interface UntypedDb {
  from(table: string): UntypedTable;
  storage: { from(bucket: string): UntypedStorageBucket };
  auth: {
    admin: {
      getUserById(id: string): Promise<{
        data: { user: { email?: string | null } | null };
        error: { message: string } | null;
      }>;
    };
  };
}

/** The service-role client, seen through the structural surface. */
export async function untypedAdminDb(): Promise<UntypedDb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as UntypedDb;
}

/** Read a string column off a row, throwing a clear error when absent. */
export function str(row: Record<string, unknown>, col: string): string {
  const v = row[col];
  if (typeof v !== "string") throw new Error(`Expected string column "${col}".`);
  return v;
}

/** Read a nullable string column off a row. */
export function strOrNull(row: Record<string, unknown>, col: string): string | null {
  const v = row[col];
  return typeof v === "string" ? v : null;
}
