import { useCallback, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useSession } from "@/hooks/useSession";
import { isAppUser } from "@/lib/auth-user";
import { CreateSurface } from "@/components/vidora/CreateSurface";
import { useRenderGuard } from "@/lib/render/useRenderGuard";

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
import { Check, Loader2, RotateCcw, Wand2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FinalVideoPreview } from "@/components/vidora/FinalVideoPreview";
import { supabase } from "@/integrations/supabase/client";

import {
  createVideoJob,
  advanceVideoJob,
  finalizeVideoJob,
  failVideoJobCompose,
} from "@/lib/jobs.functions";
import { isFinalVideoReady, needsClientCompose } from "@/lib/jobs/final-video";
import { getDeviceHash } from "@/lib/device";
import { track } from "@/lib/analytics";
import { captureError } from "@/lib/sentry";
import { toast } from "sonner";

import { STORY_BEATS } from "@/lib/story-template";
import { AspectRatioSelect, type AspectRatio } from "@/components/vidora/aspect-ratio-select";
import { estimateNarrationSeconds, formatClock } from "@/lib/narration-estimate";
import { VoiceLanguageSection } from "@/components/vidora/voice/VoiceLanguageSection";
import {
  FALLBACK_VOICE_SELECTION,
  resolveDialogVoiceKey,
} from "@/components/vidora/voice/dialog-voice-mapping";
import type { VoiceSelection } from "@/lib/voice-intel/types";
import { getVoiceProviderStatus } from "@/lib/voice-intel/voice-intel.functions";

/** Target-length presets (seconds); "auto" follows the script's natural length. */
const TARGET_DURATIONS = [
  { value: "auto", label: "Auto (script length)" },
  { value: "30", label: "30 seconds" },
  { value: "60", label: "1 minute" },
  { value: "90", label: "1:30 minutes" },
  { value: "180", label: "3 minutes" },
  { value: "300", label: "5 minutes" },
  { value: "600", label: "10 minutes" },
] as const;

const PIPELINE = [
  { label: "Writing narration", at: 22 },
  { label: "Recording voiceover", at: 45 },
  { label: "Generating stills", at: 70 },
  { label: "Composing final MP4 in this tab", at: 100 },
];

