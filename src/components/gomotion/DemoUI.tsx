import { Wand2, Play, Clock, ChevronDown, MonitorPlay, Languages, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

const timeline = [
  { time: "0:00", label: "Cold open hook", active: true },
  { time: "0:12", label: "Story setup", active: true },
  { time: "0:45", label: "Rising action", active: false },
  { time: "1:30", label: "Payoff", active: false },
  { time: "2:10", label: "CTA outro", active: false },
];

const scriptSnippet = `The frigate HMS Amethyst steamed up the Yangtze toward Nanking in April 1949...

The crew thought they were on a routine resupply mission. Instead, they were sailing into the longest single-ship chase of the 20th century.`;

export function DemoUI({ onGenerate }: { onGenerate: () => void }) {
  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
      {/* Mock toolbar */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-red-400" />
          <div className="h-3 w-3 rounded-full bg-amber-400" />
          <div className="h-3 w-3 rounded-full bg-green-400" />
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <MonitorPlay className="h-3.5 w-3.5" />
          <span>Untitled project</span>
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">1080p</span>
          <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">16:9</span>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px]">
        {/* Preview */}
        <div className="relative min-h-[280px] bg-gradient-to-br from-[#3a4a6e] to-[#1a2438] sm:min-h-[360px]">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white/10 backdrop-blur-sm">
                <Play className="h-7 w-7 text-white/90 fill-current" />
              </div>
              <p className="text-sm font-medium text-white/80">Preview</p>
              <p className="mt-1 text-xs text-white/50">Footage matched to your script</p>
            </div>
          </div>

          {/* Floating caption mock */}
          <div className="absolute bottom-16 left-1/2 w-3/4 max-w-lg -translate-x-1/2 rounded-lg bg-black/40 px-4 py-2 text-center text-sm font-semibold text-white backdrop-blur-sm">
            <span className="opacity-40">The crew thought they were on a routine</span>
            <span className="text-primary"> resupply mission.</span>
          </div>

          {/* Floating timeline markers */}
          <div className="absolute bottom-4 left-4 right-4 flex items-center gap-1 rounded-lg bg-black/30 px-3 py-2 backdrop-blur-sm">
            {timeline.map((item, index) => (
              <div key={index} className="flex-1 text-center">
                <div
                  className={cn(
                    "mb-1 h-1.5 rounded-full",
                    item.active ? "bg-primary" : "bg-white/20"
                  )}
                />
                <p className="text-[10px] text-white/60">{item.time}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Sidebar */}
        <div className="border-t border-border p-4 lg:border-t-0 lg:border-l">
          <div className="mb-4 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <FileText className="h-4 w-4" />
            Script
          </div>
          <div className="rounded-lg border border-border bg-muted/50 p-3 text-sm leading-relaxed text-muted-foreground">
            {scriptSnippet}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border p-3">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Languages className="h-3.5 w-3.5" />
                Voice
              </div>
              <div className="flex items-center gap-1 text-sm font-medium text-foreground">
                Deneb · EN
                <ChevronDown className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                Duration
              </div>
              <div className="text-sm font-medium text-foreground">~11:42</div>
            </div>
          </div>

          <button
            onClick={onGenerate}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Wand2 className="h-4 w-4" />
            Generate video
          </button>
        </div>
      </div>
    </div>
  );
}
