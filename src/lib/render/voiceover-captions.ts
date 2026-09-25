/** Client-safe caption PNG for Mode 2 compose (mirrors browser-render caption look). */

import type { CaptionLanguage } from "../languages";
import { primaryFontName } from "../languages";

type CaptionLook = { font: string; size: number; color: string; maxLines: number; bg: string };

function captionLook(style: string | undefined, height: number, family?: string): CaptionLook {
  const unit = height / 1080;
  const fam = family ?? null;
  if (style === "sleep")
    return {
      font: `500 ${Math.round(40 * unit)}px ${fam ?? "Manrope"}, system-ui, sans-serif`,
      size: Math.round(40 * unit),
      color: "rgba(255,255,255,0.82)",
      maxLines: 2,
      bg: "rgba(0,0,0,0)",
    };
  if (style === "dynamic" || style === "energetic")
    return {
      font: `800 ${Math.round(64 * unit)}px ${fam ?? "Sora"}, system-ui, sans-serif`,
      size: Math.round(64 * unit),
      color: "#ffffff",
      maxLines: 2,
      bg: "rgba(0,0,0,0.35)",
    };
  return {
    font: `600 ${Math.round(50 * unit)}px ${fam ?? "Manrope"}, system-ui, sans-serif`,
    size: Math.round(50 * unit),
    color: "#ffffff",
    maxLines: 3,
    bg: "rgba(0,0,0,0.28)",
  };
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length >= maxLines) break;
    } else {
      cur = next;
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  return lines.slice(0, maxLines);
}

export async function captionPngForCompose(
  text: string,
  width: number,
  height: number,
  style?: string,
  language?: CaptionLanguage,
): Promise<Uint8Array> {
  // Wait for webfonts so captions don't silently fall back to a system font.
  try {
    await Promise.race([
      document.fonts.ready,
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  } catch {
    /* fonts API unavailable — proceed with fallbacks */
  }
  // Language behaviour comes from the languages table (data), never from
  // hardcoded language branches.
  const family = language ? primaryFontName(language.fontStack) : undefined;
  const look = captionLook(style, height, family);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.clearRect(0, 0, width, height);
  ctx.font = look.font;
  ctx.direction = language?.rtl ? "rtl" : "ltr";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const maxWidth = width * 0.86;
  const lines = wrapText(ctx, text, maxWidth, look.maxLines);
  const lineHeight = look.size * 1.25;
  const block = lineHeight * lines.length + look.size * 0.8;
  const top = height - block - height * 0.08;
  if (look.bg !== "rgba(0,0,0,0)") {
    ctx.fillStyle = look.bg;
    const padX = look.size;
    const boxW = Math.min(maxWidth + padX * 2, width * 0.94);
    ctx.fillRect((width - boxW) / 2, top - look.size * 0.35, boxW, block);
  }
  ctx.shadowColor = "rgba(0,0,0,0.75)";
  ctx.shadowBlur = look.size * 0.25;
  ctx.fillStyle = look.color;
  lines.forEach((line, i) => {
    ctx.fillText(line, width / 2, top + lineHeight * (i + 0.5));
  });
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Caption render failed"))), "image/png"),
  );
  return new Uint8Array(await blob.arrayBuffer());
}
