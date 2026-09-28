/**
 * Advanced voice settings (Stream C).
 *
 * Renders ONLY the controls listed in the selected model's
 * `supportedParams` — sliders for stability / similarity / style / speed
 * (0–100%), toggle for speaker boost. Unknown or unsupported params are
 * never shown.
 */
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import type { VoiceModel, VoiceParam, VoiceSettings } from "@/lib/voice-intel/types";

const PARAM_META: Record<
  VoiceParam,
  { label: string; hint: string; min: number; max: number; step: number }
> = {
  stability: {
    label: "Stability",
    hint: "Higher = steadier, lower = more expressive",
    min: 0,
    max: 100,
    step: 1,
  },
  similarity_boost: {
    label: "Similarity",
    hint: "How closely the voice matches the character",
    min: 0,
    max: 100,
    step: 1,
  },
  style: {
    label: "Style",
    hint: "Expressiveness of the delivery",
    min: 0,
    max: 100,
    step: 1,
  },
  speed: {
    label: "Speed",
    hint: "Narration pace",
    min: 70,
    max: 120,
    step: 1,
  },
  speaker_boost: {
    label: "Speaker boost",
    hint: "Enhances vocal clarity",
    min: 0,
    max: 100,
    step: 1,
  },
};

function paramValue(param: VoiceParam, settings: VoiceSettings): number {
  switch (param) {
    case "stability":
      return Math.round(settings.stability * 100);
    case "similarity_boost":
      return Math.round(settings.similarityBoost * 100);
    case "style":
      return Math.round(settings.style * 100);
    case "speed":
      return Math.round(settings.speed * 100);
    case "speaker_boost":
      return settings.speakerBoost ? 100 : 0;
  }
}

export function VoiceSettingsControls({
  model,
  settings,
  onChange,
}: {
  model: VoiceModel;
  settings: VoiceSettings;
  onChange: (next: VoiceSettings) => void;
}) {
  const setParam = (param: VoiceParam, percent: number) => {
    switch (param) {
      case "stability":
        onChange({ ...settings, stability: percent / 100 });
        return;
      case "similarity_boost":
        onChange({ ...settings, similarityBoost: percent / 100 });
        return;
      case "style":
        onChange({ ...settings, style: percent / 100 });
        return;
      case "speed":
        onChange({ ...settings, speed: Math.min(1.2, Math.max(0.7, percent / 100)) });
        return;
      case "speaker_boost":
        onChange({ ...settings, speakerBoost: percent >= 50 });
        return;
    }
  };

  return (
    <div className="space-y-4">
      {model.supportedParams.map((param) => {
        if (param === "speaker_boost") {
          return (
            <div key={param} className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor={`voice-param-${param}`}>{PARAM_META[param].label}</Label>
                <p className="text-xs text-muted-foreground">{PARAM_META[param].hint}</p>
              </div>
              <Switch
                id={`voice-param-${param}`}
                checked={settings.speakerBoost}
                onCheckedChange={(v) => setParam(param, v ? 100 : 0)}
                className="min-h-[28px]"
              />
            </div>
          );
        }
        const meta = PARAM_META[param];
        const value = paramValue(param, settings);
        return (
          <div key={param} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor={`voice-param-${param}`}>{meta.label}</Label>
              <span className="text-sm tabular-nums text-muted-foreground">
                {param === "speed" ? `${(value / 100).toFixed(2)}×` : `${value}%`}
              </span>
            </div>
            <Slider
              id={`voice-param-${param}`}
              min={meta.min}
              max={meta.max}
              step={meta.step}
              value={[value]}
              onValueChange={(v) => setParam(param, v[0] ?? value)}
              aria-label={meta.label}
            />
            <p className="text-xs text-muted-foreground">{meta.hint}</p>
          </div>
        );
      })}
    </div>
  );
}
