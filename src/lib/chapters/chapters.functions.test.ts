import { describe, expect, it } from "vitest";
import {
  buildChapterRenderRow,
  buildChapterRows,
  buildRerenderChapterPatch,
} from "./chapters.functions";
import { buildContinuityBrief } from "./brief";
import { splitScriptIntoChapters } from "./split";
import type { CachedParagraph } from "./tts-cache.server";

function makeScript(paragraphs: number, wordsPerParagraph = 150): string {
  return Array.from({ length: paragraphs }, (_, i) =>
    `Paragraph ${i + 1}. ${Array.from({ length: wordsPerParagraph }, () => `word${i}`).join(" ")}`,
  ).join("\n\n");
}

function fakeNarration(chapters: { index: number; paragraphs: string[] }[]): Map<number, CachedParagraph[]> {
  const m = new Map<number, CachedParagraph[]>();
  for (const c of chapters) {
    m.set(
      c.index,
      c.paragraphs.map((text, i) => ({
        text,
        audioPath: `tts-cache/h-${c.index}-${i}.mp3`,
        durationSeconds: 60,
      })),
    );
  }
  return m;
}

describe("buildChapterRows", () => {
  it("creates one queued row per chapter with cached narration attached", () => {
    const chapters = splitScriptIntoChapters(makeScript(12));
    const rows = buildChapterRows("render-1", chapters, fakeNarration(chapters));
    expect(rows).toHaveLength(chapters.length);
    rows.forEach((r, i) => {
      expect(r.render_id).toBe("render-1");
      expect(r.chapter_index).toBe(i + 1);
      expect(r.status).toBe("queued");
      expect(r.attempts).toBe(0);
      expect(r.max_attempts).toBe(3);
      const paras = r.paragraphs as { audio_path: string }[];
      expect(paras.length).toBeGreaterThan(0);
      for (const p of paras) expect(p.audio_path).toMatch(/^tts-cache\//);
    });
  });

  it("keeps chapter order stable", () => {
    const chapters = splitScriptIntoChapters(makeScript(12));
    const rows = buildChapterRows("render-1", chapters, fakeNarration(chapters));
    expect(rows.map((r) => r.chapter_index)).toEqual(chapters.map((c) => c.index));
  });
});

describe("buildChapterRenderRow", () => {
  const brief = buildContinuityBrief({ voiceId: "v1", languageCode: "en" });

  it("marks the parent row as chapter mode with the brief in meta", () => {
    const row = buildChapterRenderRow({
      userId: "user-1",
      groupId: "group-1",
      aspect: "16:9",
      title: "Long video",
      fps: 30,
      burnCaptions: true,
      mode: "story",
      totalSeconds: 1200,
      expectedCredits: 20,
      expectedMinutes: 20,
      brief,
    });
    const meta = row.meta as Record<string, unknown>;
    expect(meta["chapterMode"]).toBe(true);
    expect(meta["continuityBrief"]).toEqual(brief);
    expect(meta["expected_credits"]).toBe(20);
    expect(meta["expected_minutes"]).toBe(20);
    expect(row.engine).toBe("server_ffmpeg");
    expect(row.status).toBe("queued");
    expect(row.reserved_minutes).toBe(20);
    expect(row.aspect_ratio).toBe("16:9");
  });

  it("carries a synthetic scene so schema validation still passes", () => {
    const row = buildChapterRenderRow({
      userId: "user-1",
      groupId: "group-1",
      aspect: "9:16",
      title: "t",
      fps: 30,
      burnCaptions: false,
      mode: "story",
      totalSeconds: 600,
      expectedCredits: 10,
      expectedMinutes: 10,
      brief,
    });
    const scenes = (row.meta as { scenes: { duration: number }[] }).scenes;
    expect(scenes).toHaveLength(1);
    expect(scenes[0]!.duration).toBe(600);
  });
});

describe("buildRerenderChapterPatch", () => {
  it("resets exactly one chapter to queued and clears its output", () => {
    const patch = buildRerenderChapterPatch({
      scriptText: "New text for chapter two.",
      paragraphs: [
        { text: "New text for chapter two.", audioPath: "tts-cache/new.mp3", durationSeconds: 12 },
      ],
    });
    expect(patch.status).toBe("queued");
    expect(patch.attempts).toBe(0);
    expect(patch.output_path).toBeNull();
    expect(patch.error).toBeNull();
    expect(patch.claimed_at).toBeNull();
    expect(patch.script_text).toBe("New text for chapter two.");
    const paras = patch.paragraphs as { audio_path: string; duration_seconds: number }[];
    expect(paras[0]).toMatchObject({ audio_path: "tts-cache/new.mp3", duration_seconds: 12 });
  });
});
