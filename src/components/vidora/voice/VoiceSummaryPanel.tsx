/**
 * Voice summary panel (Stream C).
 *
 * Rendered before Generate: language, category, voice, model (with the
 * Auto-resolved name), style, speed, estimated duration and estimated
 * cost/credits (client-side `estimateVoiceCost` for instant display).
 * When the selected character cannot be consumed by the render pipeline,
 * the explicit fallback note from `resolveDialogVoiceKey` is shown here —
 * never silent. The Edit link jumps back to the section.
 */
import { AlertTriangle, Pencil } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  autoSelectModel,
  estimateVoiceCost,
  formatNarrationDuration,
  voiceCategory,
  voiceCharacter,
  voiceLanguage,
  voiceModel,
} from "@/lib/voice-intel";
import type { VoiceSelection } from "@/lib/voice-intel/types";
import { resolveDialogVoiceKey } from "./dialog-voice-mapping";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium">{children}</dd>
    </div>
  );
}

export function VoiceSummaryPanel({
  selection,
  narrationText,
  estimatedDurationSeconds,
  onEdit,
  onSelectCharacter,
}: {
  selection: VoiceSelection;
  narrationText: string;
  estimatedDurationSeconds?: number | undefined;
  onEdit: () => void;
  onSelectCharacter?: (characterId: string) => void;
}) {
  const language = voiceLanguage(selection.languageCode);
  const character = voiceCharacter(selection.characterId);
  const category = selection.categoryId ? voiceCategory(selection.categoryId) : undefined;

  const charsPerMinute = language?.charsPerMinute ?? 800;
  const hasText = narrationText.trim().length > 0;
  const minutes = hasText
    ? narrationText.length / charsPerMinute
    : (estimatedDurationSeconds ?? 0) / 60;

  const durationSeconds = hasText
    ? (narrationText.length / charsPerMinute) * 60
    : (estimatedDurationSeconds ?? 60);

  const autoChoice = autoSelectModel({
    durationSeconds,
    categoryId: selection.categoryId,
    languageCode: selection.languageCode,
  });
  const model =
    selection.modelId === "auto" ? autoChoice.model : (voiceModel(selection.modelId) ?? autoChoice.model);

  const costText = hasText
    ? narrationText
    : "·".repeat(Math.max(1, Math.round(charsPerMinute * minutes)));
  const cost = estimateVoiceCost(costText, {
    modelId: model.id,
    languageCode: selection.languageCode,
  });

  const resolution = resolveDialogVoiceKey(selection);
  const fallbackCharacter = resolution.viaFallback
    ? voiceCharacter(resolution.effectiveCharacterId)
    : undefined;

  return (
    <Card data-testid="voice-summary" className="border-amber-400/30 bg-amber-400/[0.03]">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">Voice summary</CardTitle>
        <Button
          variant="ghost"
          size="sm"
          className="min-h-[44px] gap-1.5"
          onClick={onEdit}
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Button>
      </CardHeader>
      <CardContent>
        <dl className="divide-y divide-border/60">
          <Row label="Language">
            {language ? `${language.flag} ${language.name}` : selection.languageCode}
          </Row>
          <Row label="Category">
            {category ? `${category.icon} ${category.label}` : "Automatic"}
          </Row>
          <Row label="Voice">
            <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
              {character?.name ?? selection.characterId}
              {character && !character.providerVoiceId && (
                <Badge variant="secondary">Not connected yet</Badge>
              )}
            </span>
          </Row>
          <Row label="Model">
            <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
              {selection.modelId === "auto" && <Badge variant="outline">Auto</Badge>}
              {model.label}
            </span>
          </Row>
          <Row label="Style">{Math.round(selection.settings.style * 100)}%</Row>
          <Row label="Speed">{selection.settings.speed.toFixed(2)}×</Row>
          <Row label="Est. duration">
            {minutes > 0 ? `≈ ${formatNarrationDuration(minutes)}` : "—"}
          </Row>
          <Row label="Est. cost">
            {minutes > 0 ? (
              <span>
                {cost.credits} credit{cost.credits === 1 ? "" : "s"}
                <span className="text-muted-foreground"> · ≈ ${cost.usd.toFixed(4)}</span>
              </span>
            ) : (
              "—"
            )}
          </Row>
        </dl>

        {resolution.viaFallback && resolution.note && (
          <Alert className="mt-3 border-amber-400/40 bg-amber-400/[0.07]">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <AlertDescription className="text-sm">
              {resolution.note}
              {fallbackCharacter && onSelectCharacter && (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-2 min-h-[36px]"
                  onClick={() => onSelectCharacter(fallbackCharacter.id)}
                >
                  Switch to {fallbackCharacter.name}
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
