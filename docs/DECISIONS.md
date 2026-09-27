# Decisions

Non-obvious decisions made under autopilot (Investor Reply #3: "Decide, don't
ask"). Each entry: decision, reason, how to reverse. Newest first.

## 2026-09-27 — Phase 0 ($500M Vidora OS program)

### D88. Preserve the stack; extend, don't migrate
- **Decision:** keep TanStack Start + React 19 + Vite + Supabase/Postgres (Nitro server functions, no Edge Functions) + Lovable AI gateway + ElevenLabs + browser-render fallback. The $500M OS is built as extensions (new tables, routes, provider interfaces) on this foundation — no framework migration, no DB platform change.
- **Reason:** Phase 0a audit measured 850/850 unit tests green, clean strict typecheck, passing production build, zero FAKE/BROKEN features, sound RLS/security posture. A migration would trade a verified foundation for months of re-verification with no product gain. pgvector (new) and a deployed render worker close the real gaps.
- **Reverse:** only with measured evidence that the stack blocks a committed target (e.g. sustained inability to meet render throughput) — decided with the founder, never unilaterally.

## 2026-09-26 — Sprint 7–8 workstream E (agency tier)

### D78. `workspace_approvals` is client sign-off; the server `approvals` record (D61) stays the publish gate
- **Decision:** agency workspaces get their own `workspace_approvals` table (pending → approved/rejected, `decided_by` must equal `auth.uid()`), where any member — including the viewer/client — records sign-off on a scheduled draft. It is deliberately NOT the same table as workstream C's `approvals`: after client sign-off, the agency operator still runs the existing `approvePublishJob`, which writes the server-enforced `approvals` row, and only then may `executePublishJob` upload. The UI surfaces both states (`publishGateApproved`).
- **Reason:** clients need an agency review stage, but a client-writable row must never satisfy the server upload gate — otherwise a compromised client account (or a forged request) could publish. Two tables keep the trust boundaries explicit.
- **Reverse:** if the shared `approvals` schema later gains workspace/client-signoff fields with safe lifecycle states, migrate `workspace_approvals` rows into it and drop this table in a forward-only migration.

### D79. Render watermark defaults ON; only a verified paid workspace plan disables it
- **Decision:** `buildServerRenderRows` sets `watermark: true` unless the enqueue carried workspace export meta resolving to a paid `plan_tier`; the worker's `RenderJobMetaSchema` also defaults `watermark` to `true`. `resolveExportMeta` is the single place that maps `plan_tier` → watermark/brand overlay, resolved app-side at enqueue — the worker never decides billing.
- **Reason:** fail closed against accidental free white-label exports: any path that forgets to pass agency meta (or a workspace whose plan lookup fails) still burns the Vidora bug in. Paid white-label is an explicit, verified grant, not an omission.
- **Reverse:** change the default only if account-level paid plans become the authoritative source instead of workspace `plan_tier`.

## 2026-09-26 — Sprint 7–8 workstream D (analytics + admin metrics)

### D71. Platform snapshots live in `platform_video_stats`, separate from legacy `video_analytics`
- **Decision:** new `platform_video_stats` table (platform-agnostic snapshots, `metrics` JSONB for views/likes/comments/watch_time_minutes) alongside the existing YouTube-specific `video_analytics`; `snapshotUserVideos` dual-writes both, and the legacy table keeps feeding the channel overview unchanged.
- **Reason:** 24h/7d deltas need timestamped snapshots, not one-row-per-day; a separate table lets other platforms reuse the same shape without disturbing the existing analytics pipeline.
- **Reverse:** stop dual-writing once every consumer reads `platform_video_stats`.

### D72. 24h/7d deltas only from a real baseline within six hours
- **Decision:** `computeViewsWindows` returns `null` for a window unless a snapshot exists within 6h of the exact 24h/7d mark; negative corrections clamp to zero; UI shows the honest "No data yet" empty state.
- **Reason:** interpolating a missing baseline would fabricate a growth number. A sparse-but-honest metric beats a dense invented one.
- **Reverse:** widen the tolerance only with evidence that snapshot cadence is reliable.

### D73. Retention chapter boundaries use real paragraph audio durations only
- **Decision:** chapter segments come from `render_chapters.paragraphs[].duration_seconds` (via renders → the video job's `video_job_id`); chapters with no usable durations are skipped, and curves with fewer than 3 points degrade to no-data.
- **Reason:** guessing chapter timing would misalign the curve and mislabel "weakest chapter" — the whole point of the feature.
- **Reverse:** none planned.

### D74. "Next 5 videos" is deterministic and explainable over existing ideas — no LLM call
- **Decision:** `recommendNextVideos` is pure scoring (topic overlap, hook overlap, outlier evidence, safety, saved status, difficulty) over `video_ideas`; every recommendation carries machine-readable reasons; no extra credit-charged model call.
- **Reason:** recommendations must be free, instant, and auditable. An LLM call would add cost, latency, and non-determinism to a list that should be explainable.
- **Reverse:** add an LLM rerank layer only if deterministic picks underperform in real usage.

### D75. Activation denominator excludes users younger than 24 hours; D7/D30 use exact one-day windows
- **Decision:** activation = first render or publish within 24h of signup, computed only for users old enough to have completed the window; cohort retention = activity inside the [day, day+1) window after signup, not "still subscribed".
- **Reason:** including day-0 users deflates activation; "D7 retention" without a day-window definition means different things to different readers.
- **Reverse:** none planned — the definitions are documented in the pure functions.

### D76. NPS prompts only after a completed render and at most every 90 days
- **Decision:** `shouldPromptNps` returns true only with ≥1 completed render and no `nps_responses` row in the last 90 days; the prompt is a dismissible floating card, never a blocking modal.
- **Reason:** surveying users who never rendered anything measures nothing; repeated prompts are a churn driver, not a metric.
- **Reverse:** adjust the 90-day window if response volume is too low.

### D77. MRR counts active/trialing monthly subscriptions only; packs excluded
- **Decision:** `computeMrr` sums `price_usd_cents` for subscriptions with status active/trialing and monthly interval; one-time credit packs never count as MRR.
- **Reason:** MRR means recurring. Counting packs would inflate it and mislead pricing decisions.
- **Reverse:** none planned.

## 2026-09-26 — Sprint 7–8 workstream A (YouTube + Meta publishing adapters)

### D65. YouTube quota uses the September 2026 three-bucket model, recorded in `api_usage`
- **Decision:** `videos.insert` (100/day) and `search.list` (100/day) each get their own daily bucket; everything else shares 10,000 units/day (midnight PT reset). Every upload/schedule/thumbnail call writes an `api_usage` row with `cost_basis = "youtube-quota-units-not-usd"`, `cost 0`, and an explicit `quota_bucket` — reusing the existing table instead of a new quota table.
- **Reason:** Google's official quota-cost page (updated 2026-09-15) retired the old 1,600-unit flat model; recording quota next to real spend keeps one cost dashboard, and $0 cost keeps measured-cost-per-minute honest.
- **Reverse:** split into a dedicated quota table if `api_usage` queries ever conflate quota with spend.

### D66. `youtube.force-ssl` (not `youtube`) is the scheduling scope
- **Decision:** publish flow requests `youtube.upload` + `youtube.force-ssl` incrementally. `videos.update` (scheduled publish via `status.publishAt`) rejects `youtube.upload` with 403 — it needs `youtube`, `youtube.force-ssl`, or partner scope; `force-ssl` is the least-privileged of the three.
- **Reason:** minimum-scope principle for the sensitive-scope OAuth verification. `youtube.upload` stays classified SENSITIVE (verification needed, no third-party security assessment).
- **Reverse:** swap in the broader `youtube` scope only if Google deprecates `force-ssl`.

### D67. Test-account gates are hard env vars that fail closed
- **Decision:** `YOUTUBE_TEST_CHANNEL_ID`, `META_TEST_PAGE_ID`, `META_TEST_IG_USER_ID` — unset or blank disables that platform's publishing outright (`PublishingDisabledError`); a connected account that doesn't exactly match throws `TestAccountMismatchError`. Checked before any token refresh, network call, or quota spend.
- **Reason:** pre-launch, no upload may ever reach a real channel/Page. A missing config must be loud, never silently permissive.
- **Reverse:** when the founder designates production accounts, point the vars at them — no code change needed.

### D68. Adapter re-checks the approval record at execute time (second layer under D61)
- **Decision:** `publishVideoJob` accepts `publishJobId` and asserts the approval record (`assertPublishJobApproved`) immediately before uploading — in addition to workstream C's server-enforced `approvals` table check in `runExecutePublishJob`. The Meta executor (`publishJobToMeta`) does the same before calling the Graph API.
- **Reason:** the check closest to the platform call is the one that can't be skipped by a future caller that bypasses the outer function.
- **Reverse:** keep both layers; removing the outer check is a workstream C call.

### D69. Meta uses Graph v26.0, minimum permissions, same token envelope as YouTube
- **Decision:** Page token via `/me/accounts` (never the user token), AES-256-GCM encrypted with `META_TOKEN_ENCRYPTION_KEY` (same envelope as `youtube_connections`), signed OAuth state, long-lived token exchange. Permissions: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` + `instagram_basic`, `instagram_content_publish`. IG publish is always container → poll FINISHED → `media_publish`; an ERROR container is never published.
- **Reason:** least privilege for Meta app review; one token-storage pattern to audit; the two-step IG flow is mandatory (publishing before FINISHED fails).
- **Reverse:** none planned — permissions only grow if Meta requires it.

### D70. Instagram publishing limit is read at runtime, never hardcoded
- **Decision:** `getInstagramPublishingLimit` queries `/{ig-user-id}/content_publishing_limit`; the documented number has changed over time.
- **Reason:** a hardcoded limit becomes wrong silently and either blocks legit publishes or lets users blow past the real cap.
- **Reverse:** cache it with a TTL if the lookup ever becomes a hot path.

## 2026-09-26 — Sprint 7–8 workstream C (safety rules, approvals, publish blocking)

### D61. Approval = separate server-written `approvals` row; execute verifies it before upload
- **Decision:** `approvePublishJob` writes an `approvals` row through the service-role client; `executePublishJob` re-queries that row (matching user + job + scope) and refuses to call the platform uploader without it. The publish_jobs.status flag alone is NOT trusted.
- **Reason:** a forged/tampered job row (or a direct call to executePublishJob) must never publish. The approval is an immutable, server-only record; the uploader is unreachable without it (proven by publish-gate tests with a mocked uploader).
- **Reverse:** migrate the lookup back to another immutable server-controlled approval mechanism — never to a client-writable flag.

### D62. Score < 50 blocks PUBLIC publishing with no override; private/unlisted proceed with a recorded warning
- **Decision:** the P6 "acknowledge the risk" override checkbox is removed. `evaluatePublishGate(score, privacy)`: score < 50 + public → hard block at both approve and execute (execute re-checks the *current* score — defense in depth); score < 50 + private/unlisted → allowed, with an immutable `publish_warnings` row. `safety_override` input is accepted but ignored (backward compat).
- **Reason:** an override that lets a single click publish a demonetization-risk video defeats the safety feature; the founder asked for a real block. Non-public publishing stays available because the blast radius is small, and the warning preserves the audit trail.
- **Reverse:** change the active data threshold/policy only after founder/security review — the threshold itself lives in the `safety_rules` table (D63), not code.

### D63. Tunable numbers live in versioned DB data; detection patterns stay in code
- **Decision:** `safety_rules` holds one row per (version, rule_key) with numeric params (weights, thresholds, deductions). The scorer reads the highest active version via `getActiveSafetyRules()` and records `rule_version` on every score. Word lists and regexes stay in code (they're detection logic, not tuning). Built-in v1 is a fail-safe fallback with seed parity enforced by tests.
- **Reason:** tuning a threshold shouldn't need a deploy; but moving patterns into data would need validation/versioning machinery we don't have yet. The fallback means scoring never hard-fails if the migration isn't applied.
- **Reverse:** move patterns into validated rule definitions later (needs a schema for patterns + review tooling).

### D64. Safety rules are reviewed quarterly; /admin/safety flags stale rules
- **Decision:** `safety_rules.last_reviewed_at` + `getReviewStatus()` (90-day threshold); `/admin/safety` shows the active rule version, all params, and an overdue banner. Founder action: review the active rules at least quarterly.
- **Reason:** a block threshold nobody revisits rots. Making staleness visible in the admin panel is the cheapest enforcement.
- **Reverse:** change the review cadence constant.

## 2026-09-26 — Sprint 5–6 (cinema, source priority, dubbing, shorts, exports)

### D46. Cinema is a render tier, not a creation mode
- **Decision:** "cinema" stays a `RenderMode` (billing/render treatment), not a 6th entry in `CREATION_MODES` (script/voiceover/auto_edit/story), which are about *input*, not render treatment.
- **Reason:** billing already had `RenderMode = "story" | "cinema"`; the gap was that it was unreachable (no caller ever passed `stockFootage: true`), not that it was misclassified. Wired it end-to-end (RenderPanel → enqueue → buildServerRenderRows) instead of touching the single source of truth.
- **Reverse:** add `{ id: "cinema", ... }` to `CREATION_MODES` if cinema ever becomes an input mode (e.g. "upload a rough cut, get a cinema grade").

### D47. per-minute.ts untouched — dead pricing wired, not rewritten
- **Decision:** `renderCreditCost` already computed ×1.5 cinema, per-second hero billing, dubbing 0.5/min/language, and shorts 0.5 each correctly. No change was needed; the work was wiring callers (RenderPanel quote, server enqueue, dub/short quote UIs) to pass the inputs.
- **Reason:** the single source of truth was right; the callers were silent. Editing it would have risked the tested math for zero gain.
- **Reverse:** n/a (no change made).

### D48. Stock providers: reuse the existing interface, mock by default
- **Decision:** reused `src/lib/providers/stock.server.ts`'s `StockProvider` (Pexels + Pixabay real implementations already existed, key-gated) and widened the id unions with `"mock"` instead of building a second interface. `resolveStockProviders()` returns real providers only when `PEXELS_API_KEY`/`PIXABAY_API_KEY` exist; otherwise a deterministic mock (`mock://` URLs, "MOCK — preview asset, not licensed for use", no network I/O).
- **Reason:** two provider interfaces would drift; the planner must stay usable/testable without keys, and `mock://` URLs can never be mistaken for downloadable stock.
- **Reverse:** make `resolveStockProviders()` return `{ providers: [], mock: false }` and let stock tiers fall back to AI hero.

### D49. Source priority is strict: upload > stock > AI hero, with provenance for all
- **Decision:** `planSceneSources()` picks visuals per scene in strict priority order — 1) user-uploaded footage, 2) licensed stock (Pexels → Pixabay), 3) AI hero — and every upload/stock decision writes a row to the existing `asset_provenance` table (provider, license, license_url, asset id/URL, scene link).
- **Reason:** provenance is the product promise ("know what you're looking at"); recording it at decision time is the only point where the choice is certain.
- **Reverse:** change `SOURCE_PRIORITY` order in `src/lib/stock/types.ts`.

