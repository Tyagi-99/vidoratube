/**
 * Voice selection state + persistence (Stream C).
 *
 * Owns the full VoiceSelection (language / category / character / model /
 * settings), favorites, channel default, saved profiles, compare list and
 * recent voices. Persistence:
 * - project config via getProjectVoiceConfig / saveProjectVoiceConfig
 *   (debounced 800ms, only when a projectId is provided)
 * - channel default via getChannelVoiceDefault / saveChannelVoiceDefault
 *   (scope `project:<id>` or `global`)
 * - favorites via getVoiceFavorites / toggleVoiceFavorite
 * - profiles via list/save/deleteVoiceProfile
 * - recents in localStorage
 *
 * All server functions are stubs until Stream B implements them — every
 * call is failure-tolerant so the UI stays usable offline/unimplemented.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultCharacterForLanguage,
  recommendedSettings,
  topVoices,
  voiceCharacter,
  voiceLanguage,
  voiceModel,
  whyThisVoice,
} from "@/lib/voice-intel";
import { DEFAULT_VOICE_SETTINGS } from "@/lib/voice-intel/models";
import {
  deleteVoiceProfile,
  getChannelVoiceDefault,
  getProjectVoiceConfig,
  getVoiceFavorites,
  listVoiceProfiles,
  saveChannelVoiceDefault,
  saveProjectVoiceConfig,
  saveVoiceProfile,
  toggleVoiceFavorite,
} from "@/lib/voice-intel/voice-intel.functions";
import type { VoiceProfile } from "@/lib/voice-intel/contracts";
import type {
  VoiceCategoryId,
  VoiceSelection,
  VoiceSettings,
} from "@/lib/voice-intel/types";
import { VOICE_CATEGORY_IDS } from "@/lib/voice-intel/types";

export type VoiceMode = "simple" | "advanced";

export interface VoiceConfirm {
  title: string;
  description: string;
  keepLabel: string;
  changeLabel: string;
  onKeep: () => void;
  onChange: () => void;
}

const RECENT_KEY = "vidora.voice.recent";
const MAX_RECENT = 10;
const MAX_COMPARE = 3;

function readRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string").slice(0, MAX_RECENT)
      : [];
  } catch {
    return [];
  }
}

function clampSettings(s: VoiceSettings): VoiceSettings {
  const n = (v: unknown, lo: number, hi: number, fb: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb;
  return {
    stability: n(s.stability, 0, 1, DEFAULT_VOICE_SETTINGS.stability),
    similarityBoost: n(s.similarityBoost, 0, 1, DEFAULT_VOICE_SETTINGS.similarityBoost),
    style: n(s.style, 0, 1, DEFAULT_VOICE_SETTINGS.style),
    speed: n(s.speed, 0.7, 1.2, DEFAULT_VOICE_SETTINGS.speed),
    speakerBoost: typeof s.speakerBoost === "boolean" ? s.speakerBoost : true,
  };
}

/** Repairs a stored/foreign selection so it always points at real data. */
export function sanitizeSelection(input: VoiceSelection): VoiceSelection {
  const languageCode =
    voiceLanguage(input.languageCode)?.status === "active" ? input.languageCode : "en";
  const char = voiceCharacter(input.characterId);
  const characterId =
    char && char.languageCode === languageCode
      ? char.id
      : (defaultCharacterForLanguage(languageCode)?.id ?? "adam");
  const categoryId =
    input.categoryId && (VOICE_CATEGORY_IDS as readonly string[]).includes(input.categoryId)
      ? input.categoryId
      : null;
  const modelId =
    input.modelId === "auto" || voiceModel(input.modelId) ? input.modelId : "auto";
  return {
    languageCode,
    categoryId,
    characterId,
    modelId,
    settings: clampSettings({ ...DEFAULT_VOICE_SETTINGS, ...input.settings }),
    customised: input.customised === true,
  };
}

function defaultSelection(): VoiceSelection {
  return {
    languageCode: "en",
    categoryId: null,
    characterId: defaultCharacterForLanguage("en")?.id ?? "adam",
    modelId: "auto",
    settings: { ...DEFAULT_VOICE_SETTINGS },
    customised: false,
  };
}

