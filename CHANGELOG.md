# Changelog

## 2026-09-25 — P6: Monetization Safety Score

The product's core differentiator: a versioned, explainable pre-publish
demonetization risk score — "the AI YouTube studio built to keep your channel monetized."

### Scoring engine (`src/lib/safety.ts`, pure + fully tested)
- 5 dimensions summing to 100: advertiser-friendliness (30), copyright (25),
  originality (20), metadata honesty (15), policy compliance (10).
- Bands: 90+ safe (green), 70–89 minor (yellow), 50–69 at-risk (orange), <50 high-risk (red).
- Profanity/sexual/violence/drugs/tragedy detection with a density penalty for
  saturated scripts; compounding penalty for multiple critical violations.
- Copyright from P4 provenance records; originality via shingle-Jaccard vs P3
  outlier titles; metadata honesty via clickbait/title-content mismatch checks;
  policy via made-for-kids, medical/financial disclaimers, synthetic disclosure.
- `SAFETY_SCORE_VERSION = "1.0"` stored with every score.
- 26 tests: clean script → 90+, profanity-saturated → at-risk, sexual+violent →
  high-risk, borderline → 70s, publish-gate decisions.

### Server functions (`src/lib/safety.functions.ts`)
- `scoreProject`: gathers script + SEO metadata + provenance + outlier titles +
  made-for-kids, stores versioned score. 1 credit, rate-limited, zod-validated.
- `getSafetyScore`: latest + history (free).
- `requestDeepReview`: LLM subtle-issue review for 50–89 scores, 1 credit,
  explicitly labeled "AI opinion — not a guarantee."
- `rewriteFlaggedSpan` ("Fix with AI"): rewrites a flagged script span, 1 credit.
- `updateProjectScript`: owner-only script update for applying rewrites.

### Publish gate (server-enforced)
- `approvePublishJob`: score < 50 blocks approval unless `safety_override`
  is explicitly acknowledged; the override + score are recorded on the job.
- PublishPipeline review step shows the score; the approve button stays
  disabled until the risk acknowledgment is checked.

### UI
- Safety section on the project page: score dial, band badge, dimension bars,
  issue list with fix suggestions, AI deep review, score history.
- Honesty everywhere: "Risk estimate based on public YouTube policy signals —
  YouTube decides monetization, this is not a guarantee." Whole numbers, bands,
  no fake precision. Never claims guaranteed monetization.
- English + Hindi i18n for all new UI.

### Data model
- `safety_scores` table (project_id, version, score, band, dimensions/issues
  JSONB, ai_review JSONB), owner-only RLS.
- `publish_jobs` gains `safety_score` + `safety_override` columns.

## 2026-09-25 — P5: Thumbnail/SEO Studio + YouTube Publishing

### Thumbnail studio
- AI generates 3 variants × 2 aspects (16:9 + 9:16) via the Lovable gateway image model.
- Text overlay editor: headline, font, color, position — validated, stored per variant.
- Variant selection persisted; selected variant used at publish time.
- Final overlay-burned image uploaded to YouTube via `thumbnails.set`.

### SEO studio
- LLM generates 3 title candidates; deterministic scoring (length/keyword/curiosity/clarity) ranks them.
- Clickbait patterns penalized in scoring.
- Description builder: hook + summary + chapters + CTA + hashtags (≤4900 chars).
- Tag suggester merges niche keywords + outlier terms, deduped, within YouTube's 500-char budget.
- All editable and saved per project.

### YouTube publishing pipeline
- Publish flow: Thumbnail → SEO → Schedule → Review → **Approve & Publish**.
- State machine: draft → approved → scheduled → uploading → published (failed/canceled terminals).
- HARD RULE: nothing publishes without the explicit human approval button. No auto-publish code path exists.
- Scheduling via `publishAt`; made-for-kids declaration enforced (COPPA).
- Reuses P1's resumable upload + incremental upload-scope OAuth.
- Publish history list with status, YouTube links, and cancel.

