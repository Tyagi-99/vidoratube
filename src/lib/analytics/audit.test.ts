import { describe, expect, it } from "vitest";
import { runChannelAudit, type AuditInput, type AuditVideo } from "./audit";

function vid(over: Partial<AuditVideo> & { youtubeVideoId: string }): AuditVideo {
  return {
    title: "v",
    publishedAt: null,
    ctr: 3,
    retentionPct: 40,
    description: "desc",
    tags: ["a"],
    ...over,
  };
}

const base: AuditInput = { videos: [], channelSnapshots: [], channelName: "Test" };

describe("runChannelAudit", () => {
  it("returns no findings when there is nothing to audit", () => {
    expect(runChannelAudit(base)).toEqual([]);
  });

  it("flags a long upload gap with evidence (D140)", () => {
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const findings = runChannelAudit({
      ...base,
      videos: [vid({ youtubeVideoId: "a", publishedAt: old, title: "Oldie" })],
    });
    const f = findings.find((x) => x.rule === "upload_cadence")!;
    expect(f.severity).toBe("action");
    expect(f.evidence[0]!.ref).toBe("a");
    expect(f.evidence[0]!.detail).toContain("published_at=");
    // AI-labeled guidance, never a guarantee
    expect(f.guidanceKind).toBe("ai_analysis");
    expect(f.guidance).toMatch(/AI analysis/);
    expect(f.guidance).toMatch(/not a guaranteed fix/i);
  });

  it("flags declining CTR with per-video evidence", () => {
    const day = 86_400_000;
    const now = Date.now();
    const videos = [2, 2, 2, 5, 5, 5].map((ctr, i) =>
      vid({
        youtubeVideoId: `v${i}`,
        title: `Video ${i}`,
        publishedAt: new Date(now - i * day).toISOString(),
        ctr,
      }),
    );
    const findings = runChannelAudit({ ...base, videos });
    const f = findings.find((x) => x.rule === "ctr_trend")!;
    expect(f.title).toMatch(/CTR declining/);
    expect(f.evidence).toHaveLength(6);
    expect(f.detail).toContain("2.0%");
  });

  it("does not flag CTR trend with fewer than 6 videos", () => {
    const videos = [vid({ youtubeVideoId: "a", ctr: 1 }), vid({ youtubeVideoId: "b", ctr: 9 })];
    expect(runChannelAudit({ ...base, videos }).find((x) => x.rule === "ctr_trend")).toBeUndefined();
  });

  it("flags retention below the documented niche baseline", () => {
    const videos = ["a", "b", "c"].map((id) => vid({ youtubeVideoId: id, retentionPct: 20 }));
    const findings = runChannelAudit({ ...base, videos });
    const f = findings.find((x) => x.rule === "retention_baseline")!;
    expect(f.detail).toMatch(/35%/); // baseline cited, labeled as reference
    expect(f.guidanceKind).toBe("ai_analysis");
  });

  it("flags incomplete metadata per video", () => {
    const findings = runChannelAudit({
      ...base,
      videos: [vid({ youtubeVideoId: "a", description: "", tags: [] })],
    });
    const f = findings.find((x) => x.rule === "metadata_completeness")!;
    expect(f.severity).toBe("info");
    expect(f.evidence[0]!.detail).toContain("description");
    expect(f.evidence[0]!.detail).toContain("tags");
    expect(f.guidanceKind).toBe("descriptive");
  });

  it("flags stalled subscriber growth citing snapshot rows", () => {
    const findings = runChannelAudit({
      ...base,
      channelSnapshots: [
        { id: "s1", captured_at: new Date(Date.now() - 40 * 86_400_000).toISOString(), subscriber_count: 1000, video_count: 10, view_count: 50000 },
        { id: "s2", captured_at: new Date().toISOString(), subscriber_count: 990, video_count: 10, view_count: 51000 },
      ],
    });
    const f = findings.find((x) => x.rule === "growth_stall")!;
    expect(f.evidence.map((e) => e.ref)).toEqual(["s1", "s2"]);
    expect(f.evidence[0]!.kind).toBe("channel_snapshots");
  });

  it("stays silent on healthy channels", () => {
    const day = 86_400_000;
    const now = Date.now();
    const videos = Array.from({ length: 6 }, (_, i) =>
      vid({
        youtubeVideoId: `v${i}`,
        title: `V${i}`,
        publishedAt: new Date(now - i * 3 * day).toISOString(),
        ctr: 5,
        retentionPct: 45,
      }),
    );
    const findings = runChannelAudit({
      ...base,
      videos,
      channelSnapshots: [
        { id: "s1", captured_at: new Date(now - 40 * day).toISOString(), subscriber_count: 1000, video_count: 10, view_count: 1 },
        { id: "s2", captured_at: new Date(now).toISOString(), subscriber_count: 1500, video_count: 16, view_count: 2 },
      ],
    });
    expect(findings).toEqual([]);
  });
});
