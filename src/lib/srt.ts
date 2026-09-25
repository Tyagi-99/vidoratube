/**
 * SRT timecode formatting.
 *
 * Rounds the *total* milliseconds first and only then derives h/m/s/ms, so a
 * value like 1.9996s becomes 00:00:02,000 instead of the invalid 00:00:01,1000
 * that per-component rounding (Math.round(frac * 1000)) produces.
 */
export function formatSrtTimecode(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  const pad = (n: number, size = 2) => String(n).padStart(size, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}
