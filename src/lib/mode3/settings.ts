import type { AutoEditAspect, AutoEditPlan } from "./provider";
import { readMode2Settings, type Mode2Settings } from "@/lib/mode2/settings";

export type Mode3Settings = Mode2Settings & {
  creation_mode?: "auto_edit";
  enable_voiceover?: boolean;
  burn_captions?: boolean;
  auto_edit_plan?: AutoEditPlan | null;
  auto_edit_provider?: string;
  aspect_ratio?: AutoEditAspect | string;
};

export function readMode3Settings(settings: unknown): Mode3Settings {
  return readMode2Settings(settings) as Mode3Settings;
}
