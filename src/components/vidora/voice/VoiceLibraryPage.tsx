/**
 * Voice Library — the standalone /voices page (Stream D, D331).
 *
 * This is the new Voice Intelligence library experience: language tabs,
 * category filtering, the 40-character casting grid with honest
 * availability states, previews, favorites, a 3-voice comparison tray,
 * and reusable named voice profiles. The legacy Phase-3 TTS panel
 * (arbitrary text → speech + custom voice uploads) lives on at
 * /voices/lab.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AudioLines, BookmarkPlus, FlaskConical, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  VOICE_CATEGORIES,
  VOICE_LANGUAGES,
  defaultCharacterForLanguage,
  voiceCharacter,
  voiceLanguage,
} from "@/lib/voice-intel/catalog";
import { DEFAULT_VOICE_SETTINGS } from "@/lib/voice-intel/models";
import type {
  VoiceCategoryId,
  VoiceCharacter,
  VoiceSelection,
} from "@/lib/voice-intel/types";
import type { VoiceProfile } from "@/lib/voice-intel/contracts";
import {
  deleteVoiceProfile,
  getVoiceFavorites,
  listVoiceProfiles,
  saveVoiceProfile,
  toggleVoiceFavorite,
} from "@/lib/voice-intel/voice-intel.functions";
import { CompareTray } from "./CompareTray";
import { VoiceLibraryGrid } from "./VoiceLibraryGrid";
import { sanitizeSelection } from "./useVoiceSelection";
import { useVoicePreview } from "./useVoicePreview";

const MAX_COMPARE = 3;
const MAX_RECENT = 12;

function profileSummary(selection: VoiceSelection): string {
  const lang = voiceLanguage(selection.languageCode);
  const char = voiceCharacter(selection.characterId);
  return `${lang?.name ?? selection.languageCode} · ${char?.name ?? selection.characterId}`;
}

export function VoiceLibraryPage() {
  const [languageCode, setLanguageCode] = useState("en");
  const [categoryId, setCategoryId] = useState<VoiceCategoryId | null>(null);
  const [spotlightId, setSpotlightId] = useState<string>(
    () => defaultCharacterForLanguage("en")?.id ?? "adam",
  );
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [recents, setRecents] = useState<string[]>([]);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [profileName, setProfileName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [loading, setLoading] = useState(true);

  const language = voiceLanguage(languageCode) ?? voiceLanguage("en")!;
  const { previewStates, preview } = useVoicePreview();

  /* ── initial load: favorites + profiles ─────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [favRes, profRes] = await Promise.all([
          getVoiceFavorites().catch(() => null),
          listVoiceProfiles().catch(() => null),
        ]);
        if (cancelled) return;
        setFavorites(new Set(favRes?.characterIds ?? []));
        setProfiles(profRes?.profiles ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pushRecent = useCallback((id: string) => {
    setRecents((prev) => [id, ...prev.filter((r) => r !== id)].slice(0, MAX_RECENT));
  }, []);

  const handleLanguage = useCallback(
    (code: string) => {
      const lang = voiceLanguage(code);
      if (!lang || lang.status !== "active") return;
      const def = defaultCharacterForLanguage(code);
      setLanguageCode(code);
      if (def) {
        setSpotlightId(def.id);
        pushRecent(def.id);
      }
    },
    [pushRecent],
  );

  const handleSelect = useCallback(
    (character: VoiceCharacter) => {
      setSpotlightId(character.id);
      pushRecent(character.id);
    },
    [pushRecent],
  );

  const handlePreview = useCallback(
    (character: VoiceCharacter) => {
      const lang = voiceLanguage(character.languageCode);
      void preview(character.id, lang?.previewSample ?? "");
    },
    [preview],
  );

  const toggleFavorite = useCallback(async (id: string) => {
    try {
      const res = await toggleVoiceFavorite({ data: { characterId: id } });
      setFavorites((prev) => {
        const next = new Set(prev);
        if (res.favorited) next.add(id);
        else next.delete(id);
        return next;
      });
      toast.success(res.favorited ? "Added to favorites." : "Removed from favorites.");
    } catch {
      toast.error("Couldn't update favorites right now.");
    }
  }, []);

  const toggleCompare = useCallback((id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((c) => c !== id);
      if (prev.length >= MAX_COMPARE) {
        toast.error(`You can compare up to ${MAX_COMPARE} voices at a time.`);
        return prev;
      }
      return [...prev, id];
    });
  }, []);

  const useFallback = useCallback(
    (fallbackCharacterId: string) => {
      const char = voiceCharacter(fallbackCharacterId);
      if (char) handleSelect(char);
    },
    [handleSelect],
  );

  const currentSelection = useMemo<VoiceSelection>(
    () =>
      sanitizeSelection({
        languageCode,
        categoryId,
        characterId: spotlightId,
        modelId: "auto",
        settings: { ...DEFAULT_VOICE_SETTINGS },
        customised: false,
      }),
    [languageCode, categoryId, spotlightId],
  );

  const handleSaveProfile = useCallback(async () => {
    const name = profileName.trim().slice(0, 80);
    if (!name) {
      toast.error("Give the profile a name first.");
      return;
    }
    setSavingProfile(true);
    try {
      const res = await saveVoiceProfile({ data: { name, selection: currentSelection } });
      setProfiles((prev) => [res.profile, ...prev]);
      setProfileName("");
      toast.success(`Saved profile "${name}".`);
    } catch {
      toast.error("Couldn't save the profile right now.");
    } finally {
      setSavingProfile(false);
    }
  }, [profileName, currentSelection]);

  const handleLoadProfile = useCallback((profile: VoiceProfile) => {
    const clean = sanitizeSelection(profile.selection);
    setLanguageCode(clean.languageCode);
    setCategoryId(clean.categoryId);
    setSpotlightId(clean.characterId);
    pushRecent(clean.characterId);
    toast.success(`Loaded profile "${profile.name}".`);
  }, [pushRecent]);

  const handleDeleteProfile = useCallback(async (id: string) => {
    try {
      await deleteVoiceProfile({ data: { id } });
      setProfiles((prev) => prev.filter((p) => p.id !== id));
      toast.success("Profile deleted.");
    } catch {
      toast.error("Couldn't delete the profile right now.");
    }
  }, []);

  const getPreviewState = useCallback(
    (characterId: string) =>
      previewStates[characterId] ?? { status: "idle", message: null, fallbackCharacterId: null },
    [previewStates],
  );

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Voice Library</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Cast the narrator for your next video. Browse by language, filter by
            content category, preview voices, and save reusable voice profiles.
          </p>
        </div>
        <Button variant="outline" asChild className="gap-2">
          <Link to="/voices/lab">
            <FlaskConical className="h-4 w-4" />
            TTS lab &amp; custom voices
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={languageCode} onValueChange={handleLanguage}>
          <TabsList>
            {VOICE_LANGUAGES.map((l) => (
              <TabsTrigger
                key={l.code}
                value={l.code}
                disabled={l.status !== "active"}
                className="gap-1.5"
              >
                <span aria-hidden>{l.flag}</span>
                {l.name}
                {l.status !== "active" && (
                  <Badge variant="outline" className="ml-1 text-[10px]">
                    Soon
                  </Badge>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <Label htmlFor="voice-category" className="sr-only">
            Content category
          </Label>
          <Select
            value={categoryId ?? "all"}
            onValueChange={(v) => setCategoryId(v === "all" ? null : (v as VoiceCategoryId))}
          >
            <SelectTrigger id="voice-category" className="w-[200px]">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {VOICE_CATEGORIES.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.icon} {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <VoiceLibraryGrid
        language={language}
        categoryId={categoryId}
        selectedId={spotlightId}
        favorites={favorites}
        recentIds={recents}
        loading={loading}
        getPreviewState={getPreviewState}
        onPreview={handlePreview}
        onSelect={handleSelect}
        onToggleFavorite={toggleFavorite}
        onToggleCompare={toggleCompare}
        onUseFallback={useFallback}
        inCompare={(id) => compareIds.includes(id)}
        compareFull={compareIds.length >= MAX_COMPARE}
      />

      {compareIds.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <AudioLines className="h-5 w-5" />
              Compare voices ({compareIds.length}/{MAX_COMPARE})
            </CardTitle>
            <CardDescription>
              Generate the same lines with each voice, then pick your narrator.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CompareTray
              characterIds={compareIds}
              languageCode={languageCode}
              onRemove={(id) => setCompareIds((prev) => prev.filter((c) => c !== id))}
              onUseVoice={(id) => {
                const char = voiceCharacter(id);
                if (char) handleSelect(char);
              }}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <BookmarkPlus className="h-5 w-5" />
            Voice profiles
          </CardTitle>
          <CardDescription>
            Save the currently spotlighted voice ({voiceCharacter(spotlightId)?.name}) as a
            reusable profile.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Input
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              placeholder="Profile name, e.g. Documentary narrator"
              maxLength={80}
              className="max-w-xs"
              aria-label="Profile name"
            />
            <Button onClick={handleSaveProfile} disabled={savingProfile} className="min-h-[44px]">
              {savingProfile && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save current voice
            </Button>
          </div>
          {profiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No profiles yet. Spotlight a voice above and save it here to reuse it in one tap.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border">
              {profiles.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{profileSummary(p.selection)}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleLoadProfile(p)}
                      className="min-h-[44px]"
                    >
                      Load
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void handleDeleteProfile(p.id)}
                      aria-label={`Delete profile ${p.name}`}
                      className="min-h-[44px] min-w-[44px]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