### D50. AI hero cap: ≤10% of runtime, trim by default, server re-applies
- **Decision:** the planner enforces the 10% AI-hero runtime cap with default policy `"trim"` (scales hero seconds proportionally, flags `heroTrimmed`; `"reject"` throws `HeroCapExceededError`). The server re-applies the cap at enqueue (`buildServerRenderRows`) and quotes/bills the capped value, recorded in row meta.
- **Reason:** never trust the client's hero-seconds number for money math; a visible trim beats silent over-billing or silent cap-breaking.
- **Reverse:** flip the default `heroPolicy` in `planSceneSources`; remove the `applyHeroCap` call in `server-renders.functions.ts`.

### D51. Cinema and Story mutually exclusive; heroes bill in Cinema only
- **Decision:** RenderPanel disables one when the other is on; `aiHeroSeconds` enters the quote only in Cinema Mode (Story quotes unchanged byte-for-byte).
- **Reason:** exactly one treatment drives per-scene motion/pacing — stacking would make the quote and the render disagree; AI heroes are a cinema-tier feature with the cap as guardrail.
- **Reverse:** pass hero seconds for story too; allow both with defined precedence.

### D52. Export presets are data + one ffmpeg-arg builder
- **Decision:** `src/lib/exports/presets.ts` holds the four presets (youtube-longform 1920×1080; youtube-shorts / instagram-reels / tiktok 1080×1920) as data; `exportEncodeArgs(preset, fps)` is the single source of truth for ffmpeg output flags (MP4, H.264 High, yuv420p, AAC 48kHz stereo, +faststart). Preset encode is `-preset veryfast -crf 23`; the no-preset path is byte-identical to before (ultrafast/crf-26).
- **Reason:** ffmpeg flags previously lived inline in three places; a preset that drifts from the renderer is worse than no preset. Presets promise platform-grade output, and ultrafast/crf-26 is a preview-speed trade-off that shouldn't ship as "YouTube-ready".
- **Reverse:** delete the module and inline flags again (tests are the tripwire); change `x264Preset`/`crf` in the preset `base` object.

