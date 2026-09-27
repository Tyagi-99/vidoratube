/**
 * Phase 3 (Creation) — narrow storage port shared by Stream C modules.
 *
 * Keeps server logic unit-testable: tests inject a fake port, the real
 * implementation lives in the `.functions.ts` layer (service-role client).
 * All Stream C assets live in the private `generated-videos` bucket.
 */
export const CREATION_BUCKET = "generated-videos";

export type StoragePort = {
  /** Upload raw bytes to a storage path; throws on failure. */
  uploadImage(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Short-lived signed URL for viewing a stored image (null when unavailable). */
  signImage(path: string, expiresInSeconds?: number): Promise<string | null>;
};
