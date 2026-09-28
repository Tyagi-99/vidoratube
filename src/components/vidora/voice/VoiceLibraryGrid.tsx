/**
 * Voice character library grid (Stream C).
 *
 * Tabs: Recommended (topVoices re-rank for the active category) / All /
 * Favorites / Recent (localStorage). Search across name, description and
 * tags; filters for gender, energy (via personality tags) and use-case
 * (content category). Cards are horizontally swipeable with scroll-snap
 * on mobile. "My Voices" links out to the existing /voices Voice Studio —
 * it is not rebuilt here.
 */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AudioLines, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  charactersForLanguage,
  recommendVoices,
  topVoices,
  voiceCategory,
  VOICE_CATEGORIES,
} from "@/lib/voice-intel";
import type {
  RankedVoice,
  VoiceCategoryId,
  VoiceCharacter,
  VoiceLanguage,
} from "@/lib/voice-intel/types";
import { VoiceCharacterCard, type VoiceCharacterCardProps } from "./VoiceCharacterCard";
import type { VoicePreviewState } from "./useVoicePreview";

const ENERGETIC_TAGS = new Set([
  "energetic",
  "punchy",
  "fast",
  "upbeat",
  "lively",
  "expressive",
  "attention-grabbing",
]);
const CALM_TAGS = new Set([
  "calm",
  "soft",
  "soothing",
  "gentle",
  "warm",
  "relaxed",
  "natural",
]);

export type LibraryTab = "recommended" | "all" | "favorites" | "recent";

interface VoiceLibraryGridProps {
  language: VoiceLanguage;
  categoryId: VoiceCategoryId | null;
  selectedId: string;
  favorites: Set<string>;
  recentIds: string[];
  loading: boolean;
  getPreviewState: (characterId: string) => VoicePreviewState;
  onPreview: (character: VoiceCharacter) => void;
  onSelect: (character: VoiceCharacter) => void;
  onToggleFavorite: (characterId: string) => void;
  onToggleCompare: (characterId: string) => void;
  onUseFallback: (fallbackCharacterId: string) => void;
  inCompare: (characterId: string) => boolean;
  compareFull: boolean;
}

