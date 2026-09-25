export const CREATION_MODES = [
  {
    id: "script",
    href: "/studio?create=script",
    kicker: "You write",
    title: "Script to video",
    line: "A script becomes one finished MP4 — visuals, voice, captions.",
  },
  {
    id: "voiceover",
    href: "/studio?create=voiceover",
    kicker: "You upload footage",
    title: "Voiceover",
    line: "Commentary over a clip you own. Rights first, then voice and captions.",
  },
  {
    id: "auto_edit",
    href: "/studio?create=auto_edit",
    kicker: "You upload a raw take",
    title: "Automatic edit",
    line: "Trim to a target length, add captions, optional voice. One MP4 out.",
  },
] as const;

export type CreationModeId = (typeof CREATION_MODES)[number]["id"];

export function creationModeHref(id: CreationModeId): string {
  return CREATION_MODES.find((mode) => mode.id === id)!.href;
}

export function parseCreateMode(value: string | null): CreationModeId | null {
  if (value === "script" || value === "voiceover" || value === "auto_edit") return value;
  return null;
}

/** Router search for /studio — available on the first client render, no useEffect. */
export function studioSearchFromUnknown(search: Record<string, unknown>): {
  create?: CreationModeId;
  youtube?: "connected" | "upload_granted" | "error";
  reason?: string;
} {
  const create = parseCreateMode(typeof search["create"] === "string" ? search["create"] : null);
  const youtubeRaw = search["youtube"];
  const youtube =
    youtubeRaw === "connected" || youtubeRaw === "upload_granted" || youtubeRaw === "error"
      ? youtubeRaw
      : undefined;
  const reason = typeof search["reason"] === "string" ? search["reason"] : undefined;
  return {
    ...(create ? { create } : {}),
    // Kept (not stripped): the YouTube OAuth callback redirects here with
    // ?youtube=connected|upload_granted|error&reason=… and the studio toasts the outcome.
    ...(youtube ? { youtube } : {}),
    ...(youtube === "error" && reason ? { reason } : {}),
  };
}
