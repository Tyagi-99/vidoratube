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

export function ModeChooser({
  open,
  onOpenChange,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (mode: CreationModeChoice) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New video</DialogTitle>
          <DialogDescription>Choose how you want to create this video.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <button
            type="button"
            className={cn(
              "flex flex-col items-start gap-2 rounded-2xl border border-border bg-card p-4 text-left transition hover:border-primary/60 hover:bg-primary/5",
            )}
            onClick={() => onChoose("script")}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Clapperboard className="h-5 w-5" />
            </div>
            <p className="font-semibold text-foreground">Script to Video</p>
            <p className="text-sm text-muted-foreground">
              Mode 1 — write a topic or script, generate visuals, voice and captions.
            </p>
          </button>
          <button
            type="button"
            className={cn(
              "flex flex-col items-start gap-2 rounded-2xl border border-border bg-card p-4 text-left transition hover:border-primary/60 hover:bg-primary/5",
            )}
            onClick={() => onChoose("voiceover")}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Mic2 className="h-5 w-5" />
            </div>
            <p className="font-semibold text-foreground">Voiceover Mode</p>
            <p className="text-sm text-muted-foreground">
              Mode 2 — upload footage, set rights, generate commentary + ElevenLabs VO.
            </p>
          </button>
          <button
            type="button"
            className={cn(
              "flex flex-col items-start gap-2 rounded-2xl border border-border bg-card p-4 text-left transition hover:border-primary/60 hover:bg-primary/5",
            )}
            onClick={() => onChoose("auto_edit")}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <p className="font-semibold text-foreground">Automatic Edit</p>
            <p className="text-sm text-muted-foreground">
              Mode 3 — upload video, target duration/aspect, auto trim + captions (optional VO).
            </p>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
