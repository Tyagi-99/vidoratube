/**
 * Minimal MP4 duration reader — parses the `mvhd` box (timescale/duration)
 * without any native dependency, for server-side validation of uploaded MP4s
 * where ffprobe is unavailable.
 *
 * Returns the duration in seconds, or null when the bytes are not a parseable
 * MP4 or carry no usable movie header. Only `mvhd` is consulted (no `mdhd`
 * fallback): a file without a top-level movie header is not a valid upload.
 */

function ascii(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

interface Box {
  type: string;
  contentStart: number;
  contentEnd: number;
}

/** Iterate top-level (or nested) boxes within [start, end). */
function* walkBoxes(view: DataView, start: number, end: number): Generator<Box> {
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    const type = ascii(view, offset + 4);
    let header = 8;
    if (size === 1) {
      // 64-bit largesize
      if (offset + 16 > end) return;
      const hi = view.getUint32(offset + 8);
      const lo = view.getUint32(offset + 12);
      if (hi > 0x1fffff) return; // absurdly large — bail
      size = hi * 0x100000000 + lo;
      header = 16;
    } else if (size === 0) {
      size = end - offset; // extends to end of container
    }
    if (size < header || offset + size > end) return; // corrupt
    yield { type, contentStart: offset + header, contentEnd: offset + size };
    offset += size;
  }
}

export function looksLikeMp4Container(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return ascii(view, 4) === "ftyp";
}

export function parseMp4Duration(bytes: Uint8Array): number | null {
  if (!looksLikeMp4Container(bytes)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length;

  for (const box of walkBoxes(view, 0, end)) {
    if (box.type !== "moov") continue;
    for (const child of walkBoxes(view, box.contentStart, box.contentEnd)) {
      if (child.type !== "mvhd") continue;
      if (child.contentStart + 4 > child.contentEnd) return null;
      const version = view.getUint8(child.contentStart);
      let timescale: number;
      let duration: number;
      if (version === 1) {
        if (child.contentStart + 32 > child.contentEnd) return null;
        timescale = view.getUint32(child.contentStart + 20);
        const hi = view.getUint32(child.contentStart + 24);
        const lo = view.getUint32(child.contentStart + 28);
        duration = hi * 0x100000000 + lo;
      } else {
        if (child.contentStart + 20 > child.contentEnd) return null;
        timescale = view.getUint32(child.contentStart + 12);
        duration = view.getUint32(child.contentStart + 16);
      }
      if (!Number.isFinite(timescale) || timescale <= 0) return null;
      if (!Number.isFinite(duration)) return null;
      return duration / timescale;
    }
    return null; // moov present but no mvhd
  }
  return null;
}
