/**
 * Static wiring audit for rerenderChapter (P1, 2026-09-29 QA).
 *
 * rerenderChapter performs cache-miss ElevenLabs TTS. This test proves the
 * handler source wires the same protections as the main chapter path:
 * rate limiting, a credit pre-reserve BEFORE any synthesis call, and a
 * settle (refund estimate + exact debit) after.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(join(__dirname, "chapters.functions.ts"), "utf8");

/** Source of the rerenderChapter handler (from its export to the file end). */
function rerenderSrc(): string {
  const idx = SRC.indexOf("export const rerenderChapter");
  expect(idx).toBeGreaterThan(-1);
  return SRC.slice(idx);
}

describe("rerenderChapter billing wiring (static audit)", () => {
  it("rate-limits re-renders before any TTS", () => {
    const src = rerenderSrc();
    expect(src).toContain("render:chapter-rerender:");
    const rateIdx = src.indexOf("render:chapter-rerender:");
    const synthIdx = src.indexOf("synthesizeParagraphsCached", rateIdx);
    expect(synthIdx).toBeGreaterThan(rateIdx);
  });

  it("pre-reserves credits BEFORE any ElevenLabs synthesis", () => {
    const src = rerenderSrc();
    expect(src).toContain("rerenderReserveRef");
    expect(src).toContain("Chapter re-render pre-reserve");
    const reserveIdx = src.indexOf("Chapter re-render pre-reserve");
    const synthIdx = src.indexOf("await synthesizeParagraphsCached(");
    expect(synthIdx).toBeGreaterThan(-1);
    expect(reserveIdx).toBeLessThan(synthIdx);
  });

  it("settles after synthesis: refunds the estimate and debits the exact quote", () => {
    const src = rerenderSrc();
    expect(src).toContain("Refund: chapter re-render pre-reserve settled");
    expect(src).toContain("rerenderTrueQuote");
  });

  it("passes the project scope so budget caps apply", () => {
    const src = rerenderSrc();
    expect(src).toContain("rerenderScope");
    expect(src).toContain("p_project_id: rerenderScope.projectId ?? null");
  });

  it("translates budget-exceeded RPC errors into friendly messages", () => {
    const src = rerenderSrc();
    expect(src).toContain("WORKSPACE_BUDGET_EXCEEDED");
    expect(src).toContain("PROJECT_BUDGET_EXCEEDED");
  });
});
