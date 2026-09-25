/**
 * Sprint 5-6: licensed-music provenance gate.
 *
 * A catalog track is only selectable when its licensing provenance is
 * recorded: provider + license + license_url, or a documented equivalent (a
 * license label that is self-proving without a URL). Tracks missing
 * provenance are hidden from selection with a logged reason — never silently.
 *
 * BYO music (user-supplied URLs mixed straight into the render) is NOT a
 * catalog track and is unaffected by this gate.
 */

export interface CatalogTrackProvenance {
  provider: string | null;
  license: string | null;
  license_url: string | null;
}

/**
 * License labels that are self-proving without a license URL. Documented
 * equivalents to the full (provider + license + license_url) triple:
 * - "Public domain": no rights holder exists to link to.
 * - "Vidora original composition": rights held by us; no external deed.
 */
export const PROVENANCE_EQUIVALENT_LICENSES = [
  "Public domain",
  "Vidora original composition",
] as const;

/**
 * Returns null when the track may be selected, otherwise the human-readable
 * reason it is excluded (used for logging).
 */
export function provenanceGap(track: CatalogTrackProvenance): string | null {
  if (!track.provider || track.provider.trim().length === 0) return "missing provider";
  const license = track.license?.trim() ?? "";
  if (license.length === 0) return "missing license";
  if (!track.license_url || track.license_url.trim().length === 0) {
    const equivalent = (PROVENANCE_EQUIVALENT_LICENSES as readonly string[]).includes(license);
    if (!equivalent) return "missing license_url";
  }
  return null;
}

/** True when the track carries enough licensing provenance to be selectable. */
export function hasMusicProvenance(track: CatalogTrackProvenance): boolean {
  return provenanceGap(track) === null;
}

export interface ProvenanceFilterResult<T> {
  selectable: T[];
  excluded: { track: T; reason: string }[];
}

/**
 * Splits catalog rows into selectable tracks and excluded ones (with
 * reasons). Callers log the excluded set — provenance gaps must be visible,
 * not silent.
 */
export function filterProvenCatalogTracks<T extends CatalogTrackProvenance>(
  rows: T[],
): ProvenanceFilterResult<T> {
  const selectable: T[] = [];
  const excluded: { track: T; reason: string }[] = [];
  for (const track of rows) {
    const reason = provenanceGap(track);
    if (reason === null) selectable.push(track);
    else excluded.push({ track, reason });
  }
  return { selectable, excluded };
}

/**
 * Logs excluded tracks so provenance gaps are visible in server logs.
 * `identify` extracts a short human label (id/title) for each row.
 */
export function logProvenanceExclusions<T extends CatalogTrackProvenance>(
  source: string,
  excluded: { track: T; reason: string }[],
  identify: (track: T) => string,
): void {
  if (excluded.length === 0) return;
  const detail = excluded.map((e) => `${identify(e.track)} (${e.reason})`).join("; ");
  console.warn(`[music-catalog] ${source}: hid ${excluded.length} track(s) missing provenance: ${detail}`);
}