export function VoiceLibraryGrid({
  language,
  categoryId,
  selectedId,
  favorites,
  recentIds,
  loading,
  getPreviewState,
  onPreview,
  onSelect,
  onToggleFavorite,
  onToggleCompare,
  onUseFallback,
  inCompare,
  compareFull,
}: VoiceLibraryGridProps) {
  const [tab, setTab] = useState<LibraryTab>("recommended");
  const [query, setQuery] = useState("");
  const [gender, setGender] = useState<"all" | VoiceCharacter["gender"]>("all");
  const [energy, setEnergy] = useState<"all" | "energetic" | "calm">("all");
  const [useCase, setUseCase] = useState<"all" | VoiceCategoryId>("all");

  const ranked = useMemo<RankedVoice[]>(
    () =>
      recommendVoices({
        languageCode: language.code,
        categoryId,
        limit: 40,
      }),
    [language.code, categoryId],
  );
  const recommendedIds = useMemo(
    () => new Set(topVoices(language.code, categoryId).map((r) => r.character.id)),
    [language.code, categoryId],
  );
  const rankById = useMemo(
    () => new Map(ranked.map((r) => [r.character.id, r])),
    [ranked],
  );

  const characters = useMemo(() => {
    let pool: VoiceCharacter[];
    switch (tab) {
      case "recommended":
        pool = ranked.map((r) => r.character);
        break;
      case "favorites":
        pool = ranked.map((r) => r.character).filter((c) => favorites.has(c.id));
        break;
      case "recent": {
        const byId = new Map(ranked.map((r) => [r.character.id, r.character]));
        pool = recentIds
          .map((id) => byId.get(id))
          .filter((c): c is VoiceCharacter => Boolean(c));
        break;
      }
      case "all":
      default:
        pool = charactersForLanguage(language.code);
    }

    const q = query.trim().toLowerCase();
    return pool.filter((c) => {
      if (gender !== "all" && c.gender !== gender) return false;
      if (energy === "energetic" && !c.personalityTags.some((t) => ENERGETIC_TAGS.has(t)))
        return false;
      if (energy === "calm" && !c.personalityTags.some((t) => CALM_TAGS.has(t))) return false;
      if (useCase !== "all" && !c.categoryTags.includes(useCase)) return false;
      if (!q) return true;
      const hay = `${c.name} ${c.description} ${c.personalityTags.join(" ")} ${c.recommendedFor.join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [tab, ranked, favorites, recentIds, language.code, gender, energy, useCase, query]);

  const cardProps = (character: VoiceCharacter): Partial<VoiceCharacterCardProps> => {
    const reasons = rankById.get(character.id)?.reasons;
    return reasons ? { reasons } : {};
  };

  const renderCards = () => {
    if (loading) {
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-64 w-full rounded-xl" />
          ))}
        </div>
      );
    }
    if (characters.length === 0) {
      return (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {tab === "favorites"
            ? "No favorites yet — tap the star on any voice to save it here."
            : tab === "recent"
              ? "No recently used voices yet."
              : "No voices match these filters."}
        </div>
      );
    }
    return (
      <div className="grid snap-x snap-mandatory grid-flow-col auto-cols-[minmax(260px,85%)] gap-3 overflow-x-auto pb-2 sm:grid-flow-row sm:auto-cols-auto sm:grid-cols-2 sm:overflow-visible lg:grid-cols-3">
        {characters.map((character) => (
          <VoiceCharacterCard
            key={character.id}
            character={character}
            language={language}
            selected={character.id === selectedId}
            isRecommended={recommendedIds.has(character.id)}
            isFavorite={favorites.has(character.id)}
            inCompare={inCompare(character.id)}
            compareDisabled={compareFull && !inCompare(character.id)}
            previewState={getPreviewState(character.id)}
            onPreview={() => onPreview(character)}
            onSelect={() => onSelect(character)}
            onToggleFavorite={() => onToggleFavorite(character.id)}
            onToggleCompare={() => onToggleCompare(character.id)}
            onUseFallback={onUseFallback}
            {...cardProps(character)}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as LibraryTab)}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="recommended">Recommended</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="favorites">
              Favorites{favorites.size > 0 ? ` (${favorites.size})` : ""}
            </TabsTrigger>
            <TabsTrigger value="recent">Recent</TabsTrigger>
          </TabsList>
          <Link
            to="/voices"
            className={cn(
              "inline-flex min-h-[44px] items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
            )}
          >
            <AudioLines className="h-4 w-4" />
            My Voices
          </Link>
        </div>

        <div className="grid gap-3 pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative sm:col-span-2 lg:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search voices, traits, use cases…"
              className="min-h-[44px] pl-9"
              aria-label="Search voices"
            />
          </div>
          <div className="space-y-1">
            <Label className="sr-only" htmlFor="voice-filter-gender">Gender</Label>
            <Select value={gender} onValueChange={(v) => setGender(v as typeof gender)}>
              <SelectTrigger id="voice-filter-gender" className="min-h-[44px]">
                <SelectValue placeholder="Gender" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All genders</SelectItem>
                <SelectItem value="masculine">Male</SelectItem>
                <SelectItem value="feminine">Female</SelectItem>
                <SelectItem value="neutral">Neutral</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="sr-only" htmlFor="voice-filter-energy">Energy</Label>
            <Select value={energy} onValueChange={(v) => setEnergy(v as typeof energy)}>
              <SelectTrigger id="voice-filter-energy" className="min-h-[44px]">
                <SelectValue placeholder="Energy" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any energy</SelectItem>
                <SelectItem value="energetic">Energetic</SelectItem>
                <SelectItem value="calm">Calm</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2 lg:col-span-4">
            <Label className="sr-only" htmlFor="voice-filter-usecase">Use case</Label>
            <Select value={useCase} onValueChange={(v) => setUseCase(v as typeof useCase)}>
              <SelectTrigger id="voice-filter-usecase" className="min-h-[44px]">
                <SelectValue placeholder="Use case" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All use cases</SelectItem>
                {VOICE_CATEGORIES.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.icon} {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <TabsContent value="recommended" className="mt-4">
          {categoryId && voiceCategory(categoryId) && (
            <p className="mb-3 text-xs text-muted-foreground">
              Ranked for {voiceCategory(categoryId)?.icon} {voiceCategory(categoryId)?.label} —{" "}
              {voiceCategory(categoryId)?.blurb}
            </p>
          )}
          {renderCards()}
        </TabsContent>
        <TabsContent value="all" className="mt-4">{renderCards()}</TabsContent>
        <TabsContent value="favorites" className="mt-4">{renderCards()}</TabsContent>
        <TabsContent value="recent" className="mt-4">{renderCards()}</TabsContent>
      </Tabs>
    </div>
  );
}
