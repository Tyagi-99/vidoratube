import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useSession } from "@/hooks/useSession";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Check, Download, Loader2, RotateCcw, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { CapCutExportButton } from "@/components/vidora/CapCutExportButton";
import { supabase } from "@/integrations/supabase/client";

import {
  createVideoJob,
  advanceVideoJob,
  finalizeVideoJob,
  failVideoJobCompose,
} from "@/lib/jobs.functions";
import {
  isFinalVideoReady,
  needsClientCompose,
  selectDownloadUrl,
} from "@/lib/jobs/final-video";
import { toast } from "sonner";

const PIPELINE = [
  { label: "Writing narration", at: 22 },
  { label: "Recording voiceover", at: 45 },
  { label: "Generating footage", at: 70 },
  { label: "Composing the cut", at: 100 },
];

type JobResult = {
  id: string;
  title: string;
  status: string;
  stage: string;
  step: string | null;
  progress: number | null;
  error: string | null;
  duration_seconds: number | null;
  result_url: string | null;
  thumbnail_url: string | null;
  audio_url: string | null;
  narration: string | null;
  script?: string | null;
  voice?: string | null;
  format?: string | null;
  assets?: unknown;
  scenes?: unknown;
};

function formatDuration(seconds: number | null) {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function GenerateVideoDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [script, setScript] = useState("");
  const [voice, setVoice] = useState("deneb");
  const [format, setFormat] = useState("documentary");
  const [stepLabel, setStepLabel] = useState("Writing narration");
  const [progress, setProgress] = useState(0);
  const [showPercent, setShowPercent] = useState(true);
  const [result, setResult] = useState<JobResult | null>(null);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [pendingComposeJob, setPendingComposeJob] = useState<JobResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { user, loading: sessionLoading } = useSession();
  const queryClient = useQueryClient();

  const create = useServerFn(createVideoJob);
  const advance = useServerFn(advanceVideoJob);
  const finalize = useServerFn(finalizeVideoJob);
  const failCompose = useServerFn(failVideoJobCompose);

  const runClientCompose = async (job: JobResult): Promise<JobResult> => {
    if (!user) throw new Error("Sign in to finish rendering.");
    const images = (Array.isArray(job.assets) ? job.assets : []).filter(
      (u): u is string => typeof u === "string" && u.length > 0,
    );
    if (!job.audio_url || images.length === 0) {
      throw new Error("Voiceover or scene visuals are missing — cannot compose the MP4.");
    }

    const scenes = (Array.isArray(job.scenes) ? job.scenes : []) as { caption?: string }[];
    const captions = scenes.map((s, i) => s.caption?.trim() || `Scene ${i + 1}`);

    setShowPercent(false);
    setStepLabel("Composing the cut");
    setProgress(75);
    setComposeError(null);
    setPendingComposeJob(job);

    const controller = new AbortController();
    abortRef.current = controller;

    const { composeQuickJobMp4 } = await import("@/lib/render/quick-job-compose");
    const output = await composeQuickJobMp4({
      title: job.title || "Vidora video",
      images,
      audioUrl: job.audio_url,
      captions,
      durationSeconds: job.duration_seconds ?? Math.max(15, images.length * 6),
      signal: controller.signal,
      onProgress: (p) => {
        setStepLabel(p.label);
        // Stage labels only — no fabricated overall % during browser compose
        setShowPercent(false);
      },
    });

    setStepLabel("Saving final video");
    const storagePath = `${user.id}/${job.id}/video.mp4`;
    const upload = await supabase.storage
      .from("generated-videos")
      .upload(storagePath, output.blob, { contentType: "video/mp4", upsert: true });
    if (upload.error) {
      throw new Error(`Saving the MP4 failed: ${upload.error.message}`);
    }

    const finalized = (await finalize({
      data: {
        id: job.id,
        path: storagePath,
        file_size: output.blob.size,
        duration: output.duration,
        width: output.width,
        height: output.height,
      },
    })) as JobResult;

    abortRef.current = null;
    setPendingComposeJob(null);
    setShowPercent(true);
    return finalized;
  };

  const mutation = useMutation({
    mutationFn: async () => {
      setStepLabel("Writing narration");
      setProgress(8);
      setShowPercent(true);
      setComposeError(null);
      setPendingComposeJob(null);

      let job = (await create({ data: { script, voice, format } })) as JobResult;
      setProgress(job.progress ?? 20);
      setStepLabel(job.step ?? "Recording voiceover");

      for (let i = 0; i < 90 && job.status === "running"; i++) {
        if (needsClientCompose(job)) {
          try {
            job = await runClientCompose(job);
          } catch (err) {
            const message = err instanceof Error ? err.message : "Compose failed";
            try {
              job = (await failCompose({ data: { id: job.id, error: message } })) as JobResult;
            } catch {
              job = {
                ...job,
                status: "failed",
                stage: "failed",
                step: "Failed",
                error: message,
              };
            }
            throw new Error(message);
          }
          break;
        }

        job = (await advance({ data: { id: job.id } })) as JobResult;
        setProgress(job.progress ?? 0);
        setStepLabel(job.step ?? "Working");
        setShowPercent(true);

        if (needsClientCompose(job)) {
          continue;
        }
        if (job.status === "running") await sleep(job.stage === "rendering" ? 4000 : 400);
      }

      if (job.status === "failed") throw new Error(job.error ?? "Render failed");
      if (!isFinalVideoReady(job)) {
        throw new Error("Render finished without a final MP4. Please retry.");
      }
      return job;
    },
    onSuccess: (job) => {
      setProgress(100);
      setShowPercent(true);
      setResult(job);
      setComposeError(null);
      setPendingComposeJob(null);
      queryClient.invalidateQueries();
    },
    onError: (error: Error) => {
      setProgress(0);
      setComposeError(error.message || "Render failed");
      queryClient.invalidateQueries();
      toast.error(error.message || "Render failed");
    },
  });

  const retryCompose = useMutation({
    mutationFn: async () => {
      const job = pendingComposeJob;
      if (!job) throw new Error("Nothing to retry.");
      return runClientCompose(job);
    },
    onSuccess: (job) => {
      setProgress(100);
      setResult(job);
      setComposeError(null);
      setPendingComposeJob(null);
      queryClient.invalidateQueries();
      toast.success("Your MP4 is ready");
    },
    onError: (error: Error) => {
      setComposeError(error.message || "Compose failed");
      toast.error(error.message || "Compose failed");
    },
  });

  const reset = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setResult(null);
    setProgress(0);
    setShowPercent(true);
    setScript("");
    setComposeError(null);
    setPendingComposeJob(null);
    mutation.reset();
    retryCompose.reset();
  };

  const ready = result && isFinalVideoReady(result);
  const downloadUrl = result ? selectDownloadUrl(result) : null;
  const status = ready
    ? "done"
    : mutation.isPending || retryCompose.isPending
      ? "generating"
      : composeError
        ? "failed"
        : "idle";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !mutation.isPending && !retryCompose.isPending) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold tracking-tight">
            {status === "done"
              ? "Your video is ready"
              : status === "failed"
                ? "Render failed"
                : "Make a video"}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Paste your script, pick a voice and format, and Vidora assembles the cut. Each render
            uses one credit.
          </DialogDescription>
        </DialogHeader>

        {!sessionLoading && !user ? (
          <div className="space-y-4 py-6 text-center">
            <p className="text-muted-foreground">
              Create a free account to render videos and keep them in your studio.
            </p>
            <Link
              to="/auth"
              onClick={() => onOpenChange(false)}
              className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              Sign in or create account
            </Link>
          </div>
        ) : status === "done" && result && downloadUrl ? (
          <div className="space-y-6 py-4">
            <div className="relative overflow-hidden rounded-2xl border border-border bg-muted">
              <video
                src={downloadUrl}
                poster={result.thumbnail_url ?? undefined}
                controls
                className="aspect-video w-full bg-black"
              />
            </div>
            {result.audio_url && (
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="mb-2 text-sm font-medium text-foreground">Voiceover</p>
                <audio src={result.audio_url} controls className="w-full" />
              </div>
            )}
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-foreground">{result.title}</p>
                  <p className="text-sm text-muted-foreground">
                    1080p · {formatDuration(result.duration_seconds)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <CapCutExportButton
                    job={{
                      id: result.id,
                      title: result.title,
                      narration: result.narration,
                      script: result.script ?? null,
                      voice: result.voice ?? null,
                      format: result.format ?? null,
                      duration_seconds: result.duration_seconds,
                      audio_url: result.audio_url,
                      result_url: result.result_url,
                      assets: result.assets,
                      scenes: result.scenes,
                    }}
                    size="default"
                    variant="outline"
                    className="gap-2"
                  />
                  <Button asChild className="gap-2">
                    <a href={downloadUrl} target="_blank" rel="noreferrer" download>
                      <Download className="h-4 w-4" />
                      Download
                    </a>
                  </Button>
                </div>
              </div>
            </div>

            {result.narration && (
              <div className="max-h-40 overflow-y-auto rounded-xl border border-border bg-muted/50 p-4 text-sm leading-relaxed text-muted-foreground">
                {result.narration}
              </div>
            )}

            <div className="flex gap-3">
              <Button onClick={reset} variant="outline" className="flex-1">
                Make another
              </Button>
              <Button onClick={() => onOpenChange(false)} className="flex-1">
                Done
              </Button>
            </div>
          </div>
        ) : status === "generating" ? (
          <div className="space-y-6 py-8">
            <div className="flex items-center justify-center">
              <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">{stepLabel}</span>
                {showPercent ? (
                  <span className="text-muted-foreground">{Math.round(progress)}%</span>
                ) : (
                  <span className="text-muted-foreground">Working…</span>
                )}
              </div>
              {showPercent ? (
                <Progress value={progress} className="h-2" />
              ) : (
                <div className="h-2 w-full overflow-hidden rounded-full bg-primary/20">
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
                </div>
              )}
            </div>
            <div className="space-y-3">
              {PIPELINE.map((step) => {
                const done = showPercent ? progress >= step.at : step.label !== "Composing the cut" && progress >= step.at;
                const active =
                  step.label === stepLabel ||
                  (!done && showPercent && progress >= step.at - 22);
                return (
                  <div
                    key={step.label}
                    className={cn(
                      "flex items-center gap-3 text-sm transition-colors",
                      done ? "text-foreground" : active ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-5 w-5 items-center justify-center rounded-full border text-xs",
                        done
                          ? "border-primary bg-primary text-primary-foreground"
                          : active
                            ? "border-primary text-primary"
                            : "border-border",
                      )}
                    >
                      {done ? <Check className="h-3 w-3" /> : active ? <Loader2 className="h-3 w-3 animate-spin" /> : ""}
                    </div>
                    {step.label}
                  </div>
                );
              })}
            </div>
          </div>
        ) : status === "failed" ? (
          <div className="space-y-6 py-6">
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4">
              <p className="text-sm font-medium text-destructive">
                {composeError ?? "Render failed"}
              </p>
            </div>
            <div className="flex gap-3">
              {pendingComposeJob ? (
                <Button
                  className="flex-1 gap-2"
                  onClick={() => retryCompose.mutate()}
                  disabled={retryCompose.isPending}
                >
                  <RotateCcw className="h-4 w-4" />
                  Retry compose
                </Button>
              ) : (
                <Button className="flex-1 gap-2" onClick={() => mutation.mutate()}>
                  <RotateCcw className="h-4 w-4" />
                  Try again
                </Button>
              )}
              <Button variant="outline" className="flex-1" onClick={reset}>
                Start over
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-5 py-4">
            <div className="space-y-2">
              <Label htmlFor="script">Your script</Label>
              <Textarea
                id="script"
                placeholder="Paste your script here. Any topic, any length, any language..."
                value={script}
                onChange={(e) => setScript(e.target.value)}
                maxLength={12000}
                className="min-h-[140px] resize-none"
              />
              <p className="text-xs text-muted-foreground">
                {script.trim().length < 20
                  ? "At least 20 characters."
                  : `${script.trim().split(/\s+/).length} words`}
              </p>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Voice</Label>
                <Select value={voice} onValueChange={setVoice}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a voice" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deneb">Deneb · EN</SelectItem>
                    <SelectItem value="sirius">Sirius · EN</SelectItem>
                    <SelectItem value="vega">Vega · ES</SelectItem>
                    <SelectItem value="altair">Altair · FR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Format</Label>
                <Select value={format} onValueChange={setFormat}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a format" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="documentary">Documentary</SelectItem>
                    <SelectItem value="listicle">Listicle</SelectItem>
                    <SelectItem value="finance">Finance</SelectItem>
                    <SelectItem value="history">History</SelectItem>
                    <SelectItem value="sleep">Sleep story</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button
              onClick={() => mutation.mutate()}
              disabled={script.trim().length < 20}
              className="w-full gap-2"
            >
              <Wand2 className="h-4 w-4" />
              Generate video
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
