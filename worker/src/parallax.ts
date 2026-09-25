/**
 * 2.5D parallax filter builder — worker mirror.
 *
 * Dependency-free duplicate of src/lib/render/parallax.ts (the worker package
 * must not import from src/). Keep the two in sync: same math, same output
 * for the same inputs. See the canonical file for the framing-math docs.
 */

export interface ParallaxOptions {
  width: number;
  height: number;
  frames: number;
  intensity?: number;
  direction?: "in" | "out";
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.min(1, Math.max(0, v));
}

export function buildParallaxFilter(options: ParallaxOptions): string {
  const W = Math.round(options.width);
  const H = Math.round(options.height);
  if (!(W > 0 && H > 0)) throw new Error("buildParallaxFilter: width/height must be positive");
  const F = Math.max(1, Math.round(options.frames));
  const I = clamp01(options.intensity ?? 0.5);

  const overscan = 1 + 0.12 * I;
  const zoomAmp = 0.1 * I;
  const panX = 0.4 * I;
  const panY = 0.3 * I;
  const t = `(on/${F})`;

  const z =
    options.direction === "out"
      ? `${(1 + zoomAmp).toFixed(6)}-${zoomAmp.toFixed(6)}*${t}`
      : `1+${zoomAmp.toFixed(6)}*${t}`;
  const x = `(iw-iw/zoom)/2+${panX.toFixed(6)}*(iw-iw/zoom)*(${t}-0.5)`;
  const y = `(ih-ih/zoom)/2-${panY.toFixed(6)}*(ih-ih/zoom)*(${t}-0.5)`;

  return (
    `scale=${W}:${H}:force_original_aspect_ratio=increase,` +
    `scale=iw*${overscan.toFixed(3)}:ih*${overscan.toFixed(3)},` +
    `zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${W}x${H},setsar=1`
  );
}

export const PARALLAX_DEFAULT_INTENSITY = 0.5;
