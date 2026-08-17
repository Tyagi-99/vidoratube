import { useState } from "react";
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

const steps = [
  "Writing narration",
  "Matching footage",
  "Adding captions",
  "Mixing audio",
  "Final render",
];

const sampleResult = {
  title: "final_cut.mp4",
  duration: "11:42",
  resolution: "1080p",
  thumbnail: "https://vidora.ai/dassets/thumbs/t1.jpg",
};

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
  const [status, setStatus] = useState<"idle" | "generating" | "done">("idle");
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);

  const handleGenerate = () => {
    if (!script.trim()) return;
    setStatus("generating");
    setProgress(0);
    setCurrentStep(0);

    let stepIndex = 0;
    const totalDuration = 6000;
    const stepDuration = totalDuration / steps.length;

    const interval = setInterval(() => {
      stepIndex++;
      setCurrentStep(stepIndex);
      setProgress(Math.min((stepIndex / steps.length) * 100, 100));

      if (stepIndex >= steps.length) {
        clearInterval(interval);
        setTimeout(() => {
          setStatus("done");
          setProgress(100);
        }, 400);
      }
    }, stepDuration);
  };

  const reset = () => {
    setStatus("idle");
    setProgress(0);
    setCurrentStep(0);
    setScript("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold tracking-tight">
            Make your first video
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Paste your script, pick a voice and format, and we'll assemble a finished video.
          </DialogDescription>
        </DialogHeader>

        {status === "done" ? (
          <div className="space-y-6 py-4">
            <div className="relative overflow-hidden rounded-2xl border border-border bg-muted">
              <img
                src={sampleResult.thumbnail}
                alt="Finished video thumbnail"
                className="aspect-video w-full object-cover"
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 text-foreground shadow-lg">
                  <Play className="h-6 w-6 fill-current" />
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-foreground">{sampleResult.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {sampleResult.resolution} · {sampleResult.duration}
                  </p>
                </div>
                <Button className="gap-2">
                  <Download className="h-4 w-4" />
                  Download
                </Button>
              </div>
            </div>
            <div className="flex gap-3">
              <Button onClick={reset} variant="outline" className="flex-1">
                Make another
              </Button>
              <Button
                onClick={() => onOpenChange(false)}
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              >
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
                <span className="font-medium text-foreground">
                  {steps[currentStep] || "Finalizing"}
                </span>
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
                        : "text-muted-foreground"
                  )}
                >
                  <div
                    className={cn(
                      "flex h-5 w-5 items-center justify-center rounded-full border text-xs",
                      idx < currentStep
                        ? "border-primary bg-primary text-primary-foreground"
                        : idx === currentStep
                          ? "border-primary text-primary"
                          : "border-border"
                    )}
                  >
                    {idx < currentStep ? <Check className="h-3 w-3" /> : idx + 1}
                  </div>
                  {step}
                </div>
              ))}
            </div>
            <p className="text-center text-sm text-muted-foreground">
              Usually ready within the hour. This demo completes in a few seconds.
            </p>
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
                className="min-h-[140px] resize-none"
              />
              <p className="text-xs text-muted-foreground">
                Example: "The frigate HMS Amethyst steamed up the Yangtze toward Nanking in April 1949..."
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
              onClick={handleGenerate}
              disabled={!script.trim()}
              className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
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