const SAMPLE_SCRIPT =
  "In April 1949 the frigate HMS Amethyst steamed up the Yangtze toward Nanking. The crew thought they were on a routine resupply. They were sailing into the longest single-ship chase of the twentieth century.";

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function GenerateVideoDialog({
  open,
  onOpenChange,
  asPage = false,
  storyMode = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asPage?: boolean;
  /** Story Mode: the 5-beat narrative template shapes the plan and the compose. */
  storyMode?: boolean;
}) {
  const [script, setScript] = useState("");
  // Voice & Language section owns the full VoiceSelection; the dialog only
  // keeps the latest value to wire into job creation.
  const [voiceSelection, setVoiceSelection] = useState<VoiceSelection | null>(null);
  const handleVoiceSelectionChange = useCallback((s: VoiceSelection) => {
    setVoiceSelection(s);
  }, []);
  const [format, setFormat] = useState("documentary");
  const [aspect, setAspect] = useState<AspectRatio>("16:9");
  const [targetDuration, setTargetDuration] = useState<string>("auto");
  const [stepLabel, setStepLabel] = useState("Writing narration");
  const [progress, setProgress] = useState(0);
  const [showPercent, setShowPercent] = useState(true);
  const [result, setResult] = useState<JobResult | null>(null);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [pendingComposeJob, setPendingComposeJob] = useState<JobResult | null>(null);
  // A job that hit the polling cap while still running — resumable against
  // the same job id instead of burning a new credit on a fresh job.
  const [resumableJob, setResumableJob] = useState<JobResult | null>(null);

  // Keep the tab alive and warn before closing while the compose is running.
  useRenderGuard(pendingComposeJob != null);
  const abortRef = useRef<AbortController | null>(null);
  // Set by the Cancel button; the drive loop checks it between iterations.
  const cancelLoopRef = useRef(false);
  // Job id of the in-flight render, for error analytics.
  const activeJobIdRef = useRef<string | null>(null);

  const { user, loading: sessionLoading } = useSession();
  const queryClient = useQueryClient();

  const create = useServerFn(createVideoJob);
  const advance = useServerFn(advanceVideoJob);
  const finalize = useServerFn(finalizeVideoJob);
  const failCompose = useServerFn(failVideoJobCompose);
  const voiceProviderStatus = useServerFn(getVoiceProviderStatus);

  // Real TTS provider readiness from the backend — the Voice & Language
  // mapping derives fallback honesty from this instead of assuming.
  const providerQuery = useQuery({
    queryKey: ["voice-provider-status"],
    queryFn: () => voiceProviderStatus(),
    enabled: !sessionLoading && !!user,
    staleTime: 5 * 60 * 1000,
  });
  const elevenLabsReady =
    providerQuery.data?.providers.some(
      (p) => p.id === "elevenlabs" && p.configured,
    ) ?? false;

  const runClientCompose = async (job: JobResult): Promise<JobResult> => {
    if (!user) throw new Error("Sign in to finish rendering.");
    const images = (Array.isArray(job.assets) ? job.assets : []).filter(
      (u): u is string => typeof u === "string" && u.length > 0,
    );
    if (!job.audio_url || images.length === 0) {
      throw new Error("Voiceover or scene visuals are missing — cannot compose the MP4.");
    }

    const scenes = (Array.isArray(job.scenes) ? job.scenes : []) as { caption?: string }[];
    const captions = scenes.map((s) => (s.caption ?? "").trim());

    setShowPercent(false);
    setStepLabel("Composing final MP4 in this tab");
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
      narration: job.narration || job.script || "",
      durationSeconds: job.duration_seconds ?? Math.max(15, images.length * 6),
      aspect,
      storyMode,
      runKey: `job:${job.id}`,
      signal: controller.signal,
      onProgress: (p) => {
        setStepLabel(p.label);
        // Stage labels only — no fabricated overall % during browser compose
        setShowPercent(false);
      },
    });

    setStepLabel("Saving final video");
    // Don't upload/finalize after the user cancelled the compose.
    if (controller.signal.aborted) throw new Error("Render cancelled");
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

  // Drives an existing job (fresh or resumed) through the server pipeline and
  // the client-side compose. Bounded iterations; cancelling fails the job
  // server-side so it never sits at "running" forever.
  const driveJob = async (startJob: JobResult): Promise<JobResult> => {
    let job = startJob;

    const failCancelled = async () => {
      try {
        await failCompose({ data: { id: job.id, error: "Render cancelled" } });
      } catch {
        /* already resolved — nothing to fail */
      }
      throw new Error("Render cancelled");
    };

    for (let i = 0; i < 90 && job.status === "running"; i++) {
      if (cancelLoopRef.current) await failCancelled();

      if (needsClientCompose(job)) {
        try {
          job = await runClientCompose(job);
        } catch (err) {
          if (cancelLoopRef.current) {
            // User-cancelled compose: leave the job resumable (segments stay
            // cached under the job run key) instead of marking it failed.
            throw new Error("Render cancelled");
          }
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
      if (cancelLoopRef.current) await failCancelled();
      if (job.status === "running") await sleep(job.stage === "rendering" ? 4000 : 400);
    }

    if (job.status === "failed") throw new Error(job.error ?? "Render failed");
    if (!isFinalVideoReady(job)) {
      if (job.status === "running") {
        // The server job may still be working — keep it resumable against
        // the same job id instead of forcing a brand-new (paid) job.
        setResumableJob(job);
        throw new Error("Still rendering — resume instead of starting over.");
      }
      throw new Error("Render finished without a final MP4. Please retry.");
    }
    return job;
  };

  const handleDriveSuccess = (job: JobResult) => {
    setProgress(100);
    setShowPercent(true);
    setResult(job);
    setComposeError(null);
    setPendingComposeJob(null);
    setResumableJob(null);
    track("render_succeeded", { job_id: job.id, mode: "script" });
    queryClient.invalidateQueries({ queryKey: ["my-jobs"] });
  };

  const handleDriveError = (error: Error) => {
    setProgress(0);
    setComposeError(error.message || "Render failed");
    const jobId = activeJobIdRef.current;
    if (jobId) {
      track("render_failed", { job_id: jobId, mode: "script" });
      captureError(error, { job_id: jobId });
    }
    activeJobIdRef.current = null;
    queryClient.invalidateQueries({ queryKey: ["my-jobs"] });
    toast.error(error.message || "Render failed");
  };

  const mutation = useMutation({
    mutationFn: async () => {
      setStepLabel("Writing narration");
      setProgress(8);
      setShowPercent(true);
      setComposeError(null);
      setPendingComposeJob(null);
      setResumableJob(null);
      cancelLoopRef.current = false;

      const job = (await create({
        data: {
          script,
          // The Voice & Language section resolves the selection onto a
          // legacy pipeline key explicitly (never silent): unmapped
          // characters carry an honest fallback note in the summary panel.
          // elevenLabsReady comes from the backend — no hardcoded assumption.
          voice: resolveDialogVoiceKey(
            voiceSelection ?? FALLBACK_VOICE_SELECTION,
            elevenLabsReady,
          ).legacyKey,
          // D328: the full Voice Intelligence selection travels with the job
          // so the TTS stage honors language + character + model + settings.
          voice_config: voiceSelection ?? FALLBACK_VOICE_SELECTION,
          format,
          story_mode: storyMode,
          aspect_ratio: aspect,
          target_duration_seconds:
            targetDuration === "auto" ? undefined : Number(targetDuration),
          // Fresh UUID per submit click: a double-click or network retry with
          // the same key returns the already-created job instead of charging
          // a second credit.
          idempotency_key: crypto.randomUUID(),
          device_hash: getDeviceHash(),
        },
      })) as JobResult;
      activeJobIdRef.current = job.id;
      track("render_started", { job_id: job.id, mode: storyMode ? "story" : "script" });
      setProgress(job.progress ?? 20);
      setStepLabel(job.step ?? "Recording voiceover");
      return driveJob(job);
    },
    onSuccess: handleDriveSuccess,
    onError: handleDriveError,
  });

  const resume = useMutation({
    mutationFn: async () => {
      const job = resumableJob;
      if (!job) throw new Error("Nothing to resume.");
      cancelLoopRef.current = false;
      setComposeError(null);
      setProgress(job.progress ?? 0);
      setStepLabel(job.step ?? "Working");
      return driveJob(job);
    },
    onSuccess: handleDriveSuccess,
    onError: handleDriveError,
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
      setResumableJob(null);
      queryClient.invalidateQueries({ queryKey: ["my-jobs"] });
      toast.success("Your MP4 is ready");
    },
    onError: (error: Error) => {
      setComposeError(error.message || "Compose failed");
      toast.error(error.message || "Compose failed");
    },
  });

  const reset = () => {
    cancelLoopRef.current = true;
    abortRef.current?.abort();
    abortRef.current = null;
    setResult(null);
    setProgress(0);
    setShowPercent(true);
    setScript("");
    setAspect("16:9");
    setTargetDuration("auto");
    setComposeError(null);
    setPendingComposeJob(null);
    setResumableJob(null);
    mutation.reset();
    retryCompose.reset();
    resume.reset();
    cancelLoopRef.current = false;
  };

  const cancelRender = () => {
    cancelLoopRef.current = true;
    abortRef.current?.abort();
  };

  const ready = result && isFinalVideoReady(result);
  const status = ready
    ? "done"
    : mutation.isPending || retryCompose.isPending || resume.isPending
      ? "generating"
      : composeError
        ? "failed"
        : "idle";

  const signedIn = isAppUser(user);

  return (
    <CreateSurface
      asPage={asPage}
      open={open}
      onOpenChange={(next) => {
        if (!next && !mutation.isPending && !retryCompose.isPending && !resume.isPending) reset();
        onOpenChange(next);
      }}
      title={
        status === "done"
          ? "Your video is ready"
          : status === "failed"
            ? "Render failed"
            : storyMode
              ? "Story Mode"
              : "Make a video"
      }
      description={
        storyMode
          ? "Paste a script — Vidora structures it as hook → setup → rising tension → payoff → loop, and the pacing, captions and music follow the beats. 1 credit = 1 finished minute."
          : "Paste a script, pick a voice, and Vidora writes narration, generates scene stills, and muxes a 1080p MP4 in this tab. 1 credit = 1 finished minute."
      }
    >
      {!sessionLoading && !signedIn ? (
        <div className="space-y-4 py-6 text-center">
          <p className="text-muted-foreground">
            Create a free account to render videos and keep them in your studio.
          </p>
          <Link
            to="/auth"
            search={{ next: "/studio?create=script" }}
            onClick={() => onOpenChange(false)}
            className="inline-flex items-center justify-center rounded-[10px] bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            Sign in or create account
          </Link>
        </div>
      ) : status === "done" && result ? (
        <FinalVideoPreview job={result} onMakeAnother={reset} onDone={() => onOpenChange(false)} />
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
              const done = showPercent
                ? progress >= step.at
                : step.label !== "Composing final MP4 in this tab" && progress >= step.at;
              const active =
                step.label === stepLabel || (!done && showPercent && progress >= step.at - 22);
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
                    {done ? (
                      <Check className="h-3 w-3" />
                    ) : active ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      ""
                    )}
                  </div>
                  {step.label}
                </div>
              );
            })}
          </div>
          <Button variant="outline" className="w-full gap-2" onClick={cancelRender}>
            <X className="h-4 w-4" />
            Cancel render
          </Button>
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
            ) : resumableJob ? (
              <Button
                className="flex-1 gap-2"
                onClick={() => resume.mutate()}
                disabled={resume.isPending}
              >
                <RotateCcw className="h-4 w-4" />
                Resume render
              </Button>
            ) : (
              <Button
                className="flex-1 gap-2"
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
              >
                <RotateCcw className="h-4 w-4" />
                Try again
              </Button>
            )}
            <Button variant="outline" className="flex-1" onClick={reset}>
              Start over
            </Button>
          </div>
          {resumableJob && (
            <p className="text-xs text-muted-foreground">
              Resuming continues the same render — it does not use another credit.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-5 py-4">
          {storyMode && (
            <div className="rounded-xl border border-border bg-muted/30 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                The five beats
              </p>
              <ol className="mt-2 space-y-1.5">
                {STORY_BEATS.map((beat, i) => (
                  <li key={beat.id} className="text-sm text-foreground">
                    <span className="font-semibold text-accent">{i + 1}. {beat.label}</span>
                    <span className="text-muted-foreground"> — {beat.description}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="script">Your script</Label>
            <Textarea
              id="script"
              placeholder="Paste your script here. At least 20 characters."
              value={script}
              onChange={(e) => setScript(e.target.value)}
              maxLength={12000}
              className="min-h-[140px] resize-none"
              aria-invalid={script.length > 0 && script.trim().length < 20}
              aria-describedby="script-help"
            />
            <div
              id="script-help"
              className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"
            >
              <p>
                {script.trim().length < 20 ? (
                  "At least 20 characters."
                ) : (
                  <>
                    {script.trim().split(/\s+/).length} words · ≈
                    {formatClock(estimateNarrationSeconds(script))} of narration
                    {targetDuration !== "auto" &&
                      (() => {
                        const target = Number(targetDuration);
                        const est = estimateNarrationSeconds(script);
                        if (Math.abs(est - target) / target <= 0.25) return null;
                        return est > target ? (
                          <span className="text-amber-600 dark:text-amber-400">
                            {" "}
                            — over your {formatClock(target)} target
                          </span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400">
                            {" "}
                            — under your {formatClock(target)} target
                          </span>
                        );
                      })()}
                  </>
                )}
              </p>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto min-h-11 px-0 font-medium text-accent"
                onClick={() => setScript(SAMPLE_SCRIPT)}
              >
                Use a sample script
              </Button>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
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
            <AspectRatioSelect value={aspect} onValueChange={setAspect} />
            <div className="space-y-2">
              <Label htmlFor="target-duration">Target length</Label>
              <Select value={targetDuration} onValueChange={setTargetDuration}>
                <SelectTrigger id="target-duration">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TARGET_DURATIONS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Guides the narration rewrite; the final MP4 follows the spoken audio.
              </p>
            </div>
          </div>

          <VoiceLanguageSection
            narrationText={script}
            onSelectionChange={handleVoiceSelectionChange}
          />

          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || script.trim().length < 20}
            className="w-full gap-2"
          >
            <Wand2 className="h-4 w-4" />
            Generate video
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Keep this tab open until Download appears. The MP4 is assembled in this browser.
          </p>
        </div>
      )}
    </CreateSurface>
  );
}
