/**
 * F20 Video Studio — local table types.
 *
 * The generated `Database` type (src/integrations/supabase/types.ts) is
 * refreshed separately from the Lovable cloud DB and does not yet include
 * the Phase-1 `scene_versions` table (migration
 * 20260928020100_p1_creation.sql). Per D89 these are `type` aliases, not
 * interfaces (supabase-js needs the implicit index signature). Delete once
 * the generated types catch up.
 */
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@/integrations/supabase/types";

/** Row shape mirroring the pinned `scene_versions` contract. */
export type SceneVersionRow = {
  id: string;
  scene_id: string;
  version_number: number;
  narration: string;
  visual_prompt: string | null;
  asset_url: string | null;
  change_note: string | null;
  created_by: string | null;
  created_at: string;
};

export type SceneVersionInsert = {
  scene_id: string;
  version_number: number;
  narration: string;
  visual_prompt?: string | null;
  asset_url?: string | null;
  change_note?: string | null;
  created_by?: string | null;
};

type SceneVersionTables = {
  scene_versions: {
    Row: SceneVersionRow;
    Insert: SceneVersionInsert;
    Update: Partial<SceneVersionInsert>;
    Relationships: [];
  };
  /** Minimal row shape — the Phase-1 durable job row is fully typed in durable-jobs.server.ts. */
  generation_jobs: {
    Row: {
      id: string;
      project_id: string | null;
      job_type: string;
      status: string;
      attempt_count: number;
      max_attempts: number;
      checkpoint: Json | null;
      updated_at: string;
      created_at: string;
    };
    Insert: never;
    Update: never;
    Relationships: [];
  };
};

/** `Database` extended with `scene_versions` (see module docstring). */
export type VideoStudioDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Omit<Database["public"]["Tables"], keyof SceneVersionTables> & SceneVersionTables;
  };
};

type StudioClient = SupabaseClient<VideoStudioDatabase>;

/**
 * Narrow a standard client to the video-studio schema. The cast is contained
 * here so callers keep passing their ordinary `SupabaseClient<Database>`.
 */
export function asStudioDb(client: SupabaseClient<Database>): StudioClient {
  return client as unknown as StudioClient;
}
