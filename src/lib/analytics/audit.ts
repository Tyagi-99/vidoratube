/**
 * Phase 4 · Stream B — F33 Channel Audit (rule-based health checks).
 *
 * D140: findings are DESCRIPTIVE or AI-LABELED — never presented as
 * guaranteed fixes. Every finding cites its evidence (snapshot ids/dates and
 * the values the rule fired on), so the user can verify each claim.
 *
 * Rules run over `channel_snapshots` (subscriber/video/view counters over
 * time) plus per-video analytics (upload cadence, CTR trend, retention vs a
 * documented niche baseline, metadata completeness).
 */

export type FindingSeverity = "info" | "watch" | "action";

export interface EvidenceItem {
  /** What the evidence is, e.g. "channel_snapshots row" / "video". */
  kind: string;
  ref: string;
  detail: string;
}

export interface AuditFinding {
  rule: string;
  severity: FindingSeverity;
  title: string;
  detail: string;
  evidence: EvidenceItem[];
  /** Optional next-step text. `guidanceKind` says what it is. */
  guidance: string | null;
  /** 'descriptive' = restates the data; 'ai_analysis' = an AI suggestion, not a guarantee. */
  guidanceKind: "descriptive" | "ai_analysis";
}

export interface AuditVideo {
  youtubeVideoId: string;
  title: string;
  publishedAt: string | null;
  ctr: number;
  retentionPct: number;
  description: string | null;
  tags: string[];
}

export interface ChannelSnapshotPoint {
  id: string;
  captured_at: string;
  subscriber_count: number | null;
  video_count: number | null;
  view_count: number | null;
}

export interface AuditInput {
  videos: AuditVideo[];
  channelSnapshots: ChannelSnapshotPoint[];
  channelName: string | null;
}

/** Documented niche baseline for retention (labeled assumption, not a fact). */
export const NICHE_RETENTION_BASELINE_PCT = 35;

const DAY = 86_400_000;

function aiGuidance(text: string): { guidance: string; guidanceKind: "ai_analysis" } {
  return { guidance: `AI analysis — not a guaranteed fix: ${text}`, guidanceKind: "ai_analysis" };
}

/** Rule: upload cadence — gaps between published videos. */
function checkCadence(videos: AuditVideo[]): AuditFinding[] {
  const dated = videos
    .filter((v) => v.publishedAt)
    .sort((a, b) => +new Date(a.publishedAt!) - +new Date(b.publishedAt!));
  const findings: AuditFinding[] = [];
  if (dated.length === 0) return findings;

  const gaps: { after: AuditVideo; gapDays: number }[] = [];
  for (let i = 1; i < dated.length; i++) {
    const prev = dated[i - 1]!;
    const cur = dated[i]!;
    const gapDays = Math.round((+new Date(cur.publishedAt!) - +new Date(prev.publishedAt!)) / DAY);
    if (gapDays > 14) gaps.push({ after: cur, gapDays });
  }
  const latest = dated[dated.length - 1]!;
  const daysSinceLast = Math.round((Date.now() - +new Date(latest.publishedAt!)) / DAY);

  if (daysSinceLast > 21) {
    findings.push({
      rule: "upload_cadence",
      severity: "action",
      title: `No uploads in ${daysSinceLast} days`,
      detail: `The most recent published video ("${latest.title}") went live ${daysSinceLast} days ago. Channels with long gaps typically see slower subscriber growth.`,
      evidence: [{ kind: "video", ref: latest.youtubeVideoId, detail: `published_at=${latest.publishedAt}` }],
      ...aiGuidance("a steady cadence (e.g. 1–2 uploads/week) tends to correlate with steadier growth; pick a schedule you can sustain."),
    });
  } else if (gaps.length > 0) {
    const g = gaps[gaps.length - 1]!;
    findings.push({
      rule: "upload_cadence",
      severity: "watch",
      title: `${g.gapDays}-day gap between uploads`,
      detail: `There was a ${g.gapDays}-day gap before "${g.after.title}". Occasional gaps are normal; repeated ones slow momentum.`,
      evidence: gaps.slice(-3).map((x) => ({ kind: "video", ref: x.after.youtubeVideoId, detail: `gap_before=${x.gapDays}d, published_at=${x.after.publishedAt}` })),
      guidance: "Descriptive only: this is what your publishing history shows.",
      guidanceKind: "descriptive",
    });
  }
  return findings;
}