### Google verification paperwork
- New `docs/GOOGLE_VERIFICATION.md`: scope justifications, demo video outline,
  privacy/terms checklist, quota extension draft.

### Data model
- New tables: `thumbnails`, `seo_metadata`, `publish_jobs` — all owner RLS.

## 2026-09-25 — P4: Studio v2 Creative Upgrades

### Visual style system
- 10 curated presets: cinematic, anime, photoreal, watercolor, cyberpunk,
  documentary, minimalist, 3D-render, vintage-film, neon-noir.
- Each = prompt modifier + caption style + CSS gradient swatch (explicitly
  labeled "style hint", never a fake AI preview).
- Applied to scene image prompts via `buildStyledPrompt`; legacy
  illustration styles still work.

### Character consistency
- New `characters` table (owner RLS); create/delete via Studio v2 panel.
- `{character}` token injected into image prompts ("featuring {name}").
- `character_id` on scenes; badge on timeline.

### Voices (25+, Hindi-first)
- Curated catalog: 10 built-in (4 Hindi-first) + 15 library slots resolved
  via ElevenLabs at runtime. Picker sorts Hindi → English → rest.
- Cached TTS voice previews (bucket `previews/`, 30/hour limit).
- Per-scene voice override (`voice_id` on scenes).

### Background music
- **Correction:** Pixabay's API has no music endpoint (verified 2026-09-25).
  Music uses the Jamendo API (CC-licensed, free tier, `JAMENDO_CLIENT_ID`).
- Mood picker (uplifting/tense/calm/epic/playful); tracks cached in
  `music_tracks` with license + license URL.
- Auto-ducking via sidechaincompress in BOTH paths: worker pipeline
  (voice bus → music duck → mix) and browser FFmpeg.wasm (already had it).
- Volume + fade controls; `music_ducking` toggle per project.

### Asset provenance
- New `asset_provenance` table (owner-read, service-role writes).
- Every image + voiceover records provider/model/prompt/license/cost.
- Provenance drawer per scene ("made with X, licensed Y") + JSON export.

### Verification
- `npx tsc --noEmit`: clean (app + worker)
- Vitest: 224/224 (30 files)
- Production build: clean
- Real FFmpeg 8.x proof: sidechaincompress ducking chain produces valid AAC

### Needs live keys
- `JAMENDO_CLIENT_ID` for music search (free tier at developer.jamendo.com)
- P4 migration must be applied to live Supabase

## 2026-09-25 — P3: Research / Idea Engine

### Niche explorer
- New `/research` route: enter a topic → LLM generates sub-niches with audience,
  content pillars, advertiser-safety rating, and competition level.
- 1 credit per exploration, 20/hour rate limit.

### Outlier analyzer
- Import YouTube videos (URLs) or a channel (@handle/ID/URL); fetches real
  view counts via YouTube Data API with 24h quota-saving cache.
- Outlier score = views / channel median; tiers: breakout (10x+), outlier (5x+),
  strong (2x+). Pure math fully unit-tested.
- Quota estimate shown before import (~1 unit per 50 videos).

### Idea generator
- Generates titles, hooks, angles, format, difficulty, and monetization-safety
  flags from niche + outlier patterns. 1 credit per batch, 20/hour limit.
- Save / dismiss / "use this idea" lifecycle.

### Script handoff
- "Use this idea" creates a studio project pre-filled with title, hook, and
  angle brief → flows into existing Mode 1/2/3 pipelines.

### i18n
- Minimal en/hi dictionary for research UI with language toggle (P9 expands).

### Verification
- `npx tsc --noEmit`: clean
- Vitest: 204/204 tests passing (up from 182)
- Production build: clean
- Outlier math proven with fixtures; RLS static audit covers new tables.
- Live YouTube Data API calls need a connected channel (OAuth); quota cache
  prevents duplicate calls.


