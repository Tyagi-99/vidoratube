/**
 * Best-effort duration probe for a user-selected video file.
 *
 * Resolves `undefined` (never hangs) when the browser cannot parse the file,
 * when metadata takes too long, or when anything else goes wrong — callers
 * treat "unknown" as a reason to fall back, not as a failure.
 */
export function probeVideoDuration(file: File, timeoutMs = 10000): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement("video");
    el.preload = "metadata";
    let settled = false;
    const done = (value: number | undefined) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      el.removeAttribute("src");
      resolve(value);
    };
    const timer = window.setTimeout(() => done(undefined), timeoutMs);
    el.onloadedmetadata = () => {
      done(Number.isFinite(el.duration) ? el.duration : undefined);
    };
    el.onerror = () => done(undefined);
    el.src = url;
  });
}
