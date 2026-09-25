# P8 Plan: Analytics & Learning Loop

## Goal
Close the flywheel: pull YouTube performance data, show creators what works,
and feed learnings back into research (P3) and the safety score (P6).

## Why
The product promise is a loop: research → create → publish → learn → better
research. Without analytics, VidoraTube is a one-way tool. With it, every
video makes the next one smarter.

## Scope

### 1. YouTube Analytics ingestion
- OAuth `youtube.readonly` scope (already justified in GOOGLE_VERIFICATION.md)
- Pull per-video: views, watch time, CTR, average view duration, likes,
  comments, subscriber change
- 24h and 7d snapshots after publish (scheduled server function / cron)
- Store in `video_analytics` (video_id, snapshot_at, metrics JSONB)

### 2. Analytics dashboard
- Per-video performance cards: views, CTR, retention vs channel average
- Channel overview: totals, top performers, trend
- Honest empty states until data exists

### 3. Learning loop
- **Outlier feedback**: videos that outperform channel median → auto-flagged
  as new outliers in P3 (with source = "own channel")
- **Pattern extraction**: which hooks/titles/styles correlate with high CTR
  (simple correlation, labeled as correlation not causation)
- **Idea scoring boost**: P3 idea generator weights patterns from own winners
- **Safety correlation**: track safety score vs actual monetization status
  (limited/monetized) to validate the P6 model over time

### 4. Reports
- Weekly digest: top video, what worked, 3 suggestions (email or in-app)
- Export CSV

## Data model (migration)
- `video_analytics` (id, publish_job_id, youtube_video_id, snapshot_at, metrics JSONB)
- `channel_stats` (id, user_id, snapshot_at, metrics JSONB)
- `learning_insights` (id, user_id, kind, payload JSONB, created_at)

## Constraints
- Quota: analytics API calls are cheap but batch them; daily sync max
- No fake insights: only report on real data; "not enough data yet" states
- Correlation ≠ causation labels on pattern claims
- i18n en/hi

## Deliverables
1. Migration(s)
2. `src/lib/analytics.ts` (metric computation, pure + tested)
3. YouTube Analytics API client (reuse OAuth)
4. Snapshot scheduler (document cron; implement server function)
5. Dashboard UI
6. Learning loop: outlier feedback + idea boost + safety validation
7. Weekly digest
8. Tests: metric math, snapshot dedupe, insight generation
9. CHANGELOG entry

## Verification
- tsc clean, vitest green, build clean
- Snapshot dedupe tested (same day → one row)
- Insight generation on fixture data
