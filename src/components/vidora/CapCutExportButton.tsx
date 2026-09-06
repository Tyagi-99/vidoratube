import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Scene = { time?: string; visual?: string; caption?: string };

export type ExportableJob = {
  id: string;
  title: string | null;
  narration: string | null;
  script: string | null;
  voice: string | null;
  format: string | null;
  duration_seconds: number | null;
  audio_url: string | null;
  /** Final muxed MP4 when available — preferred over VO+stills zip-only. */
  result_url?: string | null;
  assets: unknown;
  scenes: unknown;
};

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "vidora-video"
  );
}

function timecode(seconds: number) {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
  const pad = (n: number, size = 2) => String(n).padStart(size, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function buildSrt(captions: string[], duration: number) {
  const per = duration / Math.max(1, captions.length);
  return captions
    .map((text, i) => {
      const start = i * per;
      const end = (i + 1) * per;
      return `${i + 1}\n${timecode(start)} --> ${timecode(end)}\n${text}\n`;
    })
    .join("\n");
}

/** Bundles voiceover, stills, captions and a shot list into a CapCut-ready zip. */
export function CapCutExportButton({
  job,
  size = "sm",
  variant = "outline",
  className,
}: {
  job: ExportableJob;
  size?: "sm" | "default";
  variant?: "outline" | "secondary" | "default";
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();

      const title = job.title ?? "Vidora video";
      const scenes = (Array.isArray(job.scenes) ? job.scenes : []) as Scene[];
      const images = (Array.isArray(job.assets) ? job.assets : []) as string[];
      const duration = job.duration_seconds ?? Math.max(15, scenes.length * 6);
      const captions = scenes.map((s, i) => s.caption?.trim() || `Scene ${i + 1}`);

      zip.file("narration.txt", job.narration ?? job.script ?? "");
      zip.file("captions.srt", buildSrt(captions, duration));
      zip.file(
        "shot-list.txt",
        scenes
          .map(
            (s, i) =>
              `Scene ${i + 1}${s.time ? ` (${s.time})` : ""}\nVisual: ${s.visual ?? "—"}\nCaption: ${s.caption ?? "—"}\n`,
          )
          .join("\n"),
      );
      zip.file(
        "README.txt",
        [
          `${title}`,
          `Format: ${job.format ?? "—"}   Voice: ${job.voice ?? "—"}   Approx. length: ${Math.round(duration)}s`,
          "",
          job.result_url
            ? "This package includes video.mp4 — the final muxed render from Vidora."
            : "This package has voiceover + stills (not a final MP4). Assemble in CapCut:",
          job.result_url
            ? "Import video.mp4 into CapCut for further edits, or use the Download button for the MP4 alone."
            : "1. New project -> import everything in /images and audio/narration.mp3.",
          job.result_url ? "" : "2. Drop narration.mp3 on the audio track first — it sets the total length.",
          job.result_url ? "" : "3. Lay the stills on the video track in order and stretch them evenly to fill the audio.",
          job.result_url ? "" : "4. Add a slow zoom (Ken Burns) to each still so nothing sits static.",
          job.result_url
            ? "captions.srt and shot-list.txt are included for reference."
            : "5. Captions -> Import captions -> pick captions.srt, then restyle to taste.",
          job.result_url ? "" : "6. Export 1080p / 30fps, then publish from Vidora or upload to YouTube.",
          "",
          "shot-list.txt holds the per-scene visual direction if you swap in your own footage.",
        ].join("\n"),
      );

      const fetchBinary = async (url: string) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Could not download an asset (${res.status})`);
        return res.arrayBuffer();
      };

      if (job.result_url) {
        zip.file("video.mp4", await fetchBinary(job.result_url));
      }

      if (job.audio_url) {
        zip.file("audio/narration.mp3", await fetchBinary(job.audio_url));
      }

      await Promise.all(
        images.map(async (url, i) => {
          zip.file(`images/scene-${String(i + 1).padStart(2, "0")}.png`, await fetchBinary(url));
        }),
      );

      const blob = await zip.generateAsync({ type: "blob" });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `${slugify(title)}-capcut.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      toast.success(job.result_url ? "CapCut package (with MP4) downloaded" : "CapCut package downloaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      size={size}
      variant={variant}
      className={className}
      onClick={download}
      disabled={busy}
      aria-label={`Download CapCut package for ${job.title ?? "video"}`}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      CapCut
    </Button>
  );
}
