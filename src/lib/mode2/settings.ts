import type { CommentaryStyle } from "./duration";

export type Mode2Settings = {
  creation_mode?: "script" | "voiceover" | "auto_edit";
  rights_status?: string;
  source_video_url?: string | null;
  source_storage_path?: string | null;
  source_file_name?: string | null;
  source_duration_seconds?: number | null;
  source_url_metadata?: string | null;
  target_duration_seconds?: number;
  commentary_style?: CommentaryStyle | string;
  trim_start?: number;
  trim_end?: number | null;
  mute_original?: boolean;
  burn_captions?: boolean;
  analysis_uncertainty?: string | null;
  content_item_id?: string | null;
  voice_id?: string;
  voice_model?: string;
  beats?: { start_hint: number; text: string }[];
};

export function readMode2Settings(settings: unknown): Mode2Settings {
  if (!settings || typeof settings !== "object") return {};
  return settings as Mode2Settings;
}

export function projectCreationMode(project: {
  creation_mode?: string | null;
  settings?: unknown;
}): "script" | "voiceover" | "auto_edit" {
  if (project.creation_mode === "voiceover" || project.creation_mode === "auto_edit") {
    return project.creation_mode;
  }
  const s = readMode2Settings(project.settings);
  if (s.creation_mode === "voiceover" || s.creation_mode === "auto_edit") return s.creation_mode;
  return "script";
}