/** Rule: CTR trend — last 3 videos vs the 3 before. */
function checkCtrTrend(videos: AuditVideo[]): AuditFinding[] {
  const dated = videos.filter((v) => v.publishedAt).sort((a, b) => +new Date(b.publishedAt!) - +new Date(a.publishedAt!));
  if (dated.length < 6) return [];
  const recent = dated.slice(0, 3);
  const prior = dated.slice(3, 6);
  const avg = (xs: AuditVideo[]) => xs.reduce((a, v) => a + v.ctr, 0) / xs.length;
  const recentAvg = avg(recent);
  const priorAvg = avg(prior);
  const drop = priorAvg - recentAvg;
  if (drop > 1.0 && priorAvg > 0) {
    return [{
      rule: "ctr_trend",
      severity: "watch",
      title: `CTR declining: ${recentAvg.toFixed(1)}% vs ${priorAvg.toFixed(1)}%`,
      detail: `Your last 3 videos average ${recentAvg.toFixed(1)}% CTR, down ${drop.toFixed(1)} points from the 3 before (${priorAvg.toFixed(1)}%). Lower CTR usually means fewer impressions convert to views.`,
      evidence: [
        ...recent.map((v) => ({ kind: "video", ref: v.youtubeVideoId, detail: `recent ctr=${v.ctr.toFixed(1)}% "${v.title}"` })),
        ...prior.map((v) => ({ kind: "video", ref: v.youtubeVideoId, detail: `prior ctr=${v.ctr.toFixed(1)}% "${v.title}"` })),
      ],
      ...aiGuidance("compare the thumbnails/titles of the two groups side by side — the difference is often packaging, not the video itself."),
    }];
  }
  return [];
}

/** Rule: retention vs documented niche baseline. */
function checkRetentionBaseline(videos: AuditVideo[]): AuditFinding[] {
  const withRetention = videos.filter((v) => v.retentionPct > 0);
  if (withRetention.length < 3) return [];
  const avg = withRetention.reduce((a, v) => a + v.retentionPct, 0) / withRetention.length;
  if (avg < NICHE_RETENTION_BASELINE_PCT) {
    return [{
      rule: "retention_baseline",
      severity: "watch",
      title: `Retention ${avg.toFixed(0)}% is below the ${NICHE_RETENTION_BASELINE_PCT}% reference`,
      detail: `Across ${withRetention.length} videos, average retention is ${avg.toFixed(0)}%, below the ${NICHE_RETENTION_BASELINE_PCT}% reference baseline (a rough niche average, not a guarantee or a platform figure).`,
      evidence: withRetention.slice(0, 5).map((v) => ({ kind: "video", ref: v.youtubeVideoId, detail: `retention=${v.retentionPct.toFixed(0)}% "${v.title}"` })),
      ...aiGuidance("check the F32 retention view for where viewers leave — the weakest scene usually points at the fix."),
    }];
  }
  return [];
}

/** Rule: metadata completeness — missing descriptions/tags on published videos. */
function checkMetadata(videos: AuditVideo[]): AuditFinding[] {
  const incomplete = videos.filter(
    (v) => !v.description?.trim() || v.tags.length === 0,
  );
  if (incomplete.length === 0) return [];
  return [{
    rule: "metadata_completeness",
    severity: "info",
    title: `${incomplete.length} video${incomplete.length === 1 ? "" : "s"} with incomplete metadata`,
    detail: `${incomplete.length} published video(s) are missing a description or tags. Complete metadata helps search and suggested-video placement.`,
    evidence: incomplete.slice(0, 10).map((v) => ({
      kind: "video",
      ref: v.youtubeVideoId,
      detail: `missing=${[!v.description?.trim() && "description", v.tags.length === 0 && "tags"].filter(Boolean).join(", ")} "${v.title}"`,
    })),
    guidance: "Descriptive only: fill in the missing fields on the publish job.",
    guidanceKind: "descriptive",
  }];
}

