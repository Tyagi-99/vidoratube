/**
 * Voice Intelligence — DB type aliases + client narrowing (Stream B).
 *
 * SERVER-ONLY. Follows the D89 local-alias pattern from
 * src/lib/creation/voice/voice.functions.ts: the generated DB types predate
 * the voice_intelligence migration (20260929040000), so the new tables are
 * described here from the migration SQL. `projects` is overridden to add the
 * `voice_config` column the migration adds.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { VoiceSelection } from "./types";

/* ── row shapes (from supabase/migrations/20260929040000_voice_intelligence.sql) */

export type VoiceCategoryRow = {
  id: string;
  label: string;
  icon: string;
  blurb: string;
  sort: number;
  created_at: string;
  updated_at: string;
};

export type VoiceModelRow = {
  id: string;
  provider: string;
  label: string;
  quality: number;
  speed: string;
  expressiveness: string;
  multilingual: boolean;
  supported_languages: string[];
  best_for: string;
  cost_multiplier: number;
  supported_params: string[];
  maturity: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type VoiceCharacterRow = {
  id: string;
  name: string;
  language_code: string;
  gender: string;
  accent: string | null;
  personality_tags: string[];
  category_tags: string[];
  description: string;
  recommended_for: string[];
  score: number;
  is_default: boolean;
  provider: string;
  provider_voice_id: string | null;
  supported_models: string[];
  status: string;
  created_at: string;
  updated_at: string;
};

export type VoiceProfileRow = {
  id: string;
  user_id: string;
  name: string;
  selection: VoiceSelection;
  created_at: string;
  updated_at: string;
};

export type VoiceFavoriteRow = {
  user_id: string;
  character_id: string;
  created_at: string;
};

export type ChannelVoiceDefaultRow = {
  id: string;
  user_id: string;
  scope: string;
  selection: VoiceSelection;
  created_at: string;
  updated_at: string;
};

export type VoicePreviewRow = {
  id: string;
  user_id: string;
  cache_key: string;
  character_id: string;
  model_id: string;
  text_hash: string;
  audio_url: string;
  created_at: string;
};

export type VoiceGenerationJobRow = {
  id: string;
  user_id: string;
  character_id: string;
  model_id: string;
  characters: number;
  status: string;
  audio_url: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type VoiceAnalyticsEventRow = {
  id: string;
  user_id: string | null;
  event: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

/* ── projects override: adds the voice_config column ───────────────────── */

type GeneratedProjectsTable = Database["public"]["Tables"]["projects"];

type ProjectsWithVoiceConfig = {
  Row: GeneratedProjectsTable["Row"] & { voice_config: VoiceSelection | null };
  Insert: GeneratedProjectsTable["Insert"] & { voice_config?: VoiceSelection | null };
  Update: GeneratedProjectsTable["Update"] & { voice_config?: VoiceSelection | null };
  Relationships: GeneratedProjectsTable["Relationships"];
};

/* ── table map ─────────────────────────────────────────────────────────── */

type VoiceIntelTables = {
  voice_categories: {
    Row: VoiceCategoryRow;
    Insert: Omit<VoiceCategoryRow, "created_at" | "updated_at"> & {
      created_at?: string;
      updated_at?: string;
    };
    Update: Partial<VoiceCategoryRow>;
    Relationships: [];
  };
  voice_models: {
    Row: VoiceModelRow;
    Insert: Omit<VoiceModelRow, "created_at" | "updated_at"> & {
      created_at?: string;
      updated_at?: string;
    };
    Update: Partial<VoiceModelRow>;
    Relationships: [];
  };
  voice_characters: {
    Row: VoiceCharacterRow;
    Insert: Omit<VoiceCharacterRow, "created_at" | "updated_at"> & {
      created_at?: string;
      updated_at?: string;
    };
    Update: Partial<VoiceCharacterRow>;
    Relationships: [];
  };
  voice_profiles: {
    Row: VoiceProfileRow;
    Insert: {
      id?: string;
      user_id: string;
      name: string;
      selection: VoiceSelection;
      created_at?: string;
      updated_at?: string;
    };
    Update: Partial<Pick<VoiceProfileRow, "name" | "selection">>;
    Relationships: [];
  };
  user_voice_favorites: {
    Row: VoiceFavoriteRow;
    Insert: { user_id: string; character_id: string; created_at?: string };
    Update: Record<string, never>;
    Relationships: [];
  };
  channel_voice_defaults: {
    Row: ChannelVoiceDefaultRow;
    Insert: {
      id?: string;
      user_id: string;
      scope: string;
      selection: VoiceSelection;
      created_at?: string;
      updated_at?: string;
    };
    Update: Partial<Pick<ChannelVoiceDefaultRow, "selection" | "scope">>;
    Relationships: [];
  };
  generated_voice_previews: {
    Row: VoicePreviewRow;
    Insert: {
      id?: string;
      user_id: string;
      cache_key: string;
      character_id: string;
      model_id: string;
      text_hash: string;
      audio_url: string;
      created_at?: string;
    };
    Update: Partial<Pick<VoicePreviewRow, "audio_url">>;
    Relationships: [];
  };
  voice_generation_jobs: {
    Row: VoiceGenerationJobRow;
    Insert: {
      id?: string;
      user_id: string;
      character_id: string;
      model_id: string;
      characters: number;
      status?: string;
      audio_url?: string | null;
      error?: string | null;
      created_at?: string;
      updated_at?: string;
    };
    Update: Partial<Pick<VoiceGenerationJobRow, "status" | "audio_url" | "error">>;
    Relationships: [];
  };
  voice_analytics_events: {
    Row: VoiceAnalyticsEventRow;
    Insert: {
      id?: string;
      user_id?: string | null;
      event: string;
      metadata?: Record<string, unknown>;
      created_at?: string;
    };
    Update: Record<string, never>;
    Relationships: [];
  };
  projects: ProjectsWithVoiceConfig;
};

/** `Database` extended with the voice_intelligence tables (D89 local alias). */
export type VoiceIntelDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Omit<Database["public"]["Tables"], keyof VoiceIntelTables> &
      VoiceIntelTables;
  };
};

export type VoiceIntelClient = SupabaseClient<VoiceIntelDatabase>;

/**
 * Narrow a standard client to the voice-intelligence schema. The cast is
 * contained here so every query below uses fully-typed builders while
 * callers keep passing their ordinary `SupabaseClient<Database>`.
 */
export function asVoiceIntelClient(client: SupabaseClient<Database>): VoiceIntelClient {
  return client as unknown as VoiceIntelClient;
}

/** True when a PostgREST error means "table does not exist" (42P01). */
export function isMissingTableError(error: { code?: string } | null): boolean {
  return error?.code === "42P01";
}
