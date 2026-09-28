/**
 * TTS model selector (Stream C).
 *
 * "Auto (Recommended)" is the default — it resolves through
 * `autoSelectModel()` using the content's duration + category and shows
 * the resolved model + reason inline. Per-model cards show quality,
 * speed, expressiveness, multilingual support, best-for, and cost
 * multiplier; non-stable models carry an explicit Alpha/Beta badge and
 * are never silently defaulted.
 */
import { Check, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { autoSelectModel, compatibleModels } from "@/lib/voice-intel";
import type {
  VoiceCategoryId,
  VoiceCharacter,
  VoiceModel,
} from "@/lib/voice-intel/types";

const SPEED_LABEL: Record<VoiceModel["speed"], string> = {
  very_fast: "Very fast",
  fast: "Fast",
  medium: "Medium",
  slow: "Slow",
};

const EXPRESSIVENESS_LABEL: Record<VoiceModel["expressiveness"], string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  very_high: "Very high",
};

function QualityDots({ quality }: { quality: VoiceModel["quality"] }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`Quality ${quality} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            i <= quality ? "bg-amber-400" : "bg-muted",
          )}
        />
      ))}
    </span>
  );
}

export function ModelSelector({
  character,
  modelId,
  onChange,
  durationSeconds,
  categoryId,
  languageCode,
}: {
  character: VoiceCharacter;
  /** "auto" or a model id. */
  modelId: string;
  onChange: (modelId: string) => void;
  durationSeconds: number;
  categoryId: VoiceCategoryId | null;
  languageCode: string;
}) {
  const models = compatibleModels(character.supportedModels);
  const auto = autoSelectModel({ durationSeconds, categoryId, languageCode });
  const selectedIsAuto = modelId === "auto";

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => onChange("auto")}
        aria-pressed={selectedIsAuto}
        className={cn(
          "w-full rounded-xl border p-4 text-left transition-colors",
          selectedIsAuto
            ? "border-amber-400/70 bg-amber-400/[0.06]"
            : "border-border hover:border-amber-400/30",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 font-medium">
            <Sparkles className="h-4 w-4 text-amber-400" />
            Auto (Recommended)
          </span>
          {selectedIsAuto && <Check className="h-4 w-4 text-amber-400" />}
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Resolves to <span className="font-medium text-foreground">{auto.model.label}</span> —{" "}
          {auto.reason}
        </p>
      </button>

      <div className="grid gap-3 sm:grid-cols-2">
        {models.map((model) => {
          const selected = modelId === model.id;
          return (
            <Card
              key={model.id}
              className={cn(
                "cursor-pointer transition-colors",
                selected
                  ? "border-amber-400/70 bg-amber-400/[0.06]"
                  : "hover:border-amber-400/30",
              )}
              onClick={() => onChange(model.id)}
              role="radio"
              aria-checked={selected}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onChange(model.id);
                }
              }}
            >
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{model.label}</span>
                  {selected && <Check className="h-4 w-4 shrink-0 text-amber-400" />}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {model.maturity !== "stable" && (
                    <Badge
                      variant="outline"
                      className="border-amber-400/60 text-amber-300"
                    >
                      {model.maturity === "alpha" ? "Alpha" : "Beta"}
                    </Badge>
                  )}
                  {model.multilingual && <Badge variant="secondary">Multilingual</Badge>}
                  <Badge variant="secondary">×{model.costMultiplier} cost</Badge>
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between gap-2">
                    <dt>Quality</dt>
                    <dd>
                      <QualityDots quality={model.quality} />
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt>Speed</dt>
                    <dd className="text-foreground/80">{SPEED_LABEL[model.speed]}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt>Expressiveness</dt>
                    <dd className="text-foreground/80">{EXPRESSIVENESS_LABEL[model.expressiveness]}</dd>
                  </div>
                </dl>
                <p className="text-xs text-muted-foreground">{model.bestFor}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