/** Rule: subscriber growth stall from channel_snapshots. */
function checkGrowthStall(snaps: ChannelSnapshotPoint[]): AuditFinding[] {
  const withSubs = snaps.filter((s) => s.subscriber_count != null).sort((a, b) => +new Date(a.captured_at) - +new Date(b.captured_at));
  if (withSubs.length < 2) return [];
  const first = withSubs[0]!;
  const last = withSubs[withSubs.length - 1]!;
  const days = Math.max(1, Math.round((+new Date(last.captured_at) - +new Date(first.captured_at)) / DAY));
  if (days < 14) return []; // not enough history to judge
  const delta = (last.subscriber_count ?? 0) - (first.subscriber_count ?? 0);
  if (delta <= 0) {
    return [{
      rule: "growth_stall",
      severity: "watch",
      title: `Subscriber growth stalled over ${days} days`,
      detail: `Subscribers went from ${(first.subscriber_count ?? 0).toLocaleString()} to ${(last.subscriber_count ?? 0).toLocaleString()} over ${days} days (Δ ${delta >= 0 ? "+" : ""}${delta}).`,
      evidence: [
        { kind: "channel_snapshots", ref: first.id, detail: `captured_at=${first.captured_at}, subscribers=${first.subscriber_count}` },
        { kind: "channel_snapshots", ref: last.id, detail: `captured_at=${last.captured_at}, subscribers=${last.subscriber_count}` },
      ],
      ...aiGuidance("flat subscriber counts with steady views often mean viewers enjoy but don't subscribe — a clear subscribe call-to-action near the payoff can help."),
    }];
  }
  return [];
}

/** Run all audit rules. Pure. */
export function runChannelAudit(input: AuditInput): AuditFinding[] {
  if (input.videos.length === 0 && input.channelSnapshots.length === 0) return [];
  return [
    ...checkCadence(input.videos),
    ...checkCtrTrend(input.videos),
    ...checkRetentionBaseline(input.videos),
    ...checkMetadata(input.videos),
    ...checkGrowthStall(input.channelSnapshots),
  ];
}

export interface AuditReport {
  generatedAt: string;
  channelName: string | null;
  videoCount: number;
  snapshotCount: number;
  findings: AuditFinding[];
}

/** Server loader: gather inputs and run the audit. */
export async function loadChannelAudit(admin: any, userId: string): Promise<AuditReport> {
  // Per-video inputs.
  const { data: snaps } = await admin
    .from("video_analytics")
    .select("youtube_video_id, metrics")
    .eq("user_id", userId)
    .order("snapshot_date", { ascending: false });
  const latest = new Map<string, any>();
  for (const s of (snaps ?? []) as any[]) {
    if (!latest.has(s.youtube_video_id)) latest.set(s.youtube_video_id, s.metrics ?? {});
  }
  let videos: AuditVideo[] = [];
  if (latest.size > 0) {
    const { data: jobs } = await admin
      .from("publish_jobs")
      .select("youtube_video_id, title, published_at, description, tags")
      .eq("user_id", userId)
      .in("youtube_video_id", [...latest.keys()]);
    videos = ((jobs ?? []) as any[]).map((j) => {
      const m = latest.get(j.youtube_video_id) ?? {};
      const retentionPct =
        m.videoDurationSec > 0 ? Math.min(100, (Number(m.avgViewDurationSec ?? 0) / m.videoDurationSec) * 100) : 0;
      return {
        youtubeVideoId: j.youtube_video_id,
        title: j.title ?? "Untitled",
        publishedAt: j.published_at ?? null,
        ctr: Number(m.ctr ?? 0),
        retentionPct,
        description: j.description ?? null,
        tags: Array.isArray(j.tags) ? j.tags : [],
      };
    });
  }

  // Channel snapshots: own tracked channels.
  const { data: channels } = await admin
    .from("channels")
    .select("id, title")
    .eq("user_id", userId)
    .eq("tracked", true)
    .limit(5);
  let channelSnapshots: ChannelSnapshotPoint[] = [];
  let channelName: string | null = null;
  if (channels && channels.length > 0) {
    channelName = channels[0].title ?? null;
    const { data: cshots } = await admin
      .from("channel_snapshots")
      .select("id, captured_at, subscriber_count, video_count, view_count")
      .in("channel_id", channels.map((c: any) => c.id))
      .order("captured_at", { ascending: true })
      .limit(120);
    channelSnapshots = (cshots ?? []) as ChannelSnapshotPoint[];
  }

  return {
    generatedAt: new Date().toISOString(),
    channelName,
    videoCount: videos.length,
    snapshotCount: channelSnapshots.length,
    findings: runChannelAudit({ videos, channelSnapshots, channelName }),
  };
}
