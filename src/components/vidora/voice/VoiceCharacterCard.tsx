/**
 * Voice character card (Stream C).
 *
 * Visual casting card for one voice character: name, gender, accent,
 * personality tags, best-for lines, description, curated score (always
 * labeled ESTIMATE), and state badges (selected / recommended / default /
 * not-connected / favorite). Preview plays through the shared
 * `useVoicePreview` hook; unmapped voices show an honest "Not connected
 * yet" badge and, when the server names an explicit alternative, a
 * one-click "Use {name} instead" button.
 */
import { GitCompareArrows, Pause, Play, Star } from "lucide-react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { availabilityLabel, voiceCharacter } from "@/lib/voice-intel";
import type {
  VoiceCharacter,
  VoiceLanguage,
} from "@/lib/voice-intel/types";
import type { VoicePreviewState } from "./useVoicePreview";

const GENDER_LABEL: Record<VoiceCharacter["gender"], string> = {
  masculine: "Male",
  feminine: "Female",
  neutral: "Neutral",
};

export interface VoiceCharacterCardProps {
  character: VoiceCharacter;
  language: VoiceLanguage;
  selected: boolean;
  /** Ranked #1 by the recommendation engine for the current category. */
  isRecommended: boolean;
  isFavorite: boolean;
  inCompare: boolean;
  /** True when the compare tray is full and this voice isn't in it. */
  compareDisabled: boolean;
  previewState: VoicePreviewState;
  reasons?: string[];
  onPreview: () => void;
  onSelect: () => void;
  onToggleFavorite: () => void;
  onToggleCompare: () => void;
  onUseFallback: (fallbackCharacterId: string) => void;
}

export function VoiceCharacterCard({
  character,
  language,
  selected,
  isRecommended,
  isFavorite,
  inCompare,
  compareDisabled,
  previewState,
  reasons,
  onPreview,
  onSelect,
  onToggleFavorite,
  onToggleCompare,
  onUseFallback,
}: VoiceCharacterCardProps) {
  const unmapped = !character.providerVoiceId;
  const fallback = previewState.fallbackCharacterId
    ? voiceCharacter(previewState.fallbackCharacterId)
    : undefined;

  return (
    <Card
      data-testid={`voice-card-${character.id}`}
      className={cn(
        "group relative flex h-full snap-start flex-col transition-colors",
        selected
          ? "border-amber-400/70 bg-amber-400/[0.06] shadow-[0_0_24px_-8px_rgba(251,191,36,0.4)]"
          : "hover:border-amber-400/30",
      )}
    >
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="truncate text-base font-semibold">{character.name}</h3>
              {selected && (
                <Badge className="bg-amber-400 text-black hover:bg-amber-400">Selected</Badge>
              )}
              {isRecommended && !selected && (
                <Badge variant="outline" className="border-amber-400/60 text-amber-300">
                  Recommended
                </Badge>
              )}
              {character.isDefault && (
                <Badge variant="secondary">Default · {language.name}</Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {GENDER_LABEL[character.gender]}
              {character.accent ? ` · ${character.accent}` : ""}
              {` · ${language.name}`}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="min-h-[44px] min-w-[44px] shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite();
            }}
            aria-label={isFavorite ? `Remove ${character.name} from favorites` : `Add ${character.name} to favorites`}
            aria-pressed={isFavorite}
          >
            <Star
              className={cn(
                "h-5 w-5",
                isFavorite ? "fill-amber-400 text-amber-400" : "text-muted-foreground",
              )}
            />
          </Button>
        </div>

        {unmapped && (
          <Badge variant="secondary" className="w-fit gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground" />
            {availabilityLabel("unmapped")}
          </Badge>
        )}

        <p className="text-sm leading-relaxed text-muted-foreground">{character.description}</p>

        {character.personalityTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {character.personalityTags.slice(0, 5).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {character.recommendedFor.length > 0 && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">Best for: </span>
            {character.recommendedFor.slice(0, 3).join(" · ")}
          </p>
        )}

        <div className="mt-auto space-y-2 pt-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Score{" "}
              <span className="font-semibold text-foreground">
                {character.score.toFixed(1)}/10
              </span>{" "}
              <span className="rounded border px-1 py-px text-[10px] uppercase tracking-wide text-muted-foreground">
                Estimate
              </span>
            </span>
          </div>

          {reasons && reasons.length > 0 && (
            <p className="text-xs italic text-amber-200/80">{reasons[0]}</p>
          )}

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="min-h-[44px] min-w-[44px] shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                onPreview();
              }}
              disabled={previewState.status === "loading"}
              aria-label={
                previewState.status === "playing"
                  ? `Stop preview of ${character.name}`
                  : `Preview ${character.name}`
              }
            >
              {previewState.status === "loading" ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : previewState.status === "playing" ? (
                <Pause className="h-5 w-5" />
              ) : (
                <Play className="h-5 w-5" />
              )}
            </Button>
            <Button
              variant={selected ? "secondary" : "default"}
              className="min-h-[44px] flex-1"
              onClick={(e) => {
                e.stopPropagation();
                onSelect();
              }}
            >
              {selected ? "Current voice" : "Use this voice"}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="min-h-[44px] min-w-[44px] shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                onToggleCompare();
              }}
              disabled={compareDisabled}
              aria-label={
                inCompare
                  ? `Remove ${character.name} from comparison`
                  : `Add ${character.name} to comparison`
              }
              aria-pressed={inCompare}
              title={compareDisabled ? "Compare tray is full (3 max)" : "Compare"}
            >
              <GitCompareArrows
                className={cn("h-5 w-5", inCompare ? "text-amber-400" : "text-muted-foreground")}
              />
            </Button>
          </div>

          {previewState.status === "error" && (
            <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5">
              <p className="text-xs text-destructive">{previewState.message}</p>
              {fallback && (
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-[44px] w-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUseFallback(fallback.id);
                  }}
                >
                  Use {fallback.name} instead
                </Button>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
