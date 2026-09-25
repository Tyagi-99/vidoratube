/**
 * Stable per-browser device identifier (first-party only).
 *
 * A random UUID persisted in localStorage: stable across sessions on the same
 * browser, unique per browser. Sent to our own server functions as
 * `device_hash` for free-credit abuse correlation. Never shared with third
 * parties. Returns "" when storage is unavailable (private mode etc.) — the
 * server treats a missing hash as "nothing to correlate".
 */
const STORAGE_KEY = "vidora_device_id";

export function getDeviceHash(): string {
  try {
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}
