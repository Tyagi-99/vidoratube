/**
 * Voice & Language section (Stream C).
 *
 * Premium voice-casting UI for the creation flow: language selector,
 * smart default card, category quick cards, voice character library,
 * compare tray, model selector, advanced settings, profiles, channel
 * default, and the pre-generate summary panel. Simple mode keeps it to
 * language + category (everything automatic); Advanced unlocks full
 * control. The final VoiceSelection is reported through
 * `onSelectionChange` and persisted (debounced) to the project config.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { BookmarkPlus, GitCompareArrows, Loader2, SlidersHorizontal, Sparkles, Wand2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  ACTIVE_VOICE_LANGUAGES,
  voiceCharacter,
  voiceLanguage,
  voiceModel,
  VOICE_CATEGORIES,
  VOICE_LANGUAGES,
} from "@/lib/voice-intel";
import type { VoiceCategoryId, VoiceSelection } from "@/lib/voice-intel/types";
import { CompareTray } from "./CompareTray";
import { ModelSelector } from "./ModelSelector";
import { VoiceLibraryGrid } from "./VoiceLibraryGrid";
import { VoiceSettingsControls } from "./VoiceSettingsControls";
import { VoiceSummaryPanel } from "./VoiceSummaryPanel";
import { useVoicePreview } from "./useVoicePreview";
import { useVoiceSelection } from "./useVoiceSelection";

export interface VoiceLanguageSectionProps {
  projectId?: string | undefined;
  narrationText?: string;
  estimatedDurationSeconds?: number | undefined;
  initialSelection?: VoiceSelection | null | undefined;
  onSelectionChange?: (selection: VoiceSelection) => void;
  className?: string;
}

export function VoiceLanguageSection({
  projectId,
  narrationText = "",
  estimatedDurationSeconds,
  initialSelection,
  onSelectionChange,
  className,
}: VoiceLanguageSectionProps) {
  const sel = useVoiceSelection({ projectId, initialSelection });
  const { previewStates, preview } = useVoicePreview();
  const [compareOpen, setCompareOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [savedOpen, setSavedOpen] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const libraryRef = useRef<HTMLDivElement>(null);

  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  useEffect(() => {
    onSelectionChangeRef.current?.(sel.selection);
  }, [sel.selection]);

  const language = voiceLanguage(sel.languageCode);
  const character = voiceCharacter(sel.characterId);
  const isDefaultPick = character?.isDefault ?? false;

  const previewSample = language?.previewSample ?? "";
  const getPreviewState = (id: string) =>
    previewStates[id] ?? { status: "idle" as const, message: null, fallbackCharacterId: null };

  const durationSeconds = useMemo(() => {
    if (narrationText.trim()) {
      const cpm = language?.charsPerMinute ?? 800;
      return Math.max(5, (narrationText.length / cpm) * 60);
    }
    return estimatedDurationSeconds ?? 60;
  }, [narrationText, language, estimatedDurationSeconds]);

  const resolvedModelId =
    sel.modelId === "auto"
      ? undefined
      : sel.modelId;
  const resolvedModel = resolvedModelId ? voiceModel(resolvedModelId) : undefined;

  const scrollToLibrary = () => {
    sel.setMode("advanced");
    requestAnimationFrame(() => {
      libraryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const handlePreview = (id: string) => {
    void preview(id, previewSample);
  };

  const handleUseFallback = (fallbackId: string) => {
    sel.selectCharacter(fallbackId, { silent: true });
  };

  const handleCompareUse = (id: string) => {
    sel.selectCharacter(id, { silent: true });
    setCompareOpen(false);
  };

  return (
    <section ref={sectionRef} id="voice-language-section" className={cn("space-y-6", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Voice &amp; Language</h2>
          <p className="text-sm text-muted-foreground">
            {sel.mode === "simple"
              ? "Pick a language and a vibe — Vidora casts the narrator."
              : "Full casting control: character, model and fine-tuning."}
          </p>
        </div>
        <div
          className="inline-flex rounded-lg border p-1"
          role="group"
          aria-label="Voice selection mode"
        >
          {(
            [
              { value: "simple", label: "Simple", icon: Sparkles },
              { value: "advanced", label: "Advanced", icon: SlidersHorizontal },
            ] as const
          ).map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => sel.setMode(m.value)}
              aria-pressed={sel.mode === m.value}
              className={cn(
                "inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-4 text-sm font-medium transition-colors",
                sel.mode === m.value
                  ? "bg-amber-400 text-black"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <m.icon className="h-4 w-4" />
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Language selector ─────────────────────────────────── */}
      <div className="space-y-2">
        <Label>Language</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ACTIVE_VOICE_LANGUAGES.map((lang) => {
            const active = lang.code === sel.languageCode;
            return (
              <button
                key={lang.code}
                type="button"
                onClick={() => sel.setLanguageCode(lang.code)}
                aria-pressed={active}
                className={cn(
                  "flex min-h-[52px] items-center gap-2.5 rounded-xl border px-3 text-left transition-colors",
                  active
                    ? "border-amber-400/70 bg-amber-400/[0.08]"
                    : "border-border hover:border-amber-400/30",
                )}
              >
                <span className="text-2xl" aria-hidden>{lang.flag}</span>
                <span className="text-sm font-medium">{lang.name}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {VOICE_LANGUAGES.filter((l) => l.status === "planned").map((lang) => (
            <span
              key={lang.code}
              className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-full border border-dashed px-2.5 py-1 text-xs text-muted-foreground opacity-60"
              title={`${lang.name} is coming soon`}
            >
              <span aria-hidden>{lang.flag}</span>
              {lang.name}
              <Badge variant="secondary" className="px-1 py-0 text-[10px]">Coming soon</Badge>
            </span>
          ))}
        </div>
      </div>

      {/* ── Smart default card ────────────────────────────────── */}
      {character && language && (
        <Card className="border-amber-400/30 bg-gradient-to-br from-amber-400/[0.07] to-transparent">
          <CardContent data-testid="smart-default" className="flex flex-wrap items-center gap-4 p-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-400/15 text-xl font-semibold text-amber-300">
              {character.name.slice(0, 1)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{character.name}</span>
                {isDefaultPick && (
                  <Badge className="bg-amber-400 text-black hover:bg-amber-400">
                    Recommended
                  </Badge>
                )}
                {!character.providerVoiceId && (
                  <Badge variant="secondary">Not connected yet</Badge>
                )}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {sel.whyFor(character.id) ?? character.description}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="outline"
                className="min-h-[44px]"
                onClick={() => handlePreview(character.id)}
                disabled={getPreviewState(character.id).status === "loading"}
              >
                {getPreviewState(character.id).status === "loading" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Preview
              </Button>
              <Button variant="secondary" className="min-h-[44px]" onClick={scrollToLibrary}>
                Change voice
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Category quick cards ──────────────────────────────── */}
      <div className="space-y-2">
        <Label>What kind of video is this?</Label>
        <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-2">
          {VOICE_CATEGORIES.map((cat) => {
            const active = sel.categoryId === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => sel.setCategoryId(active ? null : (cat.id as VoiceCategoryId))}
                aria-pressed={active}
                title={cat.blurb}
                data-testid={`category-${cat.id}`}
                className={cn(
                  "flex min-h-[44px] shrink-0 snap-start items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors",
                  active
                    ? "border-amber-400/70 bg-amber-400/[0.1] text-foreground"
                    : "border-border text-muted-foreground hover:border-amber-400/30 hover:text-foreground",
                )}
              >
                <span aria-hidden>{cat.icon}</span>
                {cat.label}
              </button>
            );
          })}
        </div>
      </div>

      {sel.mode === "advanced" && (
        <div className="space-y-6" ref={libraryRef}>
          {/* ── Library ─────────────────────────────────────── */}
          {language && (
            <VoiceLibraryGrid
              language={language}
              categoryId={sel.categoryId}
              selectedId={sel.characterId}
              favorites={sel.favorites}
              recentIds={sel.recents}
              loading={sel.loading}
              getPreviewState={getPreviewState}
              onPreview={(c) => handlePreview(c.id)}
              onSelect={(c) => sel.selectCharacter(c.id)}
              onToggleFavorite={(id) => void sel.toggleFavorite(id)}
              onToggleCompare={sel.toggleCompare}
              onUseFallback={handleUseFallback}
              inCompare={(id) => sel.compareIds.includes(id)}
              compareFull={sel.compareFull}
            />
          )}

          {/* ── Compare ─────────────────────────────────────── */}
          {sel.compareIds.length > 0 && (
            <div
              data-testid="compare-bar"
              className="flex items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-400/[0.05] p-3"
            >
              <p className="text-sm">
                <span className="font-semibold">{sel.compareIds.length}</span> voice
                {sel.compareIds.length === 1 ? "" : "s"} selected for comparison
              </p>
              <Button
                className="min-h-[44px] gap-2"
                onClick={() => setCompareOpen(true)}
                disabled={sel.compareIds.length < 2}
              >
                <GitCompareArrows className="h-4 w-4" />
                Compare
              </Button>
            </div>
          )}

          {/* ── Model ───────────────────────────────────────── */}
          {character && (
            <div className="space-y-2">
              <Label>Voice model</Label>
              <ModelSelector
                character={character}
                modelId={sel.modelId}
                onChange={sel.setModelId}
                durationSeconds={durationSeconds}
                categoryId={sel.categoryId}
                languageCode={sel.languageCode}
              />
            </div>
          )}

          {/* ── Advanced settings ───────────────────────────── */}
          {character && resolvedModel && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">Fine-tuning</CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-[44px] gap-1.5"
                    onClick={sel.applyRecommendedSettings}
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    AI Recommended Settings
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Only the controls {resolvedModel.label} supports are shown.
                </p>
              </CardHeader>
              <CardContent>
                <VoiceSettingsControls
                  model={resolvedModel}
                  settings={sel.settings}
                  onChange={sel.setSettings}
                />
              </CardContent>
            </Card>
          )}

          {/* ── Saved voices ────────────────────────────────── */}
          <Collapsible open={savedOpen} onOpenChange={setSavedOpen}>
            <Card>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex min-h-[56px] w-full items-center justify-between p-4 text-left"
                >
                  <span className="flex items-center gap-2 font-medium">
                    <BookmarkPlus className="h-4 w-4 text-amber-400" />
                    Saved voices
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {savedOpen ? "Hide" : "Channel default & profiles"}
                  </span>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="space-y-4 border-t pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm">
                      <p className="font-medium">Channel default</p>
                      <p className="text-xs text-muted-foreground">
                        {sel.channelDefault
                          ? `Currently ${voiceCharacter(sel.channelDefault.characterId)?.name ?? "—"}`
                          : "No default saved yet"}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      className="min-h-[44px]"
                      onClick={() => void sel.saveAsChannelDefault()}
                    >
                      Save as channel default
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="voice-profile-name">Save current setup as a profile</Label>
                    <div className="flex gap-2">
                      <Input
                        id="voice-profile-name"
                        value={profileName}
                        onChange={(e) => setProfileName(e.target.value)}
                        placeholder="e.g. Horror narrator"
                        maxLength={80}
                        className="min-h-[44px]"
                      />
                      <Button
                        className="min-h-[44px] shrink-0"
                        disabled={!profileName.trim()}
                        onClick={() => {
                          void sel.saveProfile(profileName).then(() => setProfileName(""));
                        }}
                      >
                        Save
                      </Button>
                    </div>
                  </div>

                  {sel.profiles.length > 0 ? (
                    <ul className="space-y-2">
                      {sel.profiles.map((p) => (
                        <li
                          key={p.id}
                          className="flex items-center justify-between gap-2 rounded-lg border p-2.5"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{p.name}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {voiceLanguage(p.selection.languageCode)?.name} ·{" "}
                              {voiceCharacter(p.selection.characterId)?.name}
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="min-h-[44px]"
                              onClick={() => sel.loadProfile(p.selection)}
                            >
                              Load
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="min-h-[44px] text-destructive"
                              onClick={() => void sel.deleteProfile(p.id)}
                            >
                              Delete
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No saved profiles yet.
                    </p>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </div>
      )}

      {sel.loading && (
        <div className="space-y-2">
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      )}

      {/* ── Summary (before Generate) ─────────────────────────── */}
      <VoiceSummaryPanel
        selection={sel.selection}
        narrationText={narrationText}
        estimatedDurationSeconds={estimatedDurationSeconds}
        onEdit={() => sectionRef.current?.scrollIntoView({ behavior: "smooth" })}
        onSelectCharacter={(id) => sel.selectCharacter(id, { silent: true })}
      />

      {sel.notice && (
        <Alert>
          <AlertDescription className="flex items-center justify-between gap-2">
            {sel.notice}
            <Button variant="ghost" size="sm" onClick={sel.dismissNotice}>
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* ── Compare dialog ────────────────────────────────────── */}
      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Compare voices</DialogTitle>
            <DialogDescription>
              The same script, read by each voice. Pick the one that fits.
            </DialogDescription>
          </DialogHeader>
          <CompareTray
            characterIds={sel.compareIds}
            languageCode={sel.languageCode}
            onRemove={sel.removeCompare}
            onUseVoice={handleCompareUse}
          />
        </DialogContent>
      </Dialog>

      {/* ── Consistency confirm ───────────────────────────────── */}
      <AlertDialog open={sel.confirm !== null} onOpenChange={(v) => !v && sel.dismissConfirm()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{sel.confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{sel.confirm?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              className="min-h-[44px]"
              onClick={() => sel.confirm?.onKeep()}
            >
              {sel.confirm?.keepLabel}
            </AlertDialogCancel>
            <AlertDialogAction
              className="min-h-[44px]"
              onClick={() => sel.confirm?.onChange()}
            >
              {sel.confirm?.changeLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
