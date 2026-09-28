/**
 * Voice preview playback (Stream C).
 *
 * Calls the `previewVoice` server function, then plays the returned audio
 * through an HTMLAudioElement. States are tracked per character id so each
 * card renders its own spinner / error. Failures are surfaced with
 * `friendlyTtsError()` copy — never fake audio, never fake success.
 * Unmapped-voice errors carry `fallbackCharacterId`, which the card turns
 * into a one-click "Use {name} instead" button.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { previewVoice } from "@/lib/voice-intel/voice-intel.functions";
import { friendlyTtsError } from "@/lib/voice-intel";

export type VoicePreviewStatus = "idle" | "loading" | "playing" | "error";

export interface VoicePreviewState {
  status: VoicePreviewStatus;
  /** Friendly message when status === "error". */
  message: string | null;
  /** Explicit alternative offered by the server; null when none. */
  fallbackCharacterId: string | null;
}

const IDLE: VoicePreviewState = {
  status: "idle",
  message: null,
  fallbackCharacterId: null,
};

export function useVoicePreview() {
  const [states, setStates] = useState<Record<string, VoicePreviewState>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playingIdRef = useRef<string | null>(null);

  const setState = useCallback(
    (characterId: string, state: VoicePreviewState) => {
      setStates((prev) => ({ ...prev, [characterId]: state }));
    },
    [],
  );

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audioRef.current = null;
    }
    const id = playingIdRef.current;
    playingIdRef.current = null;
    if (id) setStates((prev) => ({ ...prev, [id]: IDLE }));
  }, []);

  const preview = useCallback(
    async (characterId: string, text: string) => {
      // Toggle: tapping the playing card stops it.
      if (playingIdRef.current === characterId) {
        stop();
        return;
      }
      stop();
      setState(characterId, { status: "loading", message: null, fallbackCharacterId: null });

      let result: Awaited<ReturnType<typeof previewVoice>>;
      try {
        result = await previewVoice({ data: { characterId, text } });
      } catch (e) {
        setState(characterId, {
          status: "error",
          message: e instanceof Error ? e.message : "Couldn't generate this preview.",
          fallbackCharacterId: null,
        });
        return;
      }

      if (!result.ok) {
        setState(characterId, {
          status: "error",
          message: friendlyTtsError(result.code),
          fallbackCharacterId: result.fallbackCharacterId,
        });
        return;
      }

      if (typeof Audio === "undefined") {
        setState(characterId, {
          status: "error",
          message: "Audio playback isn't available in this browser.",
          fallbackCharacterId: null,
        });
        return;
      }

      const audio = new Audio(result.audioUrl);
      audioRef.current = audio;
      playingIdRef.current = characterId;
      audio.onended = () => {
        audioRef.current = null;
        playingIdRef.current = null;
        setState(characterId, IDLE);
      };
      audio.onerror = () => {
        audioRef.current = null;
        playingIdRef.current = null;
        setState(characterId, {
          status: "error",
          message: "Couldn't play the preview audio.",
          fallbackCharacterId: null,
        });
      };
      setState(characterId, { status: "playing", message: null, fallbackCharacterId: null });
      try {
        const started = audio.play();
        if (started && typeof (started as Promise<void>).catch === "function") {
          await (started as Promise<void>).catch(() => {
            throw new Error("play rejected");
          });
        }
      } catch {
        audioRef.current = null;
        playingIdRef.current = null;
        setState(characterId, {
          status: "error",
          message: "Couldn't play the preview audio.",
          fallbackCharacterId: null,
        });
      }
    },
    [setState, stop],
  );

  useEffect(
    () => () => {
      audioRef.current?.pause();
      audioRef.current = null;
      playingIdRef.current = null;
    },
    [],
  );

  return { previewStates: states, preview, stopPreview: stop };
}