## 2026-09-25 — P2: Server Render Worker

### Database
- Migration `20260925143500_server_render_worker.sql`: extends `renders` with
  `attempts`, `max_attempts`, `claimed_at`, `claimed_by`, `checkpoint`,
  `cancel_requested`.
- `claim_render_job()` RPC: atomic job claiming with `SKIP LOCKED` and
  5-minute lease for crash recovery.
- `heartbeat_render_job()` RPC: progress/stage updates from the worker.

### Worker (`worker/`)
- Node.js + TypeScript, native FFmpeg (not wasm).
- Pipeline: download assets → per-scene segments (resume-safe) → concat →
  audio mix (narration + voiceover + music) → ASS word captions → faststart.
- Multi-aspect: 16:9 (1920x1080), 9:16 (1080x1920), 1:1 (1080x1080).
- Word-level karaoke captions via ASS.
- Graceful cancellation via `cancel_requested`; SIGTERM handling.
- Crash recovery: stale `running` jobs requeued on boot.
- README with local run + systemd VPS deployment.
- Verified end-to-end: real FFmpeg produced valid H.264/AAC 4s MP4.

### App integration
- `enqueueServerRender` / `cancelServerRender` / `listServerRenders` server functions.
- RenderPanel: "Fast (browser)" vs "High quality (server)" toggle.
- `ServerRenderQueue` component: live progress via Realtime, cancel, download.
- Rate limit: 10 server renders/hour per user.

### Tests
- Vitest: 182/182 (up from 171) — shared aspect/caption utils.
- Worker: 9/9 unit tests (payload validation, retry policy, ASS).

## 2026-09-25 — P1: Hardening (billing, abuse, security, YouTube UX, observability, E2E)

### Billing & abuse (Stream A)
- Fixed critical cost leak: Modes 2 (voiceover) and 3 (auto-edit) now debit credits
  before paid provider calls (ElevenLabs, image APIs).
- New-profile default credits changed from 10 to 0; 10 credits granted only after
  verified email/Google sign-in, once per profile.
- Added `disposable_email_domains` table with seed data; blocks disposable emails.
- Added `abuse_signals` table with IP/device abuse checks.
- PostgreSQL-backed rate limiting for paid endpoints (30/h on regenerateScene).
- Creation idempotency keys prevent double-submit double-charges.

### Security (Stream B)
- Renamed `src/lib/providers/registry.ts` → `registry.server.ts` to prevent
  accidental client bundling of API keys.
- Added CSP, HSTS, X-Frame-Options, Referrer-Policy, nosniff headers.
- RLS static audit tests + live-DB owner-isolation SQL tests.
- Zod validation guardrails on server inputs.
- Contact form spam protection tests.

### YouTube UX & observability (Stream C)
- Incremental YouTube OAuth (upload scope requested only when needed).
- Revoked-token detection with reconnect CTA.
- Required made-for-kids choice (no longer hardcoded false).
- Sentry error tracking (no-op without DSN).
- PostHog analytics with typed events (no-op without key).
- Public `/status` health page with dependency checks.
- Upload scope verified before claiming publish jobs.

### E2E testing
- Playwright suite: public pages, mobile (375px), authenticated studio flow.
- Test user seed script (`scripts/seed-test-user.ts`).

### Verification
- `npx tsc --noEmit`: clean
- Vitest: 171/171 tests passing (26 files, up from 124/18)
- Production build: clean

## 2026-09-25 — P0: Audit & production remediation
- Master plan and audit saved to `docs/MASTER_PLAN.md`, `docs/AUDIT.md`.
- FFmpeg.wasm vendoring, Supabase hardening, atomic credits, encrypted YouTube
  tokens, render resume/cancel, double-spend protection, strict TypeScript.
- Real render proof: 18s 1080p H.264 MP4 via FFmpeg.wasm (FFprobe verified).
