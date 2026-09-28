/**
 * Voice compare tray (Stream C).
 *
 * Up to 3 voices render the SAME script (editable, 5–10s sample defaulting
 * to the language's preview sample) through `compareVoices`. Each result
 * plays independently; "Use this voice" picks the winner. Errors render
 * honestly per voice — a failed voice never blocks the others.
 */
import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Pause, Play, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { compareVoices } from "@/lib/voice-intel/voice-intel.functions";
import { friendlyTtsError, voiceCharacter, voiceLanguage } from "@/lib/voice-intel";
import type { CompareVoiceItem } from "@/lib/voice-intel/contracts";

interface CompareTrayProps {
  characterIds: string[];
  languageCode: string;
  onRemove: (characterId: string) => void;
  onUseVoice: (characterId: string) => void;
}

export function CompareTray({
  characterIds,
  languageCode,
  onRemove,
  onUseVoice,
}: CompareTrayProps) {
  const sample = voiceLanguage(languageCode)?.previewSample ?? "";
  const [text, setText] = useState(sample);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<CompareVoiceItem[] | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setText(voiceLanguage(languageCode)?.previewSample ?? "");
    setResults(null);
    setError(null);
  }, [languageCode]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      audioRef.current = null;
    },
    [],
  );

  const run = async () => {
    const script = text.trim();
    if (!script) {
      setError("Enter the sample script to compare the voices.");
      return;
    }
    setBusy(true);
    setError(null);
    setResults(null);
    audioRef.current?.pause();
    setPlayingId(null);
    try {
      const res = await compareVoices({ data: { characterIds, text: script } });
      setResults(res.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't generate the comparison.");
    } finally {
      setBusy(false);
    }
  };

  const togglePlay = (item: CompareVoiceItem) => {
    if (!item.audioUrl || typeof Audio === "undefined") return;
    if (playingId === item.characterId) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPlayingId(null);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(item.audioUrl);
    audioRef.current = audio;
    setPlayingId(item.characterId);
    audio.onended = () => setPlayingId(null);
    audio.onerror = () => setPlayingId(null);
    try {
      const p = audio.play();
      if (p && typeof (p as Promise<void>).catch === "function") {
        (p as Promise<void>).catch(() => setPlayingId(null));
      }
    } catch {
      setPlayingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="compare-script">
          Sample script <span className="text-muted-foreground">({text.length}/500)</span>
        </Label>
        <Textarea
          id="compare-script"
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 500))}
          rows={3}
          className="min-h-[88px] resize-none"
          placeholder="The same lines, read by each voice…"
        />
        <p className="text-xs text-muted-foreground">
          Keep it to 5–10 seconds of speech so all three previews generate quickly.
        </p>
      </div>

      <Button onClick={run} disabled={busy || characterIds.length === 0} className="min-h-[44px] w-full">
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {results ? "Regenerate previews" : "Generate previews"}
      </Button>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {busy && (
        <div className="space-y-2">
          {characterIds.map((id) => (
            <Skeleton key={id} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      )}

      {results && (
        <div className="space-y-2">
          {results.map((item) => {
            const character = voiceCharacter(item.characterId);
            const name = character?.name ?? item.characterId;
            const playing = playingId === item.characterId;
            return (
              <div
                key={item.characterId}
                className="flex items-center gap-3 rounded-xl border p-3"
              >
                <Button
                  variant="outline"
                  size="icon"
                  className="min-h-[44px] min-w-[44px] shrink-0"
                  disabled={!item.audioUrl}
                  onClick={() => togglePlay(item)}
                  aria-label={playing ? `Stop ${name}` : `Play ${name}`}
                >
                  {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                </Button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{name}</p>
                  {item.error ? (
                    <p className="truncate text-xs text-destructive">
                      {friendlyTtsError(item.error)}
                    </p>
                  ) : item.audioUrl ? (
                    <p className="text-xs text-emerald-500">Preview ready</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">No audio returned</p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-[44px] shrink-0 gap-1"
                  onClick={() => onUseVoice(item.characterId)}
                >
                  <Check className="h-4 w-4" />
                  Use this voice
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="min-h-[44px] min-w-[44px] shrink-0"
                  onClick={() => onRemove(item.characterId)}
                  aria-label={`Remove ${name} from comparison`}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
