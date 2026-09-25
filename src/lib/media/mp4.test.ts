import { describe, expect, it } from "vitest";
import { looksLikeMp4Container, parseMp4Duration } from "./mp4";

function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, out.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** mvhd v0: version(1) flags(3) creation(4) modification(4) timescale(4) duration(4) */
function mvhdV0(timescale: number, duration: number): Uint8Array {
  const payload = new Uint8Array(20);
  const view = new DataView(payload.buffer);
  view.setUint8(0, 0);
  view.setUint32(12, timescale);
  view.setUint32(16, duration);
  return box("mvhd", payload);
}

/** mvhd v1: version(1) flags(3) creation(8) modification(8) timescale(4) duration(8) */
function mvhdV1(timescale: number, duration: number): Uint8Array {
  const payload = new Uint8Array(32);
  const view = new DataView(payload.buffer);
  view.setUint8(0, 1);
  view.setUint32(20, timescale);
  view.setUint32(28, duration); // low 32 bits; high stays 0
  return box("mvhd", payload);
}

const ftyp = box("ftyp", new TextEncoder().encode("isom0000isomiso2"));

describe("parseMp4Duration", () => {
  it("reads a v0 mvhd", () => {
    const mp4 = concat(ftyp, box("moov", mvhdV0(1000, 90_000)));
    expect(parseMp4Duration(mp4)).toBe(90);
  });

  it("reads a v1 mvhd with 64-bit duration", () => {
    const mp4 = concat(ftyp, box("moov", mvhdV1(48_000, 96_000)));
    expect(parseMp4Duration(mp4)).toBe(2);
  });

  it("finds mvhd among sibling boxes", () => {
    const free = box("free", new Uint8Array(8));
    const mp4 = concat(ftyp, box("moov", concat(free, mvhdV0(25, 250), free)));
    expect(parseMp4Duration(mp4)).toBe(10);
  });

  it("returns null without a moov box", () => {
    expect(parseMp4Duration(concat(ftyp, box("mdat", new Uint8Array(16))))).toBeNull();
  });

  it("returns null when moov has no mvhd", () => {
    expect(parseMp4Duration(concat(ftyp, box("moov", box("free", new Uint8Array(8)))))).toBeNull();
  });

  it("returns null for garbage input", () => {
    expect(parseMp4Duration(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(parseMp4Duration(new Uint8Array(0))).toBeNull();
    expect(parseMp4Duration(new TextEncoder().encode("not an mp4 at all...."))).toBeNull();
  });

  it("returns null for zero timescale", () => {
    const mp4 = concat(ftyp, box("moov", mvhdV0(0, 1000)));
    expect(parseMp4Duration(mp4)).toBeNull();
  });

  it("returns null for a truncated mvhd", () => {
    const full = mvhdV0(1000, 5000);
    const truncated = full.slice(0, 8 + 10); // header + 10 bytes of payload
    expect(parseMp4Duration(concat(ftyp, box("moov", truncated)))).toBeNull();
  });

  it("accepts Uint8Array views over larger buffers", () => {
    const mp4 = concat(ftyp, box("moov", mvhdV0(1000, 12_345)));
    const padded = new Uint8Array(mp4.length + 64);
    padded.set(mp4, 32);
    expect(parseMp4Duration(padded.subarray(32, 32 + mp4.length))).toBe(12.345);
  });
});

describe("looksLikeMp4Container", () => {
  it("sniffs ftyp", () => {
    expect(looksLikeMp4Container(ftyp)).toBe(true);
    expect(looksLikeMp4Container(new Uint8Array(20))).toBe(false);
  });
});
