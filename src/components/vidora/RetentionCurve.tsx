/**
 * Sprint 7-8: audience-retention curve rendered against chapter titles.
 *
 * Presentational only — all math lives in src/lib/retention-curve.ts.
 * With no data it renders the honest empty state, never a flat fake line.
 */

import type { RetentionModel, RetentionPoint } from "@/lib/retention-curve";

const W = 640;
const H = 220;
const PAD_L = 36;
const PAD_B = 44;
const PAD_T = 12;

export function RetentionCurve(props: {
  model: RetentionModel | null;
  points: RetentionPoint[];
  emptyText: string;
  strongestLabel: string;
  weakestLabel: string;
}) {
  const { model, points, emptyText, strongestLabel, weakestLabel } = props;

  if (!model || !model.hasData || points.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }

  const maxT = Math.max(...points.map((p) => p.t), 1);
  const x = (t: number) => PAD_L + (t / maxT) * (W - PAD_L - 8);
  const y = (r: number) => PAD_T + (1 - Math.min(100, Math.max(0, r)) / 100) * (H - PAD_T - PAD_B);

  const path = points
    .slice()
    .sort((a, b) => a.t - b.t)
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.r).toFixed(1)}`)
    .join(" ");

  const fmtTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Audience retention curve">
        {/* gridlines at 25/50/75/100% */}
        {[25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line x1={PAD_L} x2={W - 8} y1={y(g)} y2={y(g)} stroke="currentColor" strokeOpacity={0.12} />
            <text x={PAD_L - 6} y={y(g) + 4} textAnchor="end" fontSize={10} fill="currentColor" opacity={0.5}>
              {g}%
            </text>
          </g>
        ))}
        {/* chapter boundaries + titles */}
        {model.segments.map((s) => (
          <g key={s.segment.index}>
            <line
              x1={x(s.segment.startSec)}
              x2={x(s.segment.startSec)}
              y1={PAD_T}
              y2={H - PAD_B + 6}
              stroke="currentColor"
              strokeOpacity={0.25}
              strokeDasharray="3 3"
            />
            <text
              x={Math.min(x(s.segment.startSec) + 4, W - 90)}
              y={H - PAD_B + 22}
              fontSize={10}
              fill="currentColor"
              opacity={0.65}
            >
              {s.segment.title.length > 18 ? `${s.segment.title.slice(0, 17)}…` : s.segment.title}
              {s.avgRetention != null ? ` · ${s.avgRetention.toFixed(0)}%` : ""}
            </text>
          </g>
        ))}
        {/* the curve */}
        <path d={path} fill="none" stroke="var(--color-primary, #f59e0b)" strokeWidth={2.5} />
        <line x1={PAD_L} x2={W - 8} y1={H - PAD_B} y2={H - PAD_B} stroke="currentColor" strokeOpacity={0.2} />
        <text x={W - 8} y={H - 8} textAnchor="end" fontSize={10} fill="currentColor" opacity={0.5}>
          {fmtTime(maxT)}
        </text>
        <text x={PAD_L} y={H - 8} fontSize={10} fill="currentColor" opacity={0.5}>
          0:00
        </text>
      </svg>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        {model.strongest && (
          <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-emerald-600">
            {strongestLabel}: {model.strongest.segment.title} ({model.strongest.avgRetention?.toFixed(0)}%)
          </span>
        )}
        {model.weakest && model.weakest !== model.strongest && (
          <span className="rounded-full bg-amber-500/15 px-3 py-1 text-amber-600">
            {weakestLabel}: {model.weakest.segment.title} ({model.weakest.avgRetention?.toFixed(0)}%)
          </span>
        )}
        {model.overallAvg != null && (
          <span className="rounded-full bg-muted px-3 py-1 text-muted-foreground">
            avg {model.overallAvg.toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  );
}
