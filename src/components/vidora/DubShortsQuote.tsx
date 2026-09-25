import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listDubLanguages } from "@/lib/dubbing/dubbing.functions";
import { formatRenderCost } from "@/lib/billing/per-minute";
import { MAX_SHORTS } from "@/lib/shorts/select";

/**
 * Dubbing & Shorts quote section (Sprint 5-6).
 *
 * Shows the EXACT credit quote for dubbing this project's finished video
 * into selected languages (0.5 credits/finished minute/language) and for
 * cutting N Shorts (0.5 credits each) — the same per-minute.ts math the
 * future enqueue path will reserve. Beta languages are labeled "Beta";
 * languages without a verified voice cannot be selected yet.
 *
 * The queue action itself is not live yet: the button is disabled and says
 * "Shipping next" with the target date — no credits move.
 */
export function DubShortsQuote({
  durationSeconds,
  parallax25d,
}: {
  durationSeconds: number;
  parallax25d: boolean;
}) {
  const listFn = useServerFn(listDubLanguages);
  const { data: languages, isLoading } = useQuery({
    queryKey: ["dub-languages"],
    queryFn: () => listFn(),
    staleTime: 5 * 60_000,
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [shortsCount, setShortsCount] = useState(0);

  const toggle = (code: string) =>
    setSelected((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));

  const quote = formatRenderCost({
    durationSeconds,
    mode: "story",
    parallax25d,
    dubLanguages: selected.length,
    shortsCount,
  });

  return (
    <div className="mt-6 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">Dubbing &amp; Shorts</p>
          <p className="text-xs text-muted-foreground">
            Dub the finished video into other languages, and cut highlight Shorts from it. Quoted
            exactly — nothing is charged today.
          </p>
        </div>
        <Badge variant="outline">Shipping next</Badge>
      </div>

      {isLoading ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading languages…
        </p>
      ) : (
        <div className="mt-3">
          <p className="text-xs font-medium text-foreground">Dub into</p>
          <div className="mt-1 flex flex-wrap gap-2" role="group" aria-label="Dubbing languages">
            {(languages ?? []).map((l) => (
              <label
                key={l.code}
                className={`flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs ${
                  l.canDub
                    ? "text-foreground"
                    : "cursor-not-allowed opacity-50 text-muted-foreground"
                }`}
                title={l.canDub ? undefined : "Voice pending verification — not selectable yet"}
              >
                <Checkbox
                  checked={selected.includes(l.code)}
                  onCheckedChange={() => l.canDub && toggle(l.code)}
                  disabled={!l.canDub}
                  aria-label={`Dub into ${l.nameEn}`}
                />
                {l.nameNative}
                {l.beta && (
                  <span className="rounded bg-amber-500/15 px-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                    {l.beta}
                  </span>
                )}
                {!l.canDub && <span className="text-[10px]">voice pending</span>}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3">
        <label htmlFor="shorts-count" className="text-xs font-medium text-foreground">
          Highlight Shorts (0–{MAX_SHORTS})
        </label>
        <input
          id="shorts-count"
          type="number"
          min={0}
          max={MAX_SHORTS}
          value={shortsCount}
          onChange={(e) =>
            setShortsCount(
              Math.max(0, Math.min(MAX_SHORTS, Math.floor(Number(e.target.value) || 0))),
            )
          }
          className="ml-2 w-16 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          9:16 cuts with burned-in captions, picked from the highest-scoring highlight segments of
          the finished video.
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <p className="text-sm text-muted-foreground">{quote}</p>
        <Button disabled aria-label="Queue dubbing and shorts — shipping next">
          Queue — Shipping next (target Oct 2026)
        </Button>
      </div>
    </div>
  );
}
