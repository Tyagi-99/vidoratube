/** ~150 wpm spoken English → estimated narration seconds. */
export function estimateNarrationSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round((words / 150) * 60));
}

/** 90 → "1:30", 45 → "45s". */
export function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}
