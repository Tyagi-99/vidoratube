import { Clapperboard, Mic2, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type CreationModeChoice = "script" | "voiceover" | "auto_edit";

const MODES: {
  id: CreationModeChoice;
  title: string;
  blurb: string;
  icon: typeof Clapperboard;
}[] = [
  {
    id: "script",
    title: "Script to Video",
    blurb: "Mode 1 — write a topic or script, generate visuals, voice and captions.",
    icon: Clapperboard,
  },
  {
    id: "voiceover",
    title: "Voiceover Mode",
    blurb: "Mode 2 — upload footage, set rights, generate commentary + ElevenLabs VO.",
    icon: Mic2,
  },
  {
    id: "auto_edit",
    title: "Automatic Edit",
    blurb: "Mode 3 — upload video, target duration/aspect, auto trim + captions (optional VO).",
    icon: Sparkles,
  },
];

export function ModeChooser({
  open,
  onOpenChange,
  onChoose,
  title = "New video",
  description = "Choose how you want to create this video.",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (mode: CreationModeChoice) => void;
  title?: string;
  description?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          {MODES.map((mode) => {
            const Icon = mode.icon;
            return (
              <button
                key={mode.id}
                type="button"
                className={cn(
                  "flex flex-col items-start gap-2 rounded-2xl border border-border bg-card p-4 text-left transition hover:border-primary/60 hover:bg-primary/5",
                )}
                onClick={() => onChoose(mode.id)}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <p className="font-semibold text-foreground">{mode.title}</p>
                <p className="text-sm text-muted-foreground">{mode.blurb}</p>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
