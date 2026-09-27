/**
 * Shared playback validation + duration measurement for rendered MP4 blobs.
 * Used by both renderProject (browser-render) and composeVoiceoverVideo
 * (voiceover-compose) so every compose path validates its output.
 */

const VALIDATE_TIMEOUT_MS = 20000;

/** Measures playable duration of a video blob via metadata (0 on failure). */
export function measureMediaDuration(blob: Blob, timeoutMs = 15000): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.preload = "metadata";
    let done = false;
    const finish = (value: number) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => {
      console.warn("[validate] duration measurement timed out");
      finish(0);
    }, timeoutMs);
    video.onloadedmetadata = () =>
      finish(Number.isFinite(video.duration) ? video.duration : 0);
    video.onerror = () => finish(0);
    video.src = url;
  });
}

type VideoWithAudioProbe = HTMLVideoElement & {
  mozHasAudio?: boolean;
  webkitAudioDecodedByteCount?: number;
  audioTracks?: { length: number };
};

/**
 * True when the blob loads as a playable video that (a) has nonzero duration,
 * (b) matches the expected duration within tolerance when given, and (c) has a
 * decodable audio track when the browser exposes an audio probe.
 *
 * Unlike the old inline validator, a metadata timeout is an explicit failure —
 * a browser that can neither play nor reject the file must not auto-pass.
 */
export function validatePlayback(blob: Blob, expectedDuration?: number): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.preload = "metadata";
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(ok);
    };
    const timer = setTimeout(() => {
      console.warn("[validate] playback validation timed out");
      finish(false);
    }, VALIDATE_TIMEOUT_MS);
    video.onloadedmetadata = () => {
      if (!(video.duration > 0)) return finish(false);
      if (expectedDuration != null && expectedDuration > 0) {
        const tolerance = Math.max(2, expectedDuration * 0.1);
        if (Math.abs(video.duration - expectedDuration) > tolerance) return finish(false);
      }
      // Only trust probes that are populated from metadata alone.
      // webkitAudioDecodedByteCount stays 0 until playback actually decodes
      // audio, so with preload="metadata" it falsely reported "no audio" in
      // Chrome and failed every valid render.
      const v = video as VideoWithAudioProbe;
      if (v.audioTracks !== undefined && v.audioTracks.length === 0) return finish(false);
      if (v.mozHasAudio === false) return finish(false);
      finish(true);
    };
    video.onerror = () => finish(false);
    video.src = url;
  });
}
