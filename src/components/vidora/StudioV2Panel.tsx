import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronDown, Palette, Users, Mic, Music } from "lucide-react";
import { updateProjectSettings } from "@/lib/studio-v2.functions";
import { STUDIO_STYLES, type StudioStyleId } from "@/lib/styles";
import { useI18n } from "@/lib/i18n";
import { StylePicker } from "./StylePicker";
import { CharacterManager } from "./CharacterManager";
import { VoicePicker } from "./VoicePicker";
import { MusicPicker } from "./MusicPicker";
import { cn } from "@/lib/utils";

type ProjectSettings = {
  id: string;
  visual_style: string;
  music_track_id: string | null;
  music_volume: number;
  music_ducking: boolean;
  settings: unknown;
};

/**
 * P4 Studio v2 panel — style, characters, voice, music for a project.
 * Collapsible sections above the scene timeline.
 */
export function StudioV2Panel({ project }: { project: ProjectSettings }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const updateFn = useServerFn(updateProjectSettings);
  const [open, setOpen] = useState<string | null>("style");
  const [musicUrl, setMusicUrl] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      updateFn({ data: { id: project.id, ...patch } as never }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project", project.id] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const projectVoice = ((project.settings ?? {}) as { voiceId?: string }).voiceId ?? null;

  const sections = [
    {
      id: "style",
      icon: Palette,
      label: t("style"),
      content: (
        <StylePicker
          value={project.visual_style}
          onChange={(id: StudioStyleId) => save.mutate({ visual_style: id })}
        />
      ),
    },
    {
      id: "characters",
      icon: Users,
      label: t("characters"),
      content: <CharacterManager />,
    },
    {
      id: "voice",
      icon: Mic,
      label: t("voices"),
      content: (
        <VoicePicker
          value={projectVoice}
          onChange={(id) =>
            save.mutate({ settings: { ...(project.settings ?? {}), voiceId: id } })
          }
        />
      ),
    },
    {
      id: "music",
      icon: Music,
      label: t("music"),
      content: (
        <MusicPicker
          trackId={project.music_track_id}
          onSelectTrack={(id, url) => {
            setMusicUrl(url);
            save.mutate({ music_track_id: id });
          }}
          volume={project.music_volume}
          onVolumeChange={(v) => save.mutate({ music_volume: v })}
          ducking={project.music_ducking}
          onDuckingChange={(v) => save.mutate({ music_ducking: v })}
        />
      ),
    },
  ];

  return (
    <div className="surface-card p-4">
      <div className="mb-2 text-sm font-semibold">Studio v2</div>
      <div className="space-y-2">
        {sections.map((s) => (
          <div key={s.id} className="rounded-lg border">
            <button
              type="button"
              className="flex w-full items-center gap-2 p-3 text-left"
              onClick={() => setOpen(open === s.id ? null : s.id)}
            >
              <s.icon className="h-4 w-4" />
              <span className="text-sm font-medium">{s.label}</span>
              {s.id === "style" && (
                <span className="text-xs text-muted-foreground">
                  {STUDIO_STYLES.find((x) => x.id === project.visual_style)?.label ?? project.visual_style}
                </span>
              )}
              <ChevronDown
                className={cn("ml-auto h-4 w-4 transition", open === s.id && "rotate-180")}
              />
            </button>
            {open === s.id && <div className="border-t p-3">{s.content}</div>}
          </div>
        ))}
      </div>
      {musicUrl && <input type="hidden" data-music-url={musicUrl} />}
    </div>
  );
}
