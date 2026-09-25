import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Music, Play, Search } from "lucide-react";
import { listMusicTracks, searchMusic } from "@/lib/studio-v2.functions";
import { MUSIC_MOODS, type MusicMood } from "@/lib/music.server";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** P4 music picker — mood-based, Jamendo-backed, honest empty state. */
export function MusicPicker({
  trackId,
  onSelectTrack,
  volume,
  onVolumeChange,
  ducking,
  onDuckingChange,
}: {
  trackId: string | null;
  onSelectTrack: (id: string | null, downloadUrl: string | null) => void;
  volume: number;
  onVolumeChange: (v: number) => void;
  ducking: boolean;
  onDuckingChange: (v: boolean) => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const listFn = useServerFn(listMusicTracks);
  const searchFn = useServerFn(searchMusic);
  const [mood, setMood] = useState<MusicMood>("uplifting");
  const [playing, setPlaying] = useState<string | null>(null);

  const { data: tracks = [], isLoading } = useQuery({
    queryKey: ["music-tracks", mood],
    queryFn: () => listFn({ data: { mood } }),
  });

  const search = useMutation({
    mutationFn: () => searchFn({ data: { mood, limit: 12 } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["music-tracks", mood] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Search failed"),
  });

  return (
    <div className="space-y-3">
      <div>
        <Label>{t("music_mood")}</Label>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {MUSIC_MOODS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMood(m)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs capitalize",
                mood === m ? "border-primary bg-primary/10" : "border-border"
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">…</div>
      ) : tracks.length === 0 ? (
        <div className="rounded-lg border border-dashed p-4 text-center">
          <p className="text-sm text-muted-foreground">{t("no_music")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("connect_jamendo")}</p>
          <Button size="sm" className="mt-2" onClick={() => search.mutate()} disabled={search.isPending}>
            <Search className="mr-1 h-4 w-4" />
            {search.isPending ? t("searching_music") : t("search_music")}
          </Button>
        </div>
      ) : (
        <div className="max-h-48 space-y-1.5 overflow-y-auto">
          {tracks.map((tr) => (
            <div
              key={tr.id}
              className={cn(
                "flex items-center gap-2 rounded-lg border p-2",
                trackId === tr.id ? "border-primary" : "border-border"
              )}
            >
              <Music className="h-4 w-4 shrink-0 text-muted-foreground" />
              <button
                type="button"
                className="flex-1 text-left"
                onClick={() => onSelectTrack(trackId === tr.id ? null : tr.id, tr.preview_url)}
              >
                <div className="text-sm font-medium">{tr.title}</div>
                <div className="text-xs text-muted-foreground">
                  {tr.artist} · {tr.license}
                </div>
              </button>
              {tr.preview_url && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    if (playing === tr.id) {
                      setPlaying(null);
                      return;
                    }
                    setPlaying(tr.id);
                    const el = new Audio(tr.preview_url!);
                    el.onended = () => setPlaying(null);
                    el.play().catch(() => setPlaying(null));
                  }}
                  aria-label={`Preview ${tr.title}`}
                >
                  <Play className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <div>
        <Label>{t("music_volume")}</Label>
        <Slider
          value={[Math.round(volume * 100)]}
          onValueChange={([v]) => onVolumeChange((v ?? 15) / 100)}
          max={100}
          step={1}
          className="mt-2"
        />
      </div>
      <div className="flex items-center justify-between">
        <Label>{t("music_ducking")}</Label>
        <Switch checked={ducking} onCheckedChange={onDuckingChange} />
      </div>
    </div>
  );
}
