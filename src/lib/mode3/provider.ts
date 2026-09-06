/**
 * AutomaticEditingProvider — Mode 3 adapter contract.
 * First impl is Vidora-native heuristic. A future licensed AutoEditor worker
 * can implement the same interface without changing the UI.
 */

export type AutoEditAspect = "16:9" | "9:16" | "1:1";

export type AutoEditPlanInput = {
  sourceDurationSeconds: number;
  targetDurationSeconds: number;
  aspect: AutoEditAspect | string;
  burnCaptions: boolean;
  enableVoiceover: boolean;
  /** Optional user notes used to seed caption/script cues */
  notes?: string | null | undefined;
  title?: string | null | undefined;
};

export type AutoEditSegment = {
  /** Inclusive start on the source timeline (seconds) */
  start: number;
  /** Exclusive end on the source timeline (seconds) */
  end: number;
  reason: string;
};

export type AutoEditCue = {
  start: number;
  end: number;
  text: string;
};

export type AutoEditPlan = {
  providerId: string;
  /** Trim window applied to source before export */
  trimStart: number;
  trimEnd: number;
  targetDurationSeconds: number;
  segments: AutoEditSegment[];
  cues: AutoEditCue[];
  /** Human-readable explanation of the heuristic */
  summary: string;
  /** Capabilities still stubbed for later providers */
  stubs: {
    silenceDetection: boolean;
    sceneDetection: boolean;
    autoEditorBackend: boolean;
  };
};

export interface AutomaticEditingProvider {
  id: string;
  label: string;
  plan(input: AutoEditPlanInput): Promise<AutoEditPlan> | AutoEditPlan;
}
