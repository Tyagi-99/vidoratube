import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
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
import { createVideoJob } from "@/lib/jobs.functions";
import { toast } from "sonner";

const steps = [
  "Writing narration",
  "Matching footage",
  "Adding captions",
  "Mixing audio",
  "Final render",
];

type JobResult = {
  id: string;
  title: string;
  duration_seconds: number | null;
  result_url: string | null;
  thumbnail_url: string | null;
  narration: string | null;
};

function formatDuration(seconds: number | null) {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

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
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<JobResult | null>(null);

  const queryClient = useQueryClient();
  const create = useServerFn(createVideoJob);

  const mutation = useMutation({
    mutationFn: async () => {
      setCurrentStep(0);
      setProgress(8);
      const ticker = setInterval(() => {
        setCurrentStep((s) => Math.min(s + 1, steps.length - 1));
        setProgress((p) => Math.min(p + 16, 92));
      }, 1400);
      try {
        return (await create({ data: { script, voice, format } })) as JobResult;
      } finally {
        clearInterval(ticker);
      }
    },
    onSuccess: (job) => {
      setProgress(100);
      setResult(job);
      queryClient.invalidateQueries();
    },
    onError: (error: Error) => {
      setProgress(0);
      toast.error(error.message || "Render failed");
    },
  });

  const reset = () => {
    setResult(null);
    setProgress(0);
    setCurrentStep(0);
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

        {status === "done" && result ? (
          <div className="space-y-6 py-4">
            <div className="relative overflow-hidden rounded-2xl border border-border bg-muted">
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
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-foreground">{result.title}</p>
                  <p className="text-sm text-muted-foreground">
                    1080p · {formatDuration(result.duration_seconds)}
                  </p>
                </div>
                <Button asChild className="gap-2">
                  <a href={result.result_url ?? "#"} target="_blank" rel="noreferrer">
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
                <span className="font-medium text-foreground">{steps[currentStep]}</span>
                <span className="text-muted-foreground">{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
            <div className="space-y-3">
              {steps.map((step, idx) => (
                <div
                  key={step}
                  className={cn(
                    "flex items-center gap-3 text-sm transition-colors",
                    idx < currentStep
                      ? "text-foreground"
                      : idx === currentStep
                        ? "text-primary"
                        : "text-muted-foreground",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-5 w-5 items-center justify-center rounded-full border text-xs",
                      idx < currentStep
                        ? "border-primary bg-primary text-primary-foreground"
                        : idx === currentStep
                          ? "border-primary text-primary"
                          : "border-border",
                    )}
                  >
                    {idx < currentStep ? <Check className="h-3 w-3" /> : idx + 1}
                  </div>
                  {step}
                </div>
              ))}
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
