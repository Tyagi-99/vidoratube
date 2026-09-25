# P3 Plan: Research / Idea Engine

## Goal
Give VidoraTube a top-of-funnel: niche discovery → outlier analysis → title/idea
generation → script brief. Currently the app starts at "paste a script" with no
research tools (audit finding A10).

## Why
Creators don't start with scripts — they start with "what should I make?"
The research → idea → script → video loop is the core product flywheel and
the monetization-safety story starts here (original, advertiser-safe angles).

## Scope

### 1. Niche explorer
- User enters a broad topic (e.g. "personal finance India")
- LLM generates: sub-niches, audience personas, content pillars, monetization
  fit (advertiser-safe rating per niche)
- Store as `research_projects`

### 2. Outlier analyzer
- User pastes YouTube video URLs/titles (or channel handle)
- Fetch via YouTube Data API (already connected): title, views, publishedAt,
  channel subs
- Compute outlier score: views vs channel median (e.g. 5x median = outlier)
- LLM extracts: hook pattern, packaging pattern, why it outperformed
- Store videos + scores in `outlier_videos`

### 3. Idea generator
- Input: niche + outlier patterns + count
- LLM generates video ideas: title, hook (first 3 seconds), angle, format
  (long/short), estimated difficulty, monetization-safety flag
- User can save/bookmark ideas, dismiss bad ones
- Store in `video_ideas` with status (new/saved/dismissed/used)

### 4. Script brief handoff
- "Use this idea" → creates a script project pre-filled with title, hook,
  angle, target duration → flows into existing Mode 1/2/3 pipelines
- No changes to render pipelines

## Data model (new migration)
- `research_projects` (id, user_id, topic, niches JSONB, created_at)
- `outlier_videos` (id, project_id, youtube_id, title, views, channel_subs, outlier_score, patterns JSONB)
- `video_ideas` (id, project_id, title, hook, angle, format, difficulty, safety_flag, status)

RLS: owner-only. All LLM calls go through the existing provider abstraction
(Lovable AI gateway) with cost logging.

## Constraints
- YouTube Data API quota: cache channel/video lookups 24h; show quota usage
- Rate limit: research generations 20/hour (reuse P1 rate limiter)
- No fake data: outlier scores computed from real API numbers only
- i18n: UI strings in en + hi from day one (follow existing i18n pattern)
- Billing: each LLM generation debits 1 credit via existing idempotent path

## UI
- New `/research` route (authenticated): project list → project detail
  (tabs: Niches | Outliers | Ideas)
- Outlier import: paste URLs or channel handle
- Idea cards: save/dismiss/use-idea actions

## Deliverables
1. Migration for 3 tables + RLS
2. `src/lib/research.functions.ts` (zod-validated server functions)
3. `src/lib/outliers.ts` (score computation, pure + tested)
4. `/research` routes + components
5. Idea → script project handoff
6. Tests: outlier scoring, idea validation, RLS
7. CHANGELOG entry

## Verification
- tsc clean, vitest green, build clean
- Outlier score math verified with known fixtures
- Idea → script handoff creates a working project
- Quota caching prevents duplicate API calls (test with mock)
