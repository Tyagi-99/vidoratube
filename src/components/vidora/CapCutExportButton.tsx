import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatSrtTimecode } from "@/lib/srt";

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

/** Best-effort file extension from a fetch response, falling back to the URL. */
function extensionFor(res: Response, url: string) {
  const type = res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  const byType: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "audio/mpeg": "mp3",
  };
  if (type && byType[type]) return byType[type];
  const fromUrl = url.split("?")[0]?.split(".").pop()?.toLowerCase();
  if (fromUrl && /^[a-z0-9]{2,4}$/.test(fromUrl)) return fromUrl;
  return "bin";
}

function buildSrt(captions: string[], duration: number) {
  const per = duration / Math.max(1, captions.length);
  return captions
    .map((text, i) => {
      const start = i * per;
      const end = (i + 1) * per;
      return `${i + 1}\n${formatSrtTimecode(start)} --> ${formatSrtTimecode(end)}\n${text}\n`;
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

      // Browser tabs cannot hold multi-GB exports in memory: cap the total
      // bytes pulled in and report it clearly instead of crashing the tab.
      const MAX_EXPORT_BYTES = 500 * 1024 * 1024;
      let totalBytes = 0;

      const fetchBinary = async (url: string) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Could not download an asset (${res.status})`);
        // Reject a single oversized asset before its bytes hit tab memory.
        const declared = Number(res.headers.get("content-length"));
        if (Number.isFinite(declared) && declared > MAX_EXPORT_BYTES) {
          throw new Error(
            `This asset is ~${Math.round(declared / 1024 / 1024)} MB — too large to package in the browser tab. Export the MP4 alone instead.`,
          );
        }
        return { data: await res.arrayBuffer(), ext: extensionFor(res, url) };
      };

      const track = (bytes: number, what: string) => {
        totalBytes += bytes;
        if (totalBytes > MAX_EXPORT_BYTES) {
          throw new Error(
            `This package is over 500 MB of assets — too large to build in the browser tab (${what}). Export the MP4 alone instead.`,
          );
        }
      };

      const missing: string[] = [];

      if (job.result_url) {
        try {
          const { data } = await fetchBinary(job.result_url);
          track(data.byteLength, "video.mp4");
          zip.file("video.mp4", data);
        } catch (error) {
          missing.push(`video.mp4 (${error instanceof Error ? error.message : "failed"})`);
        }
      }

      if (job.audio_url) {
        try {
          const { data } = await fetchBinary(job.audio_url);
          track(data.byteLength, "audio/narration.mp3");
          zip.file("audio/narration.mp3", data);
        } catch (error) {
          missing.push(`audio/narration.mp3 (${error instanceof Error ? error.message : "failed"})`);
        }
      }

      // One failed still must not kill the whole package.
      const imageResults = await Promise.allSettled(
        images.map(async (url, i) => {
          const { data, ext } = await fetchBinary(url);
          track(data.byteLength, `images/scene-${i + 1}`);
          return { data, ext, i };
        }),
      );
      for (const r of imageResults) {
        if (r.status === "fulfilled") {
          const { data, ext, i } = r.value;
          zip.file(`images/scene-${String(i + 1).padStart(2, "0")}.${ext}`, data);
        } else {
          missing.push(`images/scene (download failed: ${r.reason instanceof Error ? r.reason.message : "failed"})`);
        }
      }

      if (missing.length > 0) {
        zip.file(
          "MISSING-ASSETS.txt",
          ["The following assets could not be downloaded and are missing from this package:", ""]
            .concat(missing.map((m) => `- ${m}`))
            .join("\n"),
        );
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `${slugify(title)}-capcut.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      if (missing.length > 0) {
        toast.success("CapCut package downloaded", {
          description: `${missing.length} asset${missing.length === 1 ? "" : "s"} could not be downloaded — see MISSING-ASSETS.txt in the zip.`,
        });
      } else {
        toast.success(job.result_url ? "CapCut package (with MP4) downloaded" : "CapCut package downloaded");
      }
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
