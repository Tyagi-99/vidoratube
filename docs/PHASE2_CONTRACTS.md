# Phase 2 (Intelligence) — Shared Contracts

Pinned 2026-09-28 by the Phase 2 coordinator BEFORE any stream code.
All four streams implement against this file. If a stream needs a change,
it proposes it to the coordinator — no unilateral contract edits.

## File ownership (no two streams touch the same file)

| Stream | Owns |
|---|---|
| A — ingestion | `src/lib/intelligence/youtube-api.server.ts`, `src/lib/intelligence/snapshots.server.ts`, `src/lib/intelligence/channels.functions.ts`, `src/lib/intelligence/videos.functions.ts`, `src/lib/intelligence/*.test.ts` (its own), migration `20260928030000_p2_youtube_quota.sql` if needed |
| B — niches/trends/blueprints | `src/lib/intelligence/scoring.ts`, `src/lib/intelligence/niches.functions.ts`, `src/lib/intelligence/trends.functions.ts`, `src/lib/intelligence/blueprints.functions.ts`, `src/routes/_authenticated/intelligence/niches*.tsx`, `src/routes/_authenticated/intelligence/trends*.tsx` |
| C — explorer/outliers/video intel | `src/lib/intelligence/outliers.functions.ts`, `src/lib/intelligence/video-analysis.functions.ts`, `src/routes/_authenticated/intelligence/channels*.tsx`, `src/routes/_authenticated/intelligence/outliers*.tsx`, `src/routes/_authenticated/intelligence/videos.$videoId.tsx` |
| D — folders/shell/E2E | `src/lib/intelligence/folders.functions.ts`, `src/routes/_authenticated/intelligence/index.tsx`, `src/routes/_authenticated/intelligence/folders*.tsx`, `src/components/vidora/AppChrome.tsx` (nav only), `e2e/niche-finder.spec.ts` |
| Coordinator | `src/lib/intelligence/types.ts` (this file's TS companion), `docs/PHASE2_CONTRACTS.md` (this file) |

Shared test helpers (if needed): propose to coordinator first.

## Route tree (all under `src/routes/_authenticated/`)

```text
intelligence/index.tsx              → /intelligence            (hub, D)
intelligence/niches.index.tsx       → /intelligence/niches     (B)
intelligence/niches.$nicheId.tsx    → /intelligence/niches/$nicheId (B)
intelligence/channels.index.tsx     → /intelligence/channels   (C)
intelligence/channels.$channelId.tsx→ /intelligence/channels/$channelId (C)
intelligence/outliers.index.tsx     → /intelligence/outliers   (C)
intelligence/videos.$videoId.tsx    → /intelligence/videos/$videoId (C)
intelligence/trends.index.tsx       → /intelligence/trends     (B)
intelligence/folders.index.tsx      → /intelligence/folders    (D)
```

Nav: D adds `{ label: "Intelligence", to: "/intelligence" }` to AppChrome
after "Research". Hub page links to all six sections.

## Envelope convention

Every server function returns:

```ts
{ status: "ok", ...data }
| { status: "unconfigured", reason: string }   // YOUTUBE_API_KEY missing etc.
| { status: "insufficient_data", reason: string, ...partial? }
```

UI rule: `unconfigured` → honest "YouTube Data API not connected" panel
(founder action named). `insufficient_data` → `INSUFFICIENT DATA` empty
state. NEVER synthesize rows to fill a list.

## Shared types (`src/lib/intelligence/types.ts`, coordinator-owned)

```ts
export type Confidence = "high" | "medium" | "low";
export interface ScoreFactor {
  key: string;            // e.g. "demand", "competition", "velocity", "freshness"
  label: string;          // human label
  weight: number;         // 0..1, sums to 1
  value: number;          // 0..100 normalized
  detail: string;         // one-line explanation of how this value was derived
  evidenceCount: number;  // rows behind this factor (0 → factor marked weak)
}
export interface NicheScore {
  score0to100: number;
  factors: ScoreFactor[];
  confidence: Confidence;
  capturedAt: string;     // ISO
  source: "youtube-data-api";
  channelCount: number;   // channels behind the score
}
export interface OutlierScore {
  score: number;          // multiple of channel median (e.g. 3.2 = 3.2x)
  velocityPerDay: number | null; // views/day since first snapshot, null if <2 snapshots
  factors: ScoreFactor[];
  confidence: Confidence;
  snapshotsUsed: number;
}
export interface Freshness { capturedAt: string | null; staleAfterHours: number; }
```

Confidence rule (both scores): `high` ≥ 10 evidence channels / ≥ 3 snapshots;
`medium` ≥ 4; else `low`. Any factor with `evidenceCount === 0` renders with a
"weak evidence" badge and drags confidence down one level.

## Stream A — server functions (`channels.functions.ts`, `videos.functions.ts`)

All use `requireAppUser` middleware, zod input, envelope output above.
All YouTube calls go through `youtube-api.server.ts`, which:
- returns `{ status: "unconfigured" }` when `YOUTUBE_API_KEY` is absent,
- checks `youtube_api_cache` first (TTL: channels 24h, videos 6h, search 1h),
- records quota via existing `recordYouTubeQuota` in `src/lib/api-cost.ts`.

```ts
// channels.functions.ts
trackChannel({ externalChannelId: string, nicheId?: string }) → { status, channel: ChannelRow }
untrackChannel({ channelId: uuid }) → { status }
listChannels({ nicheId?: uuid, sort?: "subscribers"|"growth"|"recent", order?: "asc"|"desc" }) → { status, channels: ChannelCard[] }
getChannelDetail({ channelId: uuid }) → { status, channel, snapshots: ChannelSnapshot[], videos: VideoCard[], freshness: Freshness }
refreshChannel({ channelId: uuid }) → { status, channel, snapshot }  // no-op if cache fresh
searchChannels({ query: string, maxResults?: number }) → { status, channels: ChannelCard[] } // via channels.list(id=...) or search.list type=channel

// videos.functions.ts
listVideos({ channelId?: uuid, sort?: "views"|"outlier"|"recent", max?: number }) → { status, videos: VideoCard[] }
getVideoDetail({ videoId: uuid }) → { status, video, snapshots: VideoSnapshot[], outlier: OutlierScore | null }
refreshVideo({ videoId: uuid }) → { status, video, snapshot }
compareVideos({ videoIds: [uuid, uuid, uuid] }) → { status, videos: VideoDetail[] }  // exactly 3, zod enforces
draftIdeaFromVideo({ videoId: uuid }) → { status, ideaId: uuid, researchProjectId: uuid }
// draftIdeaFromVideo: finds/creates research_project "Outlier drafts", inserts
// video_ideas row (title/hook/angle from video; format 'long'|'short' by duration),
// returns ids. This is the F4 one-click handoff B and C both call.
```

`ChannelCard = { id, externalChannelId, handle, title, subscriberCount, videoCount, viewCount, growth7dPct: number|null, lastSnapshotAt, freshness }`
`VideoCard = { id, externalVideoId, title, thumbnailUrl, publishedAt, durationSeconds, viewCount, outlierScore: number|null, channelTitle }`

## Stream B — server functions

```ts
// niches.functions.ts
createNiche({ name, keywords: string[], language?, format?: "long"|"short"|"both", minSubs?, maxSubs?, activeOnly?: boolean }) → { status, niche }
listNiches() → { status, niches: (NicheRow & { latestScore: NicheScore | null })[] }
getNicheDetail({ nicheId }) → { status, niche, score: NicheScore | null, channels: ChannelCard[], snapshots: NicheSnapshot[] }
scoreNiche({ nicheId }) → { status, score: NicheScore }  // recompute; persists niche_snapshots row
deleteNiche({ nicheId }) → { status }

// blueprints.functions.ts
generateBlueprint({ nicheId }) → { status, blueprint }   // deterministic from niche data + tracked channels; NO LLM in Phase 2 (D74 precedent: free, instant, auditable)
getBlueprint({ nicheId }) → { status, blueprint | null }
// blueprint persisted on niches.blueprint jsonb — needs migration column (B owns migration 20260928030100_p2_blueprint.sql)

// trends.functions.ts
getTrendRadar({ nicheId?, max?: number }) → { status, trends: Trend[] }
// Trend = { id, topic, score0to100, factors: ScoreFactor[], confidence, sources: {title, url, publishedAt}[], capturedAt }
// Phase 2: trends derived from video_snapshots velocity + search results; each
// trend stores ≥1 research_sources row (source_type 'video'|'web') — citations mandatory.
```

Niche filters (F1): language, format, subs range, active-only, recent activity —
implemented as `niches` columns + `scoreNiche` honoring them; UI filter bar on
`/intelligence/niches`.

## Stream C — server functions

```ts
// outliers.functions.ts
listOutliers({ nicheId?, minScore?: number, sort?: "score"|"velocity"|"recent" }) → { status, outliers: (VideoCard & { outlier: OutlierScore })[] }
getSimilarChannels({ channelId, max?: number }) → { status, channels: ChannelCard[] }
// similar: same niche + subscriber band (±1 order of magnitude); labeled ESTIMATE-based heuristic in UI.

// video-analysis.functions.ts
analyzeVideo({ videoId }) → { status, analysis: VideoAnalysis }
// VideoAnalysis = { video: VideoDetail, outlier: OutlierScore|null, packaging: {title, thumbnailUrl, titleLength, hasNumber, hasQuestion} (descriptive only, no CTR claims), publishing: {publishedAt, dayOfWeek, hourUTC}, performance: {views, viewsPerDay, likeCount}, aiNotes: string[] labeled "AI analysis" }
```

F5 3-video compare: UI calls existing `compareVideos` (A) + `analyzeVideo` per video.

## Stream D — server functions

```ts
// folders.functions.ts
createFolder({ name, description? }) → { status, folder }
listFolders() → { status, folders: (FolderRow & { itemCount: number, ruleCount: number })[] }
updateFolder({ folderId, name?, description? }) → { status, folder }
deleteFolder({ folderId }) → { status }
addRule({ folderId, field, operator, value }) → { status, rule }   // zod: operator enum eq|neq|gt|gte|lt|lte|contains|in
removeRule({ ruleId }) → { status }
pinItem({ folderId, itemType, itemId }) → { status }               // itemType: 'videos'|'video_ideas'|'research_sources'|'channels'
unpinItem({ folderId, itemType, itemId }) → { status }
getFolderContents({ folderId }) → { status, pinned: FolderItem[], ruleMatched: FolderItem[] }
// ruleMatched: evaluated server-side against videos (outlier_score via latest
// snapshot math), video_ideas (status), research_sources (source_type).
// Supported rule fields (pinned): videos.view_count, videos.outlier_score,
// videos.published_at, video_ideas.status, research_sources.source_type,
// channels.subscriber_count.
```

## E2E_NICHE_FINDER (D owns `e2e/niche-finder.spec.ts`)

Permanent spec. Query "faceless history mysteries", filters: language English,
format long-form, subs 1K–500K, active only, recent activity required.
Two modes:
- **With `YOUTUBE_API_KEY`**: full assertions — real channels only (no
  `DEMO`/placeholder rows), freshness labels visible, score factors expandable,
  sorting changes order, filters narrow results, folder save works,
  similar-channel search works, outlier tab lists scored videos, blueprint
  generates, idea project created via draft handoff.
- **Without key**: asserts every surface shows the unconfigured state and
  zero fabricated rows.

## Cross-cutting rules

- `requireAppUser` on every server function. RLS already covers Phase 1 tables.
- No `console.log` spam; use existing telemetry helpers where present.
- i18n: reuse existing `useI18n`/`t()` patterns; English strings fine for Phase 2.
- Tests colocated: `*.test.ts` next to module. Unit-test all scoring math
  with fixed fixtures (deterministic, no network).
- UI states required per page: loading skeleton, empty, error, unconfigured,
  insufficient-data, permission-denied where applicable.
- No virality/CTR/revenue guarantees anywhere. AI text labeled "AI analysis".
  Estimates labeled **ESTIMATE**.
