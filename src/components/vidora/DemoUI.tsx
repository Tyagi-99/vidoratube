import { Play } from "lucide-react";

const scenes = [
  { n: "01", line: "Amethyst steams up the Yangtze" },
  { n: "02", line: "Nanking, April 1949" },
  { n: "03", line: "Voice · Deneb EN · burned-in captions" },
];

const wave = [18, 40, 62, 34, 88, 52, 70, 28, 76, 44, 90, 36, 58, 22, 64, 48, 80, 30, 54, 72];

export function DemoUI({ onGenerate }: { onGenerate: () => void }) {
  return (
    <div className="rounded-[22px] border border-border bg-foreground/5 p-1.5">
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 text-xs text-muted-foreground">
          <b className="font-medium text-foreground">Untitled project</b>
          <span>1080p · 16:9 · early access</span>
        </div>

        <div className="grid lg:grid-cols-[1.4fr_0.9fr]">
          <div className="relative min-h-[260px] bg-[radial-gradient(80%_70%_at_30%_20%,#2a3338,#121417_62%)] sm:min-h-[320px]">
            <div className="absolute inset-x-0 top-[18%] bottom-[42%] grid place-items-center text-center text-foreground">
              <div>
                <div className="mx-auto mb-2 grid size-12 place-items-center rounded-full border border-white/15 bg-black/40">
                  <Play className="size-5 fill-current" />
                </div>
                <p className="text-sm font-medium">Preview</p>
                <p className="mt-1 text-xs text-white/55">Footage matched to your script</p>
              </div>
            </div>
            <div className="absolute inset-x-[8%] bottom-3.5 rounded-md bg-black/80 px-3 py-2 text-center text-sm font-semibold text-[#ece7dc]">
              <span className="opacity-50">The crew thought they were on a routine</span>
              <span className="text-accent"> resupply mission.</span>
            </div>
          </div>

          <div className="grid gap-2 bg-secondary p-4">
            {scenes.map((scene) => (
              <div
                key={scene.n}
                className="grid grid-cols-[2.2rem_1fr] gap-2 border-b border-border py-2 text-sm last:border-0"
              >
                <span className="font-display tabular-nums text-muted-foreground">{scene.n}</span>
                <span>{scene.line}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-border px-4 py-3">
          <div className="mb-2 flex justify-between text-xs text-muted-foreground">
            <span>Ready to generate</span>
            <span>1 credit</span>
          </div>
          <div className="mb-3 flex h-9 items-end gap-0.5" aria-hidden="true">
            {wave.map((h, i) => (
              <span
                key={i}
                className="w-1 rounded-sm bg-accent/60"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={onGenerate}
            className="flex h-11 w-full items-center justify-center rounded-[10px] bg-primary text-sm font-semibold text-primary-foreground transition-transform duration-150 hover:-translate-y-px"
          >
            Generate video
          </button>
        </div>
      </div>
    </div>
  );
}
