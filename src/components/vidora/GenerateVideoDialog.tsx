import { useState } from "react";
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
import { Check, Download, Loader2, Play, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { createVideoJob, advanceVideoJob } from "@/lib/jobs.functions";
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
  const [result, setResult] = useState<JobResult | null>(null);

  const { user, loading: sessionLoading } = useSession();
  const queryClient = useQueryClient();

  const create = useServerFn(createVideoJob);
  const advance = useServerFn(advanceVideoJob);

  const mutation = useMutation({
    mutationFn: async () => {
      setStepLabel("Writing narration");
      setProgress(8);

      let job = (await create({ data: { script, voice, format } })) as JobResult;
      setProgress(job.progress ?? 20);
      setStepLabel(job.step ?? "Recording voiceover");

      // Advance one pipeline stage per call until the job settles.
      for (let i = 0; i < 90 && job.status === "running"; i++) {
        job = (await advance({ data: { id: job.id } })) as JobResult;
        setProgress(job.progress ?? 0);
        setStepLabel(job.step ?? "Working");
        if (job.status === "running") await sleep(job.stage === "rendering" ? 4000 : 400);
      }

      if (job.status === "failed") throw new Error(job.error ?? "Render failed");
      return job;
    },
    onSuccess: (job) => {
      setProgress(100);
      setResult(job);
      queryClient.invalidateQueries();
    },
    onError: (error: Error) => {
      setProgress(0);
      queryClient.invalidateQueries();
      toast.error(error.message || "Render failed");
    },

  });

  const reset = () => {
    setResult(null);
    setProgress(0);
    setScript("");
    mutation.reset();
  };

  const status = result ? "done" : mutation.isPending ? "generating" : "idle";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !mutation.isPending) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold tracking-tight">
            {status === "done" ? "Your video is ready" : "Make a video"}
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
        ) : status === "done" && result ? (

          <div className="space-y-6 py-4">
            <div className="relative overflow-hidden rounded-2xl border border-border bg-muted">
              {result.result_url ? (
                <video
                  src={result.result_url}
                  poster={result.thumbnail_url ?? undefined}
                  controls
                  className="aspect-video w-full bg-black"
                />
              ) : (
                <>
                  {result.thumbnail_url && (
                    <img
                      src={result.thumbnail_url}
                      alt={`Thumbnail for ${result.title}`}
                      className="aspect-video w-full object-cover"
                      loading="lazy"
                    />
                  )}
                  <div className="absolute inset-0 flex items-center justify-center bg-foreground/25">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-background/90 text-foreground shadow-lg">
                      <Play className="h-6 w-6 fill-current" />
                    </div>
                  </div>
                </>
              )}
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
                    {result.result_url ? "1080p · " : "Preview · "}
                    {formatDuration(result.duration_seconds)}
                  </p>
                </div>
                <Button asChild className="gap-2" disabled={!result.result_url}>
                  <a href={result.result_url ?? result.audio_url ?? "#"} target="_blank" rel="noreferrer">
                    <Download className="h-4 w-4" />
                    Download
                  </a>
                </Button>
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
                <span className="text-muted-foreground">{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
            <div className="space-y-3">
              {PIPELINE.map((step) => {
                const done = progress >= step.at;
                const active = !done && progress >= step.at - 22;
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
                      {done ? <Check className="h-3 w-3" /> : ""}
                    </div>
                    {step.label}
                  </div>
                );
              })}
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
