/**
 * 2.5D parallax filter builder (Sprint 3-4) — canonical copy.
 *
 * A subtle Ken Burns-style treatment for still images: a slow zoom combined
 * with a gentle diagonal pan, which reads as layered depth on screen. Tasteful
 * and slow by design — no wobble, no bounce.
 *
 * Implementation: one zoompan over an overscanned cover frame. The input is
 * first scaled to cover the target frame (same as the static path), then
 * uniformly overscanned by K = 1 + 0.12*intensity, then zoompan samples a
 * WxH window that slowly zooms (amplitude 0.10*intensity) while drifting
 * diagonally (bounded pan, see framing math).
 *
 * Framing math (why faces/edges are never cropped unexpectedly):
 *  - Cover scale guarantees the input is at least W x H (identical to the
 *    static cover path — parallax never sees a smaller frame than today).
 *  - Uniform xK overscan makes the input at least WK x HK.
 *  - zoom z only zooms IN: 1 <= z <= 1 + 0.10*intensity <= K, so the sampled
 *    window (iw/z x ih/z) is always >= W x H — the window can never exceed
 *    the input, so no black edges or empty borders are ever exposed.
 *  - Pan offsets are a fraction (<= 0.4*intensity, <= 0.3*intensity) of the
 *    valid pan range [0, iw - iw/z], so x stays inside [0.1r, 0.9r] and y
 *    inside [0.15r, 0.85r] of that range — the window never touches the
 *    input border. Center-biased, so subjects framed by the cover crop stay
 *    framed.
 *  - Everything is relative to W/H, so the same chain is per-aspect safe for
 *    16:9 (1920x1080), 9:16 (1080x1920) and 1:1 (1080x1080). A portrait
 *    source on a 9:16 target behaves exactly like the static cover path;
 *    parallax only adds motion inside the already-covered frame.
 *  - intensity = 0 collapses to a static frame (z = 1, centered) — the
 *    filter stays syntactically valid, so callers can fade the effect
 *    without branching.
 *
 * The worker keeps a dependency-free mirror at worker/src/parallax.ts.
 */

export interface ParallaxOptions {
  /** Output frame width, e.g. 1920. */
  width: number;
  /** Output frame height, e.g. 1080. */
  height: number;
  /** Total output frames for this segment (>= 1). */
  frames: number;
  /** 0..1, default 0.5. 0 = static, 1 = strongest tasteful setting. Clamped. */
  intensity?: number;
  /** Zoom direction; callers alternate per scene for variety. Default "in". */
  direction?: "in" | "out";
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.min(1, Math.max(0, v));
}

/**
 * Build the full video filter chain for one still-image segment, from the
 * raw image input to a WxH SAR=1 frame. Drop-in replacement for
 * `coverFilter,setsar=1,motionFilter(...)` chains.
 */
export function buildParallaxFilter(options: ParallaxOptions): string {
  const W = Math.round(options.width);
  const H = Math.round(options.height);
  if (!(W > 0 && H > 0)) throw new Error("buildParallaxFilter: width/height must be positive");
  const F = Math.max(1, Math.round(options.frames));
  const I = clamp01(options.intensity ?? 0.5);

  const overscan = 1 + 0.12 * I; // K: headroom above the cover frame
  const zoomAmp = 0.1 * I; // z travels 1 -> 1+zoomAmp (<= K, see math above)
  const panX = 0.4 * I; // x drift as a fraction of the valid pan range
  const panY = 0.3 * I; // y drift (opposite sign => diagonal feel)
  const t = `(on/${F})`; // 0..1 progress across the segment

  const z =
    options.direction === "out"
      ? `${(1 + zoomAmp).toFixed(6)}-${zoomAmp.toFixed(6)}*${t}`
      : `1+${zoomAmp.toFixed(6)}*${t}`;
  // `zoom` is zoompan's current zoom; x/y must stay inside [0, iw - iw/zoom].
  const x = `(iw-iw/zoom)/2+${panX.toFixed(6)}*(iw-iw/zoom)*(${t}-0.5)`;
  const y = `(ih-ih/zoom)/2-${panY.toFixed(6)}*(ih-ih/zoom)*(${t}-0.5)`;

  return (
    `scale=${W}:${H}:force_original_aspect_ratio=increase,` +
    `scale=iw*${overscan.toFixed(3)}:ih*${overscan.toFixed(3)},` +
    `zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${W}x${H},setsar=1`
  );
}

/** Default subtle intensity used when the caller passes none. */
export const PARALLAX_DEFAULT_INTENSITY = 0.5;
