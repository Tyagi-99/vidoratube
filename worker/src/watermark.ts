/**
 * Sprint 7-8 (workstream E: agency tier) — white-label watermark + brand overlay.
 *
 * Free-tier exports carry a small "Vidora" bug burned into the final MP4;
 * paid tiers (workspace plan_tier != 'free') skip it. The decision is made
 * app-side from the workspace plan (resolveExportMeta in
 * src/lib/agency/agency.ts) and arrives here as meta.watermark; the worker
 * never decides billing on its own.
 *
 * The watermark is an ASS overlay (same mechanism as captions — no font file
 * dependency on the worker host), rendered semi-transparent in the
 * bottom-right for the full duration. A brand kit logo (meta.brandOverlay)
 * is composited bottom-left instead of/alongside the watermark.
 */

/** ASS timestamp, duplicated from pipeline.ts to keep this module pure. */
function assTimestamp(s: number): string {
  const v = Math.max(0, s);
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const sec = Math.floor(v % 60);
  const cs = Math.floor((v % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

export interface WatermarkOptions {
  /** Label burned into the corner. Defaults to "Vidora". */
  label?: string;
  /**
   * Brand primary color as #RRGGBB — used for the watermark text when a
   * brand kit is present (white-label styling). Defaults to white.
   */
  primaryColor?: string;
}

/**
 * Build a full-duration ASS overlay: a small semi-transparent label in the
 * bottom-right corner. PlayRes matches the 16:9 master; libass scales it to
 * other aspects the same way caption ASS files are handled.
 */
export function buildWatermarkAss(
  durationSeconds: number,
  opts: WatermarkOptions = {},
): string {
  const label = (opts.label ?? "Vidora").replace(/[{}]/g, "");
  const hex = /^#[0-9A-Fa-f]{6}$/.test(opts.primaryColor ?? "")
    ? opts.primaryColor!.toUpperCase()
    : "#FFFFFF";
  // ASS colors are &HAABBGGRR.
  const assColor = `&H99${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`;
  const end = assTimestamp(Math.max(1, durationSeconds));
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Bug,Inter,36,${assColor},&H00000000,&H99000000,&H99000000,0,0,0,0,100,100,0,0,1,2,0,3,40,40,36,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,${end},Bug,,0,0,0,,${label}
`;
}

export interface BrandFilterPlan {
  /** Extra -i inputs (logo file). Empty when no logo. */
  extraInputs: string[];
  /** filter_complex chain; output label is always [vbrand]. */
  filterParts: string[];
  /** Logo was composited (caller must download it first). */
  hasLogo: boolean;
}

/**
 * Plan the brand/watermark video filter chain for the finalize step.
 *
 * - logoPath: composite the brand logo (scaled to 120px tall) bottom-left.
 * - watermark: burn the ASS bug bottom-right.
 * - neither: returns null — finalize can stream-copy as before.
 *
 * Pure: builds the filtergraph from parameters only, so it is unit-testable
 * without ffmpeg.
 */
export function planBrandFilters(args: {
  logoPath: string | null;
  watermark: boolean;
  assPath: string | null;
  logoHeight?: number;
}): BrandFilterPlan | null {
  const { logoPath, watermark, assPath, logoHeight = 120 } = args;
  if (!logoPath && !watermark) return null;

  const extraInputs: string[] = [];
  const filterParts: string[] = [];
  let label = "[0:v]";

  if (logoPath) {
    extraInputs.push(logoPath);
    filterParts.push(
      `[1:v]scale=-2:${logoHeight}[logo]`,
      `[0:v][logo]overlay=40:H-h-40[vlogo]`,
    );
    label = "[vlogo]";
  }
  if (watermark) {
    if (!assPath) throw new Error("watermark requires an assPath");
    const escaped = assPath.replace(/'/g, "'\\''");
    filterParts.push(`${label}ass=${escaped}[vbrand]`);
  } else {
    filterParts.push(`${label}null[vbrand]`);
  }
  return { extraInputs, filterParts, hasLogo: Boolean(logoPath) };
}
