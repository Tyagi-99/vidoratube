import { useEffect, useState } from "react";

/** Ticking SMPTE timecode — the production vernacular. HH:MM:SS:FF at 24fps. */
export function Timecode({ className = "" }: { className?: string }) {
  const [frames, setFrames] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setFrames((f) => f + 1), 1000 / 24);
    return () => window.clearInterval(id);
  }, []);

  const totalSeconds = Math.floor(frames / 24);
  const ff = frames % 24;
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <span className={`font-mono tabular-nums ${className}`} aria-hidden="true">
      {pad(hh)}:{pad(mm)}:{pad(ss)}:{pad(ff)}
    </span>
  );
}

/** Small REC indicator — red dot + label. */
export function RecBadge({ label = "REC" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 font-mono text-xs tracking-widest text-foreground/80">
      <span className="size-2 rounded-full bg-[#FF3B30] animate-rec" aria-hidden="true" />
      {label}
    </span>
  );
}