### D53. Preset determines the output frame; preset is in the cache fingerprint
- **Decision:** when `exportPreset` is set, resolution comes from the preset (picker labels show dimensions, e.g. "1080×1920"); `options.exportPreset` is part of `sceneFingerprint` so cached segments from another preset are never reused. Square projects default to youtube-longform (no square preset in scope).
- **Reason:** a preset that silently kept the old frame would be dishonest; a resume cache keyed on old dims would produce a corrupt mixed-frame MP4 after switching presets.
- **Reverse:** prefer aspect dims in `resolutionForRender`; remove the fingerprint field (cache collisions return — don't).

### D54. Dubs and Shorts are renders: parent_id, no new tables
- **Decision:** derived videos reuse the `renders` table with a new self-referential `renders.parent_id` (migration `20260926001000_renders_parent_id.sql`); kind travels in `meta.kind` (`"dub"`/`"short"`), existing pattern.
- **Reason:** zero new RLS policy surface — the owner-scoped policy covers children automatically; the RLS static audit stays green without new entries.
- **Reverse:** add a `derived_renders` table later and backfill from parent_id if dubs/shorts ever need their own lifecycle.

### D55. Dubbing uses verified voices only — no silent substitution
- **Decision:** `selectDubVoice()` reads a `verified` boolean mirrored in-code from `language_voices.verified`; with no verified voice the default path throws `DubError("no-verified-voice")` naming the language. Only `allowStub: true` returns a stub, marked `stub: true` / "pending verification".
- **Reason:** picking "the closest voice" would ship a video with the wrong voice/language and the user would never know.
- **Reverse:** flip flags true after the end-to-end TTS checks (FOUNDER_TODO #13).

### D56. Shorts highlight scoring is rule-based, documented as a stand-in
- **Decision:** the idea engine scores whole videos (outlier_score), not scenes — so `scoreSegment()` uses an honest documented heuristic (beat bonuses: hook +3 / payoff +2 / rising_tension +1.5 / loop_cta +1 / setup +0.5; caption density; 20–45 s sweet spot; greedy non-overlapping top-k, clamped 5–8).
- **Reason:** inventing "AI scores" would be a fake claim; a documented heuristic is replaceable.
- **Reverse:** replace `scoreSegment()`'s body when a learned per-scene scorer ships; the `selectShorts()` contract stays unchanged.

### D57. Dub/Short queue actions ship disabled with an honest date
- **Decision:** the RenderPanel Dubbing & Shorts section shows the exact `formatRenderCost` quote (real math through per-minute.ts) but the queue button is disabled: "Queue — Shipping next (target Oct 2026)". Same for unfinished stock automation in the Cinema blurb.
- **Reason:** the worker isn't deployed in production — enqueueing must not pretend to work. The no-fake-claims rule requires a date; Oct 2026 is a target, flagged for the founder to confirm.
- **Reverse:** enable the button and wire `quoteDubRender`/`suggestShorts` → enqueue when the worker ships; founder confirms/changes the date (one string in `DubShortsQuote.tsx` / `src/lib/stock/cinema.ts`).

### D58. App-review checklists ship as guides, generically framed
- **Decision:** YouTube and Meta review checklists are entries in `src/lib/guides.ts` (`/guides/youtube-api-app-review`, `/guides/meta-app-review`), framed as "a founder / your app" — claiming nothing about Vidora's review status.
- **Reason:** zero new routes/components; the generic framing keeps the marketing-honesty scan green and avoids implying an approval we can't verify.
- **Reverse:** move to a dedicated founder-gated route if needed.

### D59. Music provenance gate: filter at selection, hard check at attach
- **Decision:** `searchMusic`/`listMusicTracks` hide tracks missing provenance (provider + license + license_url, or documented equivalents `"Public domain"` / `"Vidora original composition"`, logged via `[music-catalog]` warn); `updateProjectSettings` rejects attaching an unprovenanced track. BYO music (`music_url`) is untouched. No migration — all columns already exist.
- **Reason:** picker filtering alone is bypassable (anyone can POST a track id); the attach-time check is the real gate. Logging (not silent dropping) makes catalog hygiene visible.
- **Reverse:** remove the `hasMusicProvenance` check to restore attach-anything.

### D60. Mid-sprint shared-tree incident (2026-09-26 ~18:47 IST)
- **Decision (process):** when multiple agents share one working tree on one branch, agents must commit early and often, and never run `git add -A`, `git stash`, or `git reset --hard` while siblings may have uncommitted work.
- **Reason:** a sibling's `git add -A` swept another lane's uncommitted files into its commit; a later stash + `reset --hard` wiped all uncommitted work across lanes. Recovery from `stash@{0}`/`stash@{0}^3` worked but cost ~40 min per lane. Serializing push/pull cycles or per-lane worktrees avoids the whole class.
- **Reverse:** n/a (process lesson; recorded so the next multi-lane sprint uses worktrees).

## 2026-09-25 — Sprint 3–4 (language pipeline)

### D36. music_tracks reads are explicitly public (D25-class RLS fix)
- **Decision:** Replaced the flagged `USING (auth.uid() IS NOT NULL)` policy
  ("Signed-in users read music tracks") with one documented public-read
  policy: `FOR SELECT TO anon, authenticated USING (true)`, with a COMMENT
  on the policy stating the intent. music_tracks is a shared royalty-free
  catalog (Jamendo cache) with no user data, and it serves a LIVE feature —
  the Studio v2 music picker (`searchMusic`/`listMusicTracks`). Writes stay
  service-role only; the RESTRICTIVE "No guest sessions" policy still
  excludes anonymous sessions from every table.
- **Reason:** Hiding a public catalog behind a tautology is what the
  pre-publish scan flags. An explicitly documented public read is the honest
  shape for a catalog with no user data.
- **Reverse:** Scope reads back to authenticated-only if the catalog ever
  carries licensed/per-user content.

### D37. Beta voice slots are unverified placeholders, never invented ids
- **Decision:** `language_voices` seeds 4 slots per language. English and
  Hindi slots are verified+selectable because their provider ids come from
  the existing production voice catalog (`src/lib/voices.ts`). The other 10
  beta languages get clearly-marked BETA placeholders: `provider = 'none'`,
  `provider_voice_id = NULL`, `verified = false`, `selectable = false`.
  Real ids are wired ONLY when verified against a real provider — never
  invented. The UI picker filters through `userSelectableVoices()`, and a
  test asserts `selectable ⇒ verified` plus that every verified id exists
  in the in-code catalog.
- **Reason:** A fabricated provider id would fail silently at TTS time and
  burn money; a NULL placeholder fails loudly at seed-review time instead.
- **Reverse:** Verify 4 ids for a beta language (real provider check) and
  flip `verified`/`selectable` via service role.

### D38. Quality gate = table + checked-in data mirror + failing test
- **Decision:** `language_quality_gates` is the production record (public
  read, service-role write). `LANGUAGE_QUALITY_GATES` in
  `src/lib/languages.ts` is the CI mirror, and
  `src/lib/language-gates.test.ts` fails if any `live` language lacks all
  three passing checks (golden scripts, back-translation, native-speaker
  review), and fails on drift between the migration seed and the mirror.
  English passes with honest evidence notes (caption-layer fixtures in CI;
  back-translation N/A as the source language; copy authored/reviewed in
  English by the team — no formal native panel convened, stated plainly).
- **Reason:** No database in CI, so the table alone can't gate merges; the
  mirror makes the invariant testable, and the drift test keeps the two
  honest.
- **Reverse:** Drop the mirror once CI can read the production table.

### D39. Caption language behaviour is data, threaded at render time
- **Decision:** `buildWordAss` (both the `src/lib/render/shared.ts`
  canonical copy and the worker's dependency-free duplicate) accepts an
  optional `CaptionLanguage` (code/rtl/fontStack/captionMaxChars). When
  present: the ASS Fontname is the primary family of the row's font_stack
  (generic stacks like `system-ui` fall back to Inter, the font the render
  pipeline ships); lines wrap at `caption_max_chars` with character-level
  splitting for spaceless CJK text; RTL rows are marked `; Direction: RTL`
  while text stays in logical order for libass bidi. The worker resolves
  the row from the `languages` table via the job's `languageCode`
  (new optional `RenderJobMeta` field, default `"en"`); unknown codes fall
  back to legacy behaviour. The canvas caption path sets
  `ctx.direction` from the same data. No component branches on a language
  code — the neutrality test stays green.
- **Reason:** Fonts/RTL/line-length must follow the table, not code; the
  worker is the only render path with DB access, so it resolves the row.
- **Reverse:** Remove the `language` parameter (legacy grouping returns).

## 2026-09-25 — Sprint 1–2 (verification/docs)

### D31. "Maker plan" purchase tests use Growth pack (pack_m)
- **Decision:** The investor asked for a "Maker-plan" purchase round trip, but
  no Maker plan exists in `src/lib/billing/plans.ts`. The tests drive
  `pack_m` (Growth pack: 70 credits, one-time) on both providers.
- **Reason:** One-time packs are the only purchase flow fully supported on
  both providers — Razorpay subscriptions throw ("not set up yet"), and Dodo
  pack purchases are the `payment.succeeded` path. Pack_m is the $19-class
  purchase, closest to a "Maker" tier.
- **Reverse:** Add a `maker` plan to the catalog and point the round-trip
  tests at its slug.

### D32. Completion email: Resend-only, in-app row is the reliable channel
- **Decision:** `sendRenderCompleteEmail` ALWAYS stores a `notifications` row
  (the studio bell reads it); it sends email only when `RESEND_API_KEY` is
  set, via the Resend REST API directly (no SDK). SMTP is not implemented.
  Delivery is fire-and-forget with a catch — it can never fail a render
  completion. The email links to `/studio`, never embedding the signed
  download URL (signed URLs are bearer tokens; they don't belong in email).
- **Reason:** Resend covers the founder's path with zero new dependencies;
  a second provider doubles the test surface for a pre-launch notification.
  The in-app row is the source of truth, so a mail outage can't lose the
  "close the tab" signal.
- **Reverse:** Add an SMTP branch in `src/lib/notifications.server.ts`
  (nodemailer) selected by `SMTP_HOST`, or swap the Resend call.

### D33. Stranger e2e: signup opt-in, render behind a money gate
- **Decision:** `e2e/stranger.spec.ts` runs homepage/pricing checks always;
  signup runs only when `TEST_USER_PASSWORD` is set or the target is
  localhost; the real render + download + ffprobe runs only with
  `E2E_RUN_RENDER=1`. Everything else is `test.skip` with a reason.
- **Reason:** Creating prod accounts and spending paid credits/provider calls
  must be explicit opt-ins, never CI defaults. A suite that skips gracefully
  stays green everywhere and honest about what it didn't cover.
- **Reverse:** Change the skip conditions at the top of each describe block.

### D34. Notifications table: user reads, service-role writes
- **Decision:** New `notifications` table (migration
  `20260925200000_notifications.sql`): RLS on; users SELECT their own rows
  and may UPDATE only their own `read_at`; inserts go through the
  service-role client in server code only — no INSERT policy for
  anon/authenticated.
- **Reason:** A completion notice must be unforgeable by the client (it's
  also the fallback for the "close the tab" promise); users only need to
  read and dismiss.
- **Reverse:** Add an INSERT policy if a client path ever needs to write
  notifications directly.

### D35. Stranger test asserts cost copy, not a cost widget
- **Decision:** The "exact cost before rendering" stranger check asserts the
  `1 credit = 1 finished minute` statement is visible in the make-a-video
  dialog before the Generate button — there is no per-render cost widget in
  the studio UI today.
- **Reason:** Copy honesty: the test verifies what the product actually
  promises pre-render. If a per-render quote widget ships, the test should
  assert the quoted number instead.
- **Reverse:** Point the assertion at the widget's selector when it exists.

## 2026-09-25 — Sprint 1–2 (app/UI)

### D25. Worker panel lives on the admin Overview, not the Renders page
- **Decision:** The worker heartbeat / queue-depth panel went into
  `admin.index.tsx` (Overview), next to Diagnostics — not `admin.jobs.tsx`.
- **Reason:** Heartbeat + queue depth is infrastructure health, not a render
  row. The founder checks one dashboard; the Renders page stays a pure job table.
- **Reverse:** Move the `<WorkerPanel />` component into `admin.jobs.tsx`.

### D26. Exact render settlement replaces wall-clock settlement (non-destructive)
- **Decision:** `finalize_render_billing` was replaced via
  `20260925220000_exact_render_settle.sql`: rows enqueued with
  `meta.expected_credits` settle deterministically at exactly the quoted
  credits (no debit, no refund). Rows enqueued before exact quoting keep the
  legacy worker-wall-clock settle path. Function-body replacement only —
  no tables/rows touched.
- **Reason:** The reserve is now the exact deterministic quote (finished
  minutes × multipliers). Settling it against worker wall-clock minutes
  would wrongly refund/overcharge whenever multipliers apply or the worker
  runs faster/slower than realtime — making the "exact cost before render"
  promise a lie.
- **Reverse:** Re-apply the pre-20260925220000 function body from
  `20260925120000_schema_reconciliation.sql`.

### D27. Server-render quote is story/standard only — no premium toggles yet
- **Decision:** `quoteMultiAspectRender` is called with `mode: "story"` and
  all add-ons off; the RenderPanel shows no premium-voice / cinema-stock /
  2.5D / dubbing toggles.
- **Reason:** Those purchase options don't exist in the product today (no
  premium voice tier, no cinema mode in the studio), so toggles would be
  dishonest UI. The same pricing function already prices every multiplier,
  so they flow through the quote with zero math changes when they ship.
- **Reverse:** Add the toggles to the RenderPanel cost box and pass the
  options through to the quote + enqueue.

### D28. Stale queue thresholds: queued > 60 min, running > 120 min
- **Decision:** `STALE_QUEUED_MS` / `STALE_RUNNING_MS` in
  `src/lib/worker-health.ts`; the admin worker panel counts stale jobs and
  warns above zero.
- **Reason:** Needed a concrete definition of "stuck" for the queue-depth
  display. One hour queued means the worker isn't picking work up; two
  hours running exceeds any plausible single render.
- **Reverse:** Change the constants in `src/lib/worker-health.ts`.

### D29. Unit economics uses measured data only, with an honest empty state
- **Decision:** `adminUnitEconomics` divides recorded `api_usage` costs by
  finished minutes from completed `renders`; cost-per-credit comes from
  render-attributed ledger debits; margins use USD plan prices. With no
  real data it returns `hasData: false` and the UI shows "No measured data
  yet — costs are recorded from <date>" — never zeros as measurements.
- **Reason:** Copy honesty: unit economics must not present guesses.
  estimated_cost rows are in USD, so USD plan prices are the consistent
  comparison.
- **Reverse:** Change the aggregation in `admin.functions.ts`.

### D30. One renders row per aspect, one reserve per row
- **Decision:** A multi-aspect enqueue creates one `renders` row per aspect
  (shared `meta.group_id`), and each row reserves its own exact per-aspect
  quote via `reserveRenderBilling` (idempotent per render id).
- **Reason:** Rows render independently on the worker and settle
  independently; a single shared reserve couldn't be settled per row and
  would leak on partial failure.
- **Reverse:** Single-row enqueue per call (drop `aspects` from the schema).

## 2026-09-25 — Sprint 0 remainder

### D1. Dodo Payments for USD, Razorpay for INR; Stripe kept in types only
- **Decision:** Checkout routing is USD → Dodo, INR → Razorpay. `BillingProviderName`
  still includes `stripe`, and the Stripe adapter file stays, but nothing routes to it.
- **Reason:** Investor Reply #3 mandates Dodo (USD) + Razorpay (INR) and explicitly
  says Stripe is not approved. Keeping the type union means Stripe can return with
  a single adapter file and zero logic changes if approval ever comes.
- **Reverse:** Add a `stripe.ts` adapter implementing `BillingProvider`, return it from
  `getBillingProvider("stripe")`, and route a currency to it in `billing.functions.ts`.

### D2. Checkout buttons show "Coming soon" until keys exist (paymentsLive)
- **Decision:** `paymentsLive()` reports per-provider liveness from env vars only
  (Dodo: API key + webhook secret; Razorpay: key id + key secret + webhook secret).
  Buttons render "Coming soon" and stay disabled until the matching provider is live;
  they switch on automatically when secrets land — no code change, no redeploy flag.
- **Reason:** Public copy may only promise what a logged-out stranger can use now.
  Auto-enable avoids a second deploy the day keys are added.
- **Reverse:** Change the button labels/conditions in `PricingSection.tsx` and
  `_authenticated/billing.index.tsx`.

### D3. Dodo via direct REST, no SDK
- **Decision:** `src/lib/billing/dodo.ts` calls Dodo's REST API with fetch; no
  `dodopayments` npm package.
- **Reason:** One less dependency and no SDK version drift for the three endpoints we
  need (checkout session, customer portal, subscription cancel/get). Webhook
  verification follows the Standard Webhooks scheme Dodo documents (HMAC-SHA256 over
  `{id}.{timestamp}.{body}`, `v1,` signatures, 5-minute replay tolerance).
- **Reverse:** `npm i dodopayments` and reimplement the adapter against the SDK.

### D4. AI hero shots billed at 1 credit per 10 seconds, totals rounded up
- **Decision:** The investor priced "AI hero shots billed per-second" without a rate.
  Set 1 credit per 10 seconds (rounded up); all multiplier totals round UP to whole
  credits since the ledger stores integers.
- **Reason:** Needed a concrete rate to ship per-minute billing; 10s/credit keeps a
  30-second hero montage at 3 credits — material but not punitive. Rounding up is the
  standard billing direction and keeps the ledger integer.
- **Reverse:** Change `aiHeroCredits()` in `src/lib/billing/per-minute.ts`.

### D5. Mode 2/3 voiceover flows keep the old per-project debit (deprecated shim)
- **Decision:** `debitOneCreditForProject` remains for the Mode 2/3 voiceover/script
  flows; only the video-render path moved to per-minute.
- **Reason:** Sprint 0 item 4 scopes the change to per-render charging. Voiceover
  projects produce audio, not finished video minutes; repricing them is a Sprint 1–2
  pricing decision, not a migration.
- **Reverse:** Route mode2/mode3 through `debitMinutesForJob` with a minutes model
  for audio, then delete the shim.

### D6. Thumbnail/safety micro-actions stay 1 credit per action
- **Decision:** `publish.functions.ts` (thumbnails/SEO) and `safety.functions.ts`
  (deep review/rewrites) keep charging 1 credit per AI action.
- **Reason:** Same scoping as D5 — these are per-AI-action charges, not per-render
  charges. Folding LLM micro-actions into per-minute video pricing needs a pricing
  decision, not a migration.
- **Reverse:** Price them in fractions via a decimal ledger or a separate quota.

### D7. INR price anchors for the current catalog
- **Decision:** Starter $19 → ₹1,599; Studio $49 → ₹3,999; Scale $149 → ₹11,999
  (migration `20260925195000_pricing_inr.sql`).
- **Reason:** Honest, India-friendly price points near the investor's own anchors
  (₹999/$12, ₹2,499/$29). Unknown slugs fall back to `ROUND(usd * 83.2)`.
- **Reverse:** Update `pricing_plans.price_monthly_inr` rows directly (admin SQL).

### D8. Currency detection: USD default, cf-ipcountry first, manual toggle wins
- **Decision:** `detectCurrencyFromHeaders` checks `cf-ipcountry` → `x-vercel-ip-country` →
  `x-appengine-country` → `cloudfront-viewer-country` → `x-country-code`; INR only for
  `IN`, everything else (including unknown) → USD. The visitor's manual toggle is
  stored in localStorage and overrides detection.
- **Reason:** Lovable hosts on Cloudflare Workers, so `cf-ipcountry` is the reliable
  signal in production. Unknown → USD is the investor's rule. The toggle respects
  the visitor (e.g. an Indian user on a VPN).
- **Reverse:** Reorder `COUNTRY_HEADERS` or change the default in `src/lib/currency.ts`.

### D9. Credit conversion as delta-0 documentary ledger entries
- **Decision:** Migration `20260925194000_per_minute_credits.sql` writes one
  `credit_ledger` row per user with a positive balance: `delta = 0`,
  `reason = 'migration_per_minute: converted N legacy credit(s) to N finished
  minute(s) at 1:1 …'`. Balances are untouched; no old rows edited or deleted.
  Idempotent via `NOT EXISTS`.
- **Reason:** 1 old credit → 1 minute is a 1:1 unit rename, so the honest record is
  documentary, not a balance movement. Append-only satisfies the investor's
  constraint and preserves the full audit trail.
- **Reverse:** Nothing to reverse in data (no balances changed). To rescind the
  labeling, delete rows with `reason LIKE 'migration_per_minute%'` — but that would
  break the append-only audit guarantee, so prefer leaving them.

### D10. FAQ JSON-LD lives inside FaqSection (SSR, 1:1 with visible copy)
- **Decision:** The `FAQPage` script tag is rendered by `FaqSection` itself from the
  same `faqs` array as the visible accordion, on both `/` and `/pricing`.
- **Reason:** Guarantees the structured data can never drift from the visible
  answers, and it ships in the initial server-rendered HTML (no client-only loading).
- **Reverse:** Move the script to route `head` and maintain a separate copy (not
  recommended — drift risk).

### D11. Worker deploys as a tarball over SSH — no container registry
- **Decision:** `scripts/deploy-worker.sh` builds the image locally, `docker save`s it
  to a tarball, `scp`s it to the Oracle host, and `docker load`s it there.
- **Reason:** No registry account, credentials, or retention policy to manage for a
  single-host deploy. One command, fully reproducible.
- **Reverse:** Push to GHCR/Docker Hub in the script and `docker compose pull` on
  the host instead.

### D12. Worker availability: dedicated `worker_heartbeats` table (revised 2026-09-25)
- **Decision:** Supersedes the earlier "no new table" call. The worker now upserts
  `worker_heartbeats(worker_id, last_seen_at)` on boot and every 60s while idle
  (`reportWorkerHeartbeat` in `worker/src/supabase.ts`; failures are logged, never
  fatal). `getServerWorkerStatus` reads the freshest heartbeat (15-min window);
  the old claimed-render check stays only as a fallback for older worker builds.
  Table is RLS-enabled with no client policies — service_role only.
- **Reason:** Review caught a bootstrap deadlock: inferring liveness from claimed
  renders meant a freshly deployed worker (zero claims) looked offline forever,
  so no server renders were ever enqueued. An idle heartbeat is the honest signal.
- **Reverse:** Drop the table and revert `getServerWorkerStatus` to renders-only.

### D14. Character-consistency claim restored after honest 6-scene proof (2026-09-25)
- **Decision:** The claim "characters stay consistent throughout" was removed pending
  proof; the 60s demo's 6 AI stills were judged honestly (same woman, early 30s,
  short black hair, rust-orange jacket in every scene — see `demo-assets/proof.txt`)
  and the claim is restored. If a future render fails the same test, the claim
  comes back off.
- **Reason:** Claims must track evidence, in both directions.
- **Reverse:** Remove the sentence from `StyleGallery.tsx` again.

### D13. Root `.env.example` extended (not a separate worker/.env.example)
- **Decision:** Worker env vars were appended to the existing root `.env.example`;
  `docker-compose.yml` reads root `.env`.
- **Reason:** The task spec named root `.env.example`; one env file avoids the
  founder maintaining two files with the same Supabase secrets in both.
- **Reverse:** Split into `worker/.env.example` and point compose `env_file` there.

### D15. `renders.claimed_at` doubles as the worker heartbeat — no new column
- **Decision:** `requeue_stale_renders` (migration `20260925210000_requeue_stale_renders.sql`)
  treats `renders.claimed_at` as the liveness heartbeat. No new heartbeat column was added.
- **Reason:** `heartbeat_render_job` already refreshes `claimed_at = now()` on every
  worker heartbeat, and `claim_render_job` already treats `claimed_at` as the lease
  timestamp. A separate column would duplicate the same signal and require touching
  both existing RPCs plus the worker loop. Rows with NULL `claimed_at` are treated as
  stale (a `running` row with no claim timestamp is pathological).
- **Reverse:** Add `last_heartbeat_at timestamptz`, update both RPCs and the worker to
  write it, and repoint the requeue predicate.

### D16. Worker crash recovery moved into the `requeue_stale_renders` RPC
- **Decision:** The worker's `requeueStaleJobs` now calls
  `supabase.rpc("requeue_stale_renders", { p_lease_seconds })` instead of issuing its
  own direct UPDATE. The RPC is the single server-side authority: attempts remaining
  → `queued` with `attempts + 1` and claim cleared; attempts exhausted → `failed` with
  error `'Worker died; retries exhausted'`. Service_role-only execution, matching the
  claim/heartbeat RPCs.
- **Reason:** The old worker-side UPDATE never enforced the retry cap — a job whose
  worker died at `attempts >= max_attempts` was requeued forever. Centralizing the
  predicate in SQL also stops the N-worker / N-implementation drift.
- **Reverse:** Revert `worker/src/supabase.ts` to the direct UPDATE (loses the retry cap).

### D17. Multi-aspect enqueue: `aspects` default all three, legacy `aspect` kept
- **Decision:** `enqueueServerRender` accepts `aspects: ("16:9"|"9:16"|"1:1")[]`
  (default all three) and creates one `renders` row per aspect for the same project,
  linked by a shared `meta.group_id` uuid; each row carries its own `meta.aspect`,
  `aspect_ratio`, and `resolution` (1920×1080 / 1080×1920 / 1080×1080). The old
  singular `aspect` input is still honored as an explicit single-aspect choice so the
  current RenderPanel call is behavior-identical (one row, the chosen aspect).
  Precedence: `aspects` > `aspect` > all three. (Billing side evolved in parallel:
  each row now reserves the EXACT per-aspect quote from `quoteMultiAspectRender`,
  stored as `meta.expected_credits` / `expected_minutes` / `mode` — see the
  billing sprint's D26/D27/D30. The row builder stays pure and unit-tested.)
- **Reason:** The row builder (`buildServerRenderRows`) is pure and unit-tested; the
  worker already renders per-aspect dimensions from `meta.aspect`, so no worker
  change was needed. Per-row reservation keeps the ledger honest instead of
  under-reserving a 3× render.
- **Reverse:** Make RenderPanel pass `aspects` explicitly (it currently passes `aspect`,
  so one day a multi-select UI should send the user's chosen set).

### D18. Queue depth via service-role counts, wired into admin jobs
- **Decision:** `getRenderQueueDepth()` (service-role, logged-in users only) returns
  `{queued, running, stale}` for `engine='server_ffmpeg'` rows, where `stale` uses the
  same predicate as the requeue RPC (claimed_at older than the 300s lease). Surfaced
  as three stat cards on the admin jobs page with a 15s refresh. The public /status
  page was deliberately left untouched — queue depth is an ops signal, not a
  visitor-facing service check.
- **Reason:** The requeue RPC and the depth helper must agree on "stale" or the admin
  UI would show numbers the requeue pass never acts on; sharing the lease constant
  and predicate keeps them consistent.
- **Reverse:** Add a queue-depth check to `getSystemStatus` if it ever belongs on the
  public status page.

### D19. One `recordApiCost` helper for every provider call (fail-open)
- **Decision:** All paid LLM, TTS, image-generation, and render-submission
  calls go through `recordApiCost` in `src/lib/api-cost.ts`, which computes
  `estimated_cost = units × unitCostUsd` centrally and inserts one row into
  `api_usage`. The helper never throws: if the cost insert fails, it logs
  and continues — a completed provider call must never fail the user's
  render because cost bookkeeping hiccuped.
- **Reason:** Before this, cost rows were written by scattered `logUsage`
  helpers with inconsistent math (one TTS path even used the wrong
  ElevenLabs rate). One helper means one place to fix pricing.
- **Reverse:** Reintroduce per-module loggers (loses consistent math).

### D20. Gateway costs are passthrough ESTIMATES, labeled as such
- **Decision:** Every Lovable AI gateway row carries
  `meta.cost_basis = "gateway-passthrough-estimate"` and the admin panel
  shows an estimate caveat next to measured numbers. Gateway LLM/image/TTS
  unit costs are best-known model estimates (e.g. $0.03/image), because the
  gateway does not report exact USD per call. Direct-provider rows
  (ElevenLabs, Shotstack) use published rates.
- **Reason:** Copy honesty (D29): measured economics must not present
  guesses as measurements. An estimate labeled as an estimate is fine; an
  estimate presented as a measurement is a lie.
- **Reverse:** If the gateway ever reports exact per-call USD, switch
  `meta.cost_basis` to `"gateway-reported"` and drop the caveat.

### D21. ElevenLabs Flash TTS corrected to $0.05/1,000 chars
- **Decision:** `ELEVENLABS_TTS_USD_PER_CHAR` is $0.05/1k characters
  (Flash/Turbo 2.5 tier), replacing the earlier $0.03/1k assumption that one
  code path used. Multilingual v2/v3 voices are $0.10/1k (constant kept for
  when those models are selected).
- **Reason:** Public ElevenLabs pricing, verified 2026-09-25.
- **Reverse:** Change the constant in `src/lib/api-cost.ts`.

### D22. Legacy settlement prefers finished output duration (amends D26)
- **Decision:** The legacy branch of `finalize_render_billing` (rows without
  `meta.expected_credits`) now bills `CEIL(renders.duration / 60)` — the
  finished OUTPUT duration — minimum 1. Worker wall-clock elapsed
  (`render_completed_at − render_started_at`) is only the fallback for
  legacy rows that never recorded output duration. The exact-quote branch
  is unchanged: quoted credits are the final charge, zero ledger delta.
- **Reason:** Worker speed is not product value: a worker that renders 2×
  realtime must not bill half, and a slow worker must not bill double.
  Output minutes are what the user received.
- **Reverse:** Restore the wall-clock-first branch in
  `20260925220000_exact_render_settle.sql` (and the matching assertions in
  `supabase/tests/finalize_render_billing.sql`).

### D23. Every failure/cancellation path refunds via the fixed refund RPC
- **Decision:** Quick-job pipeline exceptions, the provider-failed
  `rendering` branch, `failVideoJobCompose`, queued-cancel of server
  renders, and worker `finishJob(failed/cancelled)` all refund through
  `refund_credits_for_minutes` (via the `refundDebitedMinutes` helper for
  quick jobs), which is idempotent per job id and clamps to the actual
  debit — a job that was never charged can never be refunded. No code path
  inserts/updates/deletes `credit_ledger` rows directly. Refund errors are
  logged, never thrown, so they can't mask the original failure.
- **Reason:** The reserve is taken before work starts; any terminal state
  that produces no video must return it. Idempotency + debit-clamping make
  every path safe to retry and safe against double-cancel races.
- **Reverse:** Remove individual refund calls (reintroduces reserve leaks).

### D24. Measured cost queries: 30-day windowed, mode-attributed
- **Decision:** `getMeasuredCostPerMinute(mode)` and `getPlanMargins()`
  (admin-only, in `billing.functions.ts`, logic in
  `src/lib/billing/measured-cost.ts`) aggregate the trailing 30 days:
  provider cost from render-pipeline `api_usage` rows, finished minutes
  from quick-job durations plus server renders' `billed_minutes`, mode from
  `meta.mode` (`"story"` default — written at enqueue for server renders).
  Plan margins divide measured provider cost by NET render credits consumed
  (debits and settle/refund grants, so reserve→actual settlement nets to
  true finished minutes) and compare against DB plan prices. Divide-by-zero
  returns null, never NaN; empty data returns an honest null, not zeros.
- **Note:** `adminUnitEconomics` (D29) already covers similar ground as an
  all-time, catalog-price variant wired into the admin UI. These two are
  the 30-day-windowed, DB-price variants the cost sprint specified.
  Consolidate the two into one canonical implementation as a follow-up —
  do not let them drift.
- **Reverse:** Change the window/queries in `measured-cost.ts`.

### D40. Story Mode ships + 2.5D parallax toggle (supersedes D27's "no 2.5D toggle yet")

- **Decision:** Story Mode is now a first-class creation mode (`src/lib/creation-modes.ts`,
  `/studio?create=story`, quick-job `story_mode` → five-beat plan prompt) and a render
  treatment on both engines (RenderPanel "Render treatment" box: Story Mode switch on by
  default, 2.5D parallax switch off by default). Story Mode template lives in
  `src/lib/story-template.ts` (canonical) with a dependency-free mirror in
  `worker/src/story.ts`; parallax in `src/lib/render/parallax.ts` mirrored by
  `worker/src/parallax.ts`.
- **Billing:** Story Mode is the standard 1.0 multiplier — same price as a standard
  render. Parallax is a paid add-on on the server engine: `+0.25 credits/minute`
  (via the pre-existing `parallax25d` option in `quoteMultiAspectRender`, whole-credit
  ceil total); the browser preview applies it free. RenderPanel quote and
  `formatRenderCost` both receive `parallax25d`, so the shown number is the charged number.
- **Treatment:** hook (8%) → setup (20%) → rising tension (42%) → payoff (20%) →
  loop/CTA (10%). Story Mode drives per-beat motion (or parallax intensity via
  `storyParallaxMultiplier`), hook/payoff caption emphasis (larger `VidoraHook` ASS
  style), a per-beat music volume envelope, and a deeper/faster duck profile
  (threshold 0.02, ratio 10, attack 20ms, release 600ms).
- **Parity:** browser and worker both implement story beats, parallax (cover-scale +
  12%-per-intensity overscan + 10%-per-intensity slow zoom + center-biased diagonal
  pan, alternating in/out per scene, intensity clamped 0..1, default 0.5) and the
  story duck profile. Honest gap: parallax intensity is not user-adjustable in the
  UI yet (fixed default 0.5, beat-scaled); the toggle is boolean only.
- **Reverse:** Remove the RenderPanel treatment box (D27's exact reverse, restored);
  remove `storyMode`/`parallax25d` from the enqueue schema and worker meta.

### D41. Long-form chapter pipeline (Sprint 3–4)
- **Decision:** Videos > 6 min (or explicitly requested) render as **4–8
  chapters**, each an independent `render_chapters` row
  (`queued/rendering/done/failed`) plus a paragraph-audio `tts_cache` keyed by
  (provider, voice, language, paragraph_hash). The worker plans per chapter
  (pure `planChapterWork`), renders up to `WORKER_CHAPTER_CONCURRENCY`
  (default 2) chapters in parallel, validates resume checkpoints by
  re-downloading each `done` chapter's output from storage (bytes present =
  usable; missing/invalid = re-render), claims chapters with a lease
  (`claimed_at`/`claimed_by`) plus heartbeat, and stitches finished chapter
  MP4s with the FFmpeg **concat demuxer (`-c copy`)** — no re-encode. The
  service-role-only SQL function `requeue_stale_chapters` (migration
  `20260925230000_chapters.sql`) requeues stale `rendering` chapters and
  terminally fails chapters whose `max_attempts` budget is exhausted.
- **Reason:** One 20-minute timeline keeps the worker busy for tens of minutes
  with no usable partial output; a crash near the end wastes all of it, and a
  single scene fix forces a full re-render. Chapters bound the loss to
  in-flight chapters.
- **Reverse:** Delete the chapter branch in the worker and enqueue only
  single-timeline renders.

### D42. Exactly one continuity brief per long-form render
- **Decision:** One `ContinuityBrief` (voice + language tag + TTS model,
  pacing, background style, caption style, tone) is generated once on the app
  side, stored on the parent render's metadata, and passed **by reference**
  to every chapter render. Each chapter renders the parent aspect at the same
  fps with identical codec settings (H.264 `yuv420p`, AAC 128k, same audio
  sample rate), so the concat stitch is byte-compatible across chapters.
- **Reason:** Drift between chapters (different voice pacing, caption style)
  is the visible failure mode of long-form; one shared brief kills it.
- **Reverse:** Allow per-chapter brief overrides if style changes per chapter
  are ever wanted.

### D43. Chapters never bill separately (parent-only accounting)
- **Decision:** Chapters never debit or refund. The app enqueue path quotes
  the parent with the exact per-minute price for the total finished duration
  (`quoteMultiAspectRender`), holds the full amount up front, and on final
  completion the parent's existing idempotent settlement RPC refunds the
  difference. A chapter-only rerender does **not** create a new reserve:
  chapters are an internal production step, and the parent settlement
  already refunds unused minutes.
- **Reason:** Retry storms cannot double-charge; the only money movement is
  the parent hold and one idempotent settlement.
- **Reverse:** Revisit if chapter rerenders get user-facing per-chapter
  pricing.

### D44. Chapter MP4 in storage is the resume checkpoint
- **Decision:** The durable resume checkpoint is the chapter MP4 stored in
  Supabase storage, referenced by `render_chapters.output_path`. The worker
  treats `done` + present-and-valid output as reusable and re-renders
  anything else; local temp files are never trusted across restarts.
- **Reason:** Storage survives worker crashes; `/tmp` does not.
- **Reverse:** Add a `chapter_mp4_sha256` column and verify hashes on resume
  if silent storage corruption ever shows up.
### D45. Public-read catalog tables stay public; the scan warning is accepted by design
- **Decision:** `languages`, `language_voices`, `language_quality_gates`, and `music_tracks` keep `FOR SELECT USING (true)` policies. Lovable's pre-publish scan flags them ("Some access rules let everyone through") — this warning is accepted, not fixed, because every one of these tables is reference/catalog data with zero user PII: language metadata and quality-gate status (drives UI dropdowns and honest Beta labels), the voice catalog (names/verified flags only), and the royalty-free music catalog (D25).
- **Reason:** Scoping reads to "the caller's rows" is meaningless for shared catalogs; the scanner's own guidance allows keeping a permissive policy "only if the data is meant to be shared across all users" — it is. Writes on all four remain service-role-only (no INSERT/UPDATE/DELETE policies for anon/authenticated), so the warning concerns reads of public data only.
- **Reverse:** If any of these tables ever stores user data, add owner-scoped policies and re-run the scan.

### D80. Four AI thumbnail variants per video (was three)
- **Decision:** `THUMBNAIL_VARIANTS` is now 4; `generateThumbnails` loops
  `1..THUMBNAIL_VARIANTS` and the `thumbnails.variant` CHECK is widened to
  `BETWEEN 1 AND 4` (non-destructive migration
  `20260926002000_thumbnail_variants_provenance.sql`). A fourth composition
  angle was added to `buildThumbnailPrompt` so variant 4 is distinct instead
  of repeating variant 1's angle via modulo.
- **Reason:** Brief asked for 4 variants; 4 genuinely different angles gives
  the picker real choice.
- **Reverse:** Set the constant back to 3; the CHECK still permits 1..4 so no
  migration is needed to go back.

### D81. Reuse `seo_metadata` as the SEO pack table; no `seo_packs` table
- **Decision:** The SEO pack (title variants + scores, selected title,
  description, tags, hashtags, YouTube chapter timestamps) is stored in the
  existing `seo_metadata` table (one row per project) rather than a new
  `seo_packs` table. The workstream-B deliverable is the pack UI
  (view/regenerate/copy in `SeoStudio`) plus `formatSEOPack`.
- **Reason:** `seo_metadata` already stores exactly the pack shape with
  owner-scoped RLS; a second table would duplicate data and policy surface
  for zero benefit.
- **Reverse:** If packs ever need versioning or per-video (not per-project)
  granularity, introduce `seo_packs` then and migrate rows over.

### D82. Scheduling never auto-publishes; "Publish now" is the human action
- **Decision:** There is no background worker, cron, or queue consumer that
  executes due scheduled jobs. A scheduled job leaves `scheduled` only via
  the human-invoked `executePublishJob` (or `cancelPublishJob`), and it could
  only reach `scheduled` through the human approval gate (`approvePublishJob`).
  The scheduling calendar's "Publish now" button is that explicit human
  action; it is disabled until the job's time arrives. The old
  "will publish automatically at its scheduled time" error text was corrected
  because it described behavior that does not exist.
- **Reason:** Brief requirement; matches the P5 "NO unattended
  auto-publishing" invariant. Integrates with the existing approval check —
  no second approvals table built by this workstream.
- **Reverse:** If unattended publishing is ever wanted, it needs its own
  decision, an explicit user opt-in per job, and an audit trail — not a
  silent change to this rule.

### D83. Explicit provenance columns on `thumbnails`
- **Decision:** Added `prompt_hash TEXT` (SHA-256 of the exact prompt sent to
  the image model) and `is_ai_generated BOOLEAN NOT NULL DEFAULT true` to
  `public.thumbnails`, written by `generateThumbnails` on every upsert.
- **Reason:** `license='ai-generated'` existed but was implicit and the exact
  prompt was stored without a stable fingerprint; per-variant provenance
  (AI-generated, model name, prompt hash, created_at) is now queryable and
  shown in the picker UI.
- **Reverse:** Drop the columns; `provider`/`model`/`license` still record
  the basics.

### D84. Intermittent homepage crash: telemetry first, auto-retry for chunk loads
- **Decision:** (1) New `public.client_errors` table (insert-only RLS for
  anon+authenticated, no SELECT policy so reads are service-role only, no PII
  stored) + root error boundary now reports every crash's message/stack/route
  there. (2) If the error matches a JS chunk/module load failure, the boundary
  auto-reloads once per session per route (sessionStorage guard) instead of
  showing the error page.
- **Reason:** Live diagnosis showed the "This page didn't load" crash is
  intermittent (~40% of homepage loads), homepage-only, assets all HTTP 200,
  retry recovers — consistent with flaky chunk loads or a rare render race,
  but the exact JS error was not capturable remotely. Telemetry ends the
  guessing: the next occurrence records the real error for a targeted fix.
  The auto-retry is safe (single attempt, guarded) and matches the observed
  "retry fixes it" behavior.
- **Reverse:** Drop the table/policies; remove `reportClientError` and the
  `isChunkLoadError` auto-reload from `src/routes/__root.tsx`. The manual
  "Try again" button remains.

### D85. Crash telemetry was silently broken: unbound `supabase.from` + bundle-independent reporter
- **Decision:** (1) Replaced the supabase-js insert in `reportClientError`
  with a direct `fetch` + `keepalive` POST to PostgREST — the error path no
  longer depends on any app module. (2) Added `src/lib/error-bootstrap.ts`,
  a tiny inline `<script>` emitted as the first script in `<head>` that
  installs `window` `error`/`unhandledrejection` listeners before any app
  bundle loads and reports to `client_errors` (max 5 per page load). (3)
  Wrapped `reportLovableError`/`captureError` in try/catch so reporting can
  never break the error page.
- **Reason:** Root cause of the empty `client_errors` table: the shipped code
  did `const untyped = supabase.from; untyped("client_errors").insert(...)`.
  `SupabaseClient.from` is a prototype method — called unbound it throws
  `TypeError: Cannot read properties of undefined (reading 'rest')`, which
  the surrounding try/catch swallowed. Verified with node against the real
  supabase-js: unbound `from()` throws. So D84's telemetry never recorded a
  single crash. The inline bootstrap reporter closes the remaining blind
  spot: crashes during chunk loading or before React boots, which in-bundle
  telemetry can never see.
- **Reverse:** Revert `src/routes/__root.tsx` to the supabase-js call (will
  silently record nothing); remove the `errorBootstrap` script from
  `RootShell`; delete `src/lib/error-bootstrap.ts`.

### D86. Homepage crash root cause: `node:crypto` in client-bundled billing modules — removed permanently
- **Decision:** (1) New `src/lib/sha1.ts`: pure-JS SHA-1, byte-identical to
  node:crypto (verified against node:crypto, openssl, sha1sum, Python
  hashlib). (2) `src/lib/billing/billing-math.ts` now uses it — the
  `import { createHash } from "node:crypto"` that crashed the homepage is
  gone, and `eventRefUuid` output is unchanged (pinned in tests) so existing
  idempotency refs in the DB still match. (3) `src/lib/billing.functions.ts`
  no longer top-level imports `./billing/dodo` / `./billing/razorpay`
  (node:crypto HMAC webhook verification) — they are dynamically imported
  inside the `getBillingConfig` server handler, matching the existing
  `client.server`/`stripe` pattern. (4) `chapters.functions.ts` and
  `server-renders.functions.ts` use universal `crypto.randomUUID()` instead
  of `node:crypto`. (5) New `src/lib/client-bundle-safety.test.ts` fails the
  build if any client-reachable module ever imports `node:*` again, or if a
  server-only provider becomes a top-level import.
- **Reason:** The 2026-09-26 05:53 UTC `client_errors` row gave the exact
  stack: `Module "node:crypto" has been externalized for browser
  compatibility` at `billing-math.ts:1`, reached via homepage →
  PricingSection → billing.functions.ts (createServerFn modules are bundled
  for the client; their top-level imports are evaluated in the browser, where
  Vite replaces node:crypto with a throwing shim). The crash was intermittent
  because production Rollup usually tree-shakes the unused server imports out
  of the client chunk, but dev/preview bundling (and chunking
  nondeterminism) evaluates them — hence ~40% failure. Removing node:* from
  the client module graph kills the failure class regardless of bundler
  behavior.
- **Reverse:** Reintroduce `node:crypto` imports in the guarded files (the
  new test will fail loudly first); restore top-level dodo/razorpay imports
  in billing.functions.ts.

### D87. Homepage "reading 'grade'" crash root cause: rAF timestamp predating performance.now() — clamped
- **Decision:** (1) New exported `loopElapsed(nowMs, startMs)` in
  `src/components/vidora/cinema/Hero.tsx` clamps the animation clock at 0:
  `Math.max(0, (now - start) / 1000) % TOTAL`. (2) New exported
  `sceneIndexForTime(t)` always returns a valid SCENES index, even for
  negative/NaN/Infinity inputs. (3) Render uses `SCENES[sceneIdx] ??
  SCENES[0]!` as a last-resort fallback so the monitor can never unmount the
  homepage over an animation index. (4) New `Hero.test.ts` (8 tests) pins the
  first-frame race and the index math.
- **Reason:** The 2026-09-26 06:12–06:15 UTC `client_errors` rows gave exact
  stacks: `TypeError: Cannot read properties of undefined (reading 'grade')`
  at the minified routes chunk 1:2843 — verified by downloading the served
  bundle to be RenderMonitor's `o.grade` read (`o = b[a]`,
  `a = Math.floor(e / (y / b.length)) % b.length`). The only way `b[a]` is
  undefined is `e` (state t) being negative/NaN: on the first animation frame,
  the rAF timestamp can predate the `performance.now()` captured when the
  effect ran (observed in Firefox — one stack was Firefox-formatted), making
  `(now - start)` a tiny negative; JS `%` preserves the sign, so t went
  negative, `Math.floor(negative / 4) % 3` produced -1, and `SCENES[-1].grade`
  threw during render. Intermittent because it is a first-frame race — most
  loads never hit it. The clamp fixes the actual negative-clock bug; the
  index helper + fallback make the render path unconditionally safe.
- **Reverse:** Revert Hero.tsx to the inline `((now - start) / 1000) % TOTAL`
  and `SCENES[Math.floor(t / (TOTAL / SCENES.length)) % SCENES.length]!`
  (the new tests will fail loudly first).

### D89. Phase 1 supabase-js table types must be `type` aliases, not `interface`s
- **Decision:** Local table-type declarations for Phase-1 tables (until generated `types.ts` catches up) are `type` aliases.
- **Reason:** Interfaces lack implicit index signatures and fail supabase-js's `GenericSchema` check (`Row: Record<string, unknown>`), collapsing `Schema` to `never` — this caused all initial tsc errors in `durable-jobs.server.ts`.
- **Reverse:** Once migrations are applied and types regenerated, delete the local aliases and import from generated types.

### D90. generation_jobs claim recorded in `checkpoint.__claim` (no worker_id column)
- **Decision:** The claiming worker is recorded inside the `checkpoint` JSONB as `__claim`; no migration was added for a `worker_id` column.
- **Reason:** Migrations were forbidden mid-phase and the column would require a migration anyway; the claim is observable for lease/reap logic from JSONB. A proper `worker_id`/`lease_expires_at` column can be added in a later migration (requeue_stale_renders already handles stale claims by lease timeout).
- **Reverse:** Add the column via migration and switch `claimGenerationJob` to write it.

### D91. Budget spend measured from `generation_jobs.cost_actual_credits`, not the ledger
- **Decision:** Month-to-date workspace/project spend is summed from `generation_jobs.cost_actual_credits` (has `workspace_id`/`project_id`), not `credit_ledger` (user_id only).
- **Reason:** The ledger genuinely lacks workspace/project columns; attributing ledger rows to workspaces would be fabricated. Documented in code + KNOWN_ISSUES. If the ledger ever gains workspace refs, switch the budget source and note the cutover.
- **Reverse:** Add workspace_id/project_id columns to credit_ledger via migration; repoint `checkBudgetForSpend`.

### D92. Phase 1 lint policy: zero new errors, pre-existing baseline left alone
- **Decision:** `npm run lint` on `origin/main` already reports 4459 errors / 13 warnings (mostly `no-explicit-any` + prettier across the legacy codebase). Phase 1 added 37 new prettier errors via workers; all were fixed with `eslint --fix` scoped to Phase-1-touched files only (`git diff --name-only origin/main`). The repo was NOT bulk-reformatted — fixing 4414 auto-fixable legacy issues would create a giant noise diff.
- **Reverse:** A future "lint cleanup" PR can run `eslint --fix` repo-wide once, as its own reviewed commit.

### D93. `enqueueServerRender` writes durable job AFTER `renders` insert, wrapped in try/catch
- **Decision:** The `generation_jobs` row + per-aspect provider tasks are created only after the `renders` insert succeeds; the whole block is try/caught and can never break the enqueue response.
- **Reason:** No orphan durable jobs on failed enqueues; render-path behavior stays byte-identical if the durable-jobs module throws. The `groupId`-derived idempotency key only dedupes true double-execution (client-supplied keys are a future step).
- **Reverse:** Move job creation before the insert or let errors propagate — not recommended.

### D94. Phase 2 intelligence is deterministic and LLM-free
- **Decision:** Niche scoring (F1) and channel blueprints (F2) are rule-based and deterministic — factors, weights, and confidence degradation are computed from snapshot data, never generated by an LLM. `aiNotes` fields return `[]` explicitly.
- **Reason:** Explainability and reproducibility: a score must be auditable factor-by-factor. Demand is labeled **ESTIMATE** everywhere; the UI never presents a score as a prediction of virality/CTR/RPM.
- **Reverse:** Wire an LLM for positioning copy or insight notes later — scores/factors stay rule-based; any AI text gets labeled as AI interpretation.

### D95. YouTube cache TTLs + quota recording (channels 24h / videos 6h / search 1h)
- **Decision:** `youtube_api_cache` stores channel responses 24h, video responses 6h, search responses 1h; every live call records quota cost in `api_usage`.
- **Reason:** Balances freshness against the 10,000-units/day default quota — search (the most expensive, exploratory call) gets the shortest TTL; channel metadata the longest. Honest `unconfigured` envelope when no key, with zero network/quota side effects (unit-tested).
- **Reverse:** Shorten TTLs if freshness complaints arrive; lengthen if quota pressure rises. TTLs are constants in one module.

### D96. Snapshot-based outlier scoring (latest views ÷ sibling median)
- **Decision:** An outlier score is descriptive: the video's latest snapshot views divided by the median of its sibling videos' views, with velocity/day, factors, and confidence shown. The "3.2× median" badge title says "descriptive, not a prediction".
- **Reason:** Anchors the score to data the user can inspect (snapshots), not to a black-box model. Confidence degrades when the sibling set is thin.
- **Reverse:** Swap in a richer model later — keep the median-multiple as the displayed baseline alongside it.

### D97. Smart Folder semantics: rules match rows, pins win, 500-row scan limit
- **Decision:** Folder rules match rows server-side (`matchFolderRules`); explicitly pinned items are excluded from rule-match duplicates; each rule scans at most 500 rows per table per folder.
- **Reason:** Pins are user intent and must never fight rules; the scan cap keeps rule evaluation bounded on large libraries (documented in KNOWN_ISSUES). Supported fields are an explicit allowlist (`videos.view_count`, `videos.outlier_score`, `videos.published_at`, `video_ideas.status`, `research_sources.source_type`, `channels.subscriber_count`).
- **Reverse:** Raise the cap or add cursor pagination when asset counts justify it; widen the field allowlist per feature request.

### D98. Dual-mode E2E: unconfigured honesty is a passing state
- **Decision:** `e2e/niche-finder.spec.ts` is dual-mode: without `YOUTUBE_API_KEY` each scenario asserts the honest "YouTube Data API not connected" panel and zero fabricated rows, then returns early. The configured branch (real key, real quota burn) is opt-in by the founder.
- **Reason:** No row is ever faked to satisfy an assertion; the unconfigured path is itself a product guarantee worth testing. The E2E spec was rewritten 2026-09-27 to the real UI flow (New niche dialog, `data-testid` row hooks, draft-script handoff toast) after the Stream-D-authored selectors drifted from the merged UI.
- **Reverse:** If a seeded demo dataset is ever wanted for E2E, it must be labeled `DEMO DATA` in both the UI and the spec — never silently stand in for real rows.

## 2026-09-28 — Phase 3 Stream C (Thumbnails & Characters)

### D99. Normalized 0–1 canvas coordinates; design projects vs rendered variants stay separate
- **Decision:** The layered canvas (`thumbnail_projects.canvas`) uses normalized 0–1 coordinates so one editing model serves 16:9 and 9:16. `thumbnail_projects` is the design surface; `public.thumbnails` remains the canonical rendered-variant/winner store.
- **Reason:** Aspect-agnostic editing; variant renders are the things experiments and YouTube uploads consume, while the canvas is the thing users edit. Mixing them would corrupt the experiment arm contract.
- **Reverse:** Store per-aspect canvases if normalization ever causes rounding artifacts.

### D100. Provider availability checked before preflight; no fake images
- **Decision:** `generateThumbnailVariants` checks the image-provider key first (`image_provider_unconfigured`), then ownership, then credit preflight. The UI disables generation and shows an honest panel when unconfigured.
- **Reason:** Preflighting or debiting a call that cannot run would burn credits on nothing; fabricating a placeholder image would violate the no-fake-output rule. Unconfigured honesty is unit-tested (zero network calls).
- **Reverse:** If a free fallback generator is ever added, gate it behind the same preflight and label outputs clearly.

### D101. Scene binding via `scenes.metadata.character_id`, not legacy `scenes.character_id`
- **Decision:** Character↔scene binding writes `character_id` into `scenes.metadata` JSONB (null to unbind, other keys preserved); the legacy `scenes.character_id` column is left untouched.
- **Reason:** Per the Phase 3 assignment; metadata binding avoids a schema dependency on the legacy column and keeps unbind idempotent.
- **Reverse:** If Stream F standardizes on the column, migrate bindings over and drop the metadata key.

### D102. Reference images stored as private paths; UI gets signed URLs
- **Decision:** `characters.reference_image_url` stores a storage path (`character-refs/<uid>/<cid>/ref.<ext>`), never a hotlinked URL; the UI receives 1-hour signed URLs. Upload validates JPEG/PNG/WebP and ≤5 MB before any storage write.
- **Reason:** SECURITY_MODEL roadmap item 4 (malware-safe handling): server-validated MIME/size, private bucket, no user-controlled public URLs.
- **Reverse:** None planned; magic-byte sniffing could strengthen validation later.

### D103. Character binding is a reference attachment, never a consistency claim
- **Decision:** Every reference surface shows “Reference attached — visual consistency across scenes is not yet verified. A 6-scene proof render is required before any consistency claim is made.” No consistency claim until a real six-scene proof render passes.
- **Reason:** The brief's explicit rule; claiming consistency without the proof render would be a fabricated capability. Recorded in KNOWN_ISSUES as a founder/Phase-4 blocker.
- **Reverse:** After the proof render passes, update the copy and FEATURE_MATRIX.

### D104. No debit after variant generation — billing policy left to Stream F
- **Decision:** `generateThumbnailVariants` preflights (affordability) but does not debit. The `debit_credits_for_job_once` RPC debits exactly 1 credit with no amount parameter (the legacy thumbnail flow's `p_amount` argument does not match the RPC signature), so inventing per-variant debit semantics here would be a money decision made without authority.
- **Reason:** Debiting real user credits with wrong semantics is worse than not debiting; preflight satisfies the "credit preflight before paid ops" rule. Documented in KNOWN_ISSUES as a Stream F integration need.
- **Reverse:** Once billing policy is decided (1/batch vs per-variant vs estimate-based), add the debit call in `generateThumbnailVariants` after successful persistence, with an idempotency key per generation run.

### D105. `getOrCreateThumbnailProject` normalizes to one `LoadedProject` shape
- **Decision:** The server function wraps the create path into `{ project, canvas, problems }` so the UI has a single contract whether the project was found or created.
- **Reason:** Two shapes (`ThumbnailProjectRow` vs `LoadedProject`) leaked into the UI and caused type errors; the normalization is server-side and invisible to callers.
- **Reverse:** None.