export function useVoiceSelection(options: {
  projectId?: string | undefined;
  initialSelection?: VoiceSelection | null | undefined;
}) {
  const { projectId, initialSelection } = options;
  const scope = projectId ? `project:${projectId}` : "global";

  const [mode, setMode] = useState<VoiceMode>("simple");
  const [languageCode, setLanguageCodeState] = useState("en");
  const [categoryId, setCategoryIdState] = useState<VoiceCategoryId | null>(null);
  const [characterId, setCharacterIdState] = useState("adam");
  const [modelId, setModelIdState] = useState("auto");
  const [settings, setSettingsState] = useState<VoiceSettings>({ ...DEFAULT_VOICE_SETTINGS });
  const [customised, setCustomised] = useState(false);

  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [channelDefault, setChannelDefault] = useState<VoiceSelection | null>(null);
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>(() => readRecents());
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<VoiceConfirm | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const hydratedRef = useRef(false);
  const channelDefaultRef = useRef<VoiceSelection | null>(null);
  channelDefaultRef.current = channelDefault;

  const selection: VoiceSelection = useMemo(
    () => ({
      languageCode,
      categoryId,
      characterId,
      modelId,
      settings,
      customised,
    }),
    [languageCode, categoryId, characterId, modelId, settings, customised],
  );

  const pushRecent = useCallback((id: string) => {
    setRecents((prev) => {
      const next = [id, ...prev.filter((r) => r !== id)].slice(0, MAX_RECENT);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable — recents just won't persist */
      }
      return next;
    });
  }, []);

  const applySelection = useCallback(
    (next: VoiceSelection) => {
      const clean = sanitizeSelection(next);
      setLanguageCodeState(clean.languageCode);
      setCategoryIdState(clean.categoryId);
      setCharacterIdState(clean.characterId);
      setModelIdState(clean.modelId);
      setSettingsState(clean.settings);
      setCustomised(clean.customised);
      pushRecent(clean.characterId);
    },
    [pushRecent],
  );

  /* ── mount: load persisted state ─────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const safe = async <T,>(p: Promise<T>): Promise<T | null> => {
        try {
          return await p;
        } catch {
          return null;
        }
      };
      const [favRes, chanRes, profRes, projRes] = await Promise.all([
        safe(getVoiceFavorites()),
        safe(getChannelVoiceDefault({ data: { scope } })),
        safe(listVoiceProfiles()),
        projectId ? safe(getProjectVoiceConfig({ data: { projectId } })) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      const base =
        initialSelection ?? projRes?.selection ?? chanRes?.selection ?? defaultSelection();
      const clean = sanitizeSelection(base);
      setLanguageCodeState(clean.languageCode);
      setCategoryIdState(clean.categoryId);
      setCharacterIdState(clean.characterId);
      setModelIdState(clean.modelId);
      setSettingsState(clean.settings);
      setCustomised(clean.customised);
      if (chanRes?.selection) {
        setChannelDefault(sanitizeSelection(chanRes.selection));
      }
      setFavorites(new Set(favRes?.characterIds ?? []));
      setProfiles(profRes?.profiles ?? []);
      hydratedRef.current = true;
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── debounced project persistence ───────────────────────────────── */
  useEffect(() => {
    if (!hydratedRef.current || !projectId) return;
    const t = setTimeout(() => {
      saveProjectVoiceConfig({ data: { projectId, selection } }).catch(() => {
        /* backend stub — selection stays local */
      });
    }, 800);
    return () => clearTimeout(t);
  }, [selection, projectId]);

  /* ── language / category (smart behavior) ────────────────────────── */
  const setLanguageCode = useCallback(
    (code: string) => {
      const lang = voiceLanguage(code);
      if (!lang || lang.status !== "active") return;
      const top =
        topVoices(code, categoryId)[0]?.character ?? defaultCharacterForLanguage(code);
      const nextCharacterId = top?.id ?? characterId;
      setLanguageCodeState(code);
      setCharacterIdState(nextCharacterId);
      setSettingsState(recommendedSettings(categoryId));
      setCustomised(false);
      pushRecent(nextCharacterId);
    },
    [categoryId, characterId, pushRecent],
  );

  const setCategoryId = useCallback(
    (next: VoiceCategoryId | null) => {
      setCategoryIdState(next);
      if (mode === "simple") {
        // Simple mode: everything automatic — re-pick the top voice.
        const top = topVoices(languageCode, next)[0]?.character;
        if (top) {
          setCharacterIdState(top.id);
          pushRecent(top.id);
        }
        setSettingsState(recommendedSettings(next));
        setCustomised(false);
      }
    },
    [languageCode, mode, pushRecent],
  );

  /* ── explicit voice pick (consistency warning) ───────────────────── */
  const selectCharacter = useCallback(
    (id: string, opts?: { silent?: boolean }) => {
      const char = voiceCharacter(id);
      if (!char) return;
      if (char.languageCode !== languageCode) {
        // Cross-language pick: switch language to the character's own.
        const lang = voiceLanguage(char.languageCode);
        if (lang?.status === "active") setLanguageCodeState(lang.code);
      }
      const def = channelDefaultRef.current;
      if (!opts?.silent && def && def.characterId !== id) {
        const defName = voiceCharacter(def.characterId)?.name ?? "your channel default";
        const newName = char.name;
        setConfirm({
          title: "Changing the narrator…",
          description: `Your channel default is ${defName}. Use ${newName} for this video instead?`,
          keepLabel: `Keep ${defName}`,
          changeLabel: `Use ${newName}`,
          onKeep: () => setConfirm(null),
          onChange: () => {
            setConfirm(null);
            setCharacterIdState(id);
            setCustomised(true);
            pushRecent(id);
          },
        });
        return;
      }
      setCharacterIdState(id);
      setCustomised(true);
      pushRecent(id);
    },
    [languageCode, pushRecent],
  );

  const setModelId = useCallback((id: string) => {
    setModelIdState(id);
    setCustomised(true);
  }, []);

  const setSettings = useCallback((next: VoiceSettings) => {
    setSettingsState(clampSettings(next));
    setCustomised(true);
  }, []);

  const applyRecommendedSettings = useCallback(() => {
    const resolvedModel = modelId === "auto" ? undefined : modelId;
    setSettingsState(recommendedSettings(categoryId, resolvedModel));
  }, [categoryId, modelId]);

  /* ── favorites ───────────────────────────────────────────────────── */
  const toggleFavorite = useCallback(async (id: string) => {
    try {
      const res = await toggleVoiceFavorite({ data: { characterId: id } });
      setFavorites((prev) => {
        const next = new Set(prev);
        if (res.favorited) next.add(id);
        else next.delete(id);
        return next;
      });
    } catch {
      setNotice("Couldn't update favorites right now.");
    }
  }, []);

  /* ── channel default ─────────────────────────────────────────────── */
  const saveAsChannelDefault = useCallback(async () => {
    const def = channelDefaultRef.current;
    const newName = voiceCharacter(selection.characterId)?.name ?? selection.characterId;
    const doSave = async () => {
      try {
        await saveChannelVoiceDefault({ data: { scope, selection } });
        setChannelDefault({ ...selection });
        setNotice(`Saved ${newName} as your channel default.`);
      } catch {
        setNotice("Couldn't save the channel default right now.");
      }
    };
    if (def && def.characterId !== selection.characterId) {
      const defName = voiceCharacter(def.characterId)?.name ?? "your channel default";
      setConfirm({
        title: "Changing the narrator…",
        description: `Your channel default is currently ${defName}. Replace it with ${newName}?`,
        keepLabel: `Keep ${defName}`,
        changeLabel: `Use ${newName}`,
        onKeep: () => setConfirm(null),
        onChange: () => {
          setConfirm(null);
          void doSave();
        },
      });
      return;
    }
    await doSave();
  }, [scope, selection]);

  /* ── profiles ────────────────────────────────────────────────────── */
  const saveProfile = useCallback(
    async (name: string) => {
      const clean = name.trim().slice(0, 80);
      if (!clean) return;
      try {
        const res = await saveVoiceProfile({ data: { name: clean, selection } });
        setProfiles((prev) => [...prev, res.profile]);
        setNotice(`Saved profile "${clean}".`);
      } catch {
        setNotice("Couldn't save the profile right now.");
      }
    },
    [selection],
  );

  const deleteProfile = useCallback(async (id: string) => {
    try {
      await deleteVoiceProfile({ data: { id } });
      setProfiles((prev) => prev.filter((p) => p.id !== id));
    } catch {
      setNotice("Couldn't delete the profile right now.");
    }
  }, []);

  /* ── compare tray ────────────────────────────────────────────────── */
  const toggleCompare = useCallback((id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((c) => c !== id);
      if (prev.length >= MAX_COMPARE) return prev;
      return [...prev, id];
    });
  }, []);

  const removeCompare = useCallback((id: string) => {
    setCompareIds((prev) => prev.filter((c) => c !== id));
  }, []);

  const whyFor = useCallback(
    (id: string): string | null => {
      const char = voiceCharacter(id);
      return char ? whyThisVoice(char, categoryId) : null;
    },
    [categoryId],
  );

  return {
    mode,
    setMode,
    selection,
    languageCode,
    setLanguageCode,
    categoryId,
    setCategoryId,
    characterId,
    selectCharacter,
    modelId,
    setModelId,
    settings,
    setSettings,
    applyRecommendedSettings,
    favorites,
    toggleFavorite,
    channelDefault,
    saveAsChannelDefault,
    profiles,
    saveProfile,
    loadProfile: applySelection,
    deleteProfile,
    compareIds,
    toggleCompare,
    removeCompare,
    compareFull: compareIds.length >= MAX_COMPARE,
    maxCompare: MAX_COMPARE,
    recents,
    loading,
    confirm,
    dismissConfirm: () => setConfirm(null),
    notice,
    dismissNotice: () => setNotice(null),
    whyFor,
  };
}
