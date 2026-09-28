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

### D99. F8 idea score factor weights pinned (outlier_alignment 35 / hook_strength 25 / feasibility 20 / safety 20)
- **Decision:** The four `IdeaScoreFactor`s carry pinned weights (35/25/20/20) in `src/lib/creation/ideas/scorer.ts`, chosen so outlier evidence dominates while feasibility/safety keep the score honest. Changing any weight is a code change, not a config tweak — the weights are part of the score's identity and are unit-pinned.
- **Reason:** Deterministic, explainable scores (D94) require the weighting to be visible and stable; a hidden tunable weight would let the score drift without review.
- **Reverse:** If a future stream needs tunable weights, add a workspace-level config table and include the active weight-set version in the score cache payload so old scores stay comparable.

### D100. `outlier_videos.outlier_score` is the ideation evidence source (not `videos.outlier_score`)
- **Decision:** F8's outlier_alignment factor reads `outlier_videos.outlier_score` (Phase 2: latest views ÷ sibling median). The canonical `videos` table has no `outlier_score` column — the plan's column name was wrong, and the implementation follows the real schema.
- **Reason:** Evidence must come from the surface that actually exists and is documented (D96), not from a plan typo.
- **Reverse:** None — if `videos` ever gains its own outlier column, Stream F must decide which source is canonical before the scorer switches.

### D101. Title Lab is deterministic and template-based — no LLM spend
- **Decision:** `generateTitleVariants` uses pinned templates over the topic/keywords (no LLM call, no paid provider spend); `scoreTitle` is a pure heuristic (length/keyword/curiosity/clarity). Variants are framed in UI copy as packaging heuristics, never CTR predictions.
- **Reason:** Keeps Stream A credit-free (no preflight wiring needed) and deterministic; the experiment framework (`experiments`/`experiment_arms`) is the honest place to measure what actually works — Phase 4 reads it.
- **Reverse:** If an LLM title path is added later, it must go through credit preflight + `ProviderResult` (D58/D60) and keep the deterministic path as the zero-cost default.

### D102. Campaign package artifacts start `planned` with `ref: null` — no fabricated references
- **Decision:** Every `CampaignItem` created by `buildCampaignPlan` starts with `status: "planned"` and `ref: null`; real artifact UUIDs are attached later via `linkCampaignItem` (validates target row + ownership before writing).
- **Reason:** A campaign is a plan, not a lie — writing refs to rows that don't exist would fabricate progress. The UI shows "not created yet" for unlinked items.
- **Reverse:** Never backfill refs from non-existent rows; if an artifact is deleted, its campaign item must return to `planned`/`ref: null`.

### D103. Stream A idea→project reuses `useIdea` (no duplicate project creation)
- **Decision:** F8 does not implement its own idea→project conversion; the `/create` hub calls the existing `useIdea` server fn (creates a real `projects` row, sets `video_ideas.project_ref` + status `used`). The hub list fn is named `listIdeasForHub` to avoid colliding with the existing `listIdeas`.
- **Reason:** One conversion path, one invariant set (D61/D62-style real-rows-only). Duplicating it would risk two divergent "used" semantics.
- **Reverse:** If `useIdea`'s contract changes, the Stream A hub inherits the change — no local fork to drift.

### D104. TanStack Start serializability: `Json` type over `Record<string, unknown>` for jsonb fields
- **Decision:** All jsonb-backed row fields exposed through server fns use the repo's `Json` type (from `@/integrations/supabase/types`) or a concrete interface (`CampaignMetadata`), never `Record<string, unknown>` — and server fns are invoked as `fn({ data: ... })`.
- **Reason:** `Record<string, unknown>` fails the server-fn serializability validator (collapses the fn's type; 70+ cascading TS errors) and violates `noPropertyAccessFromIndexSignature`. The concrete types are both serializable and self-documenting.
- **Reverse:** If a field genuinely needs an open map, keep `Json` (it is an open map) — do not regress to `Record<string, unknown>`.

### D105. Strict review semantics: only human CONFIRM counts (2026-09-27)
- **Decision:** Strict mode (`projects.research_strict_mode`) means *every* claim must have a human **CONFIRM**. Both `unreviewed` AND `waived` claims block script approval, package export, publish approval, and publish execution. A waiver stays useful and visible in non-strict workflows, but it means the claim was deliberately *not* verified, so it cannot satisfy "confirmed source" strict mode. A waived claim can later be confirmed to unblock.
- **Reason:** "Strict" is a promise to the audience that every factual claim was verified. Letting waivers pass would silently redefine the promise. No code path auto-confirms claims — confirmation is always an explicit human action (`setClaimReview` only admits `confirmed` | `waived`).
- **Reverse:** If a third state is ever needed (e.g. "confirmed-by-AI"), it must be a new explicit review state that still does not satisfy strict mode unless a human confirms.

### D106. AI script draft: debit BEFORE persist (2026-09-28)
- **Decision:** `generateScriptDraft` debits the 1 credit *before* persisting the script/version, matching the existing publish thumbnail/SEO debit-first convention. If the debit fails, nothing is saved — no unpaid output can remain. All billing/provider failures return `ProviderResult` envelopes (including `DEBIT_FAILED`); the function never throws for provider or billing states. `actualCost: 1` on success. One idempotency key (`generationRef`) per attempt: a retry spends another credit (new output), a double-submit within the attempt does not.
- **Reason:** The alternative (persist-then-debit with rollback) leaves a window where unpaid output exists and needs compensating deletes; debit-first has a single failure mode (charged but unsaved) that matches how the rest of the codebase already behaves. Fail-open `recordApiCost` by existing convention.
- **Reverse:** If exact-once billing semantics are required later, move to a reservation model (reserve → generate → commit/release) rather than reordering back.

### D107. One shared publish strict-gate assertion (2026-09-28)
- **Decision:** The strict evidence check for publish lives in exactly one exported function, `assertPublishStrictGate` (`src/lib/publish.functions.ts`), called by both `approvePublishJob` and `runExecutePublishJob` (execution re-checks immediately before the uploader runs — a claim confirmed after approval keeps it green; an unconfirmed one blocks the upload). Stream F must import the underlying `getProjectStrictGate` from `src/lib/creation/claims/strict-gate.ts` and must NOT duplicate strict-mode logic; any package/quick-create action stops when `blocked === true`.
- **Reason:** Two call sites with copied gate logic would drift (the execution re-check was added precisely because approval-time checks go stale). One function, one rule.
- **Reverse:** None — only extend the single assertion if the rule changes.

### D108. Package export gate is client-enforced; publish is server-enforced (2026-09-28)
- **Decision:** The ZIP package is generated client-side in `projects.$projectId.tsx`, so its strict gate is client-enforced: the Export button disables when `getProjectGateState` reports `blocked === true` and the handler re-fetches the gate immediately before packaging. Publish approval and execution are enforced on the server and cannot be bypassed by UI state. This limitation is documented, not hidden.
- **Reason:** A server-generated package endpoint is the correct long-term fix, but inventing one inside Stream B's scope would duplicate the export pipeline. The client gate is honest defense-in-depth; the money path (YouTube upload) is fully server-gated.
- **Reverse:** When a server-side package endpoint exists, move the gate check there and keep the client button as a UX affordance only.

## 2026-09-28 — Phase 3 Stream C (Thumbnails & Characters)

### D109. Normalized 0–1 canvas coordinates; design projects vs rendered variants stay separate
- **Decision:** The layered canvas (`thumbnail_projects.canvas`) uses normalized 0–1 coordinates so one editing model serves 16:9 and 9:16. `thumbnail_projects` is the design surface; `public.thumbnails` remains the canonical rendered-variant/winner store.
- **Reason:** Aspect-agnostic editing; variant renders are the things experiments and YouTube uploads consume, while the canvas is the thing users edit. Mixing them would corrupt the experiment arm contract.
- **Reverse:** Store per-aspect canvases if normalization ever causes rounding artifacts.

### D110. Provider availability checked before preflight; no fake images
- **Decision:** `generateThumbnailVariants` checks the image-provider key first (`image_provider_unconfigured`), then ownership, then credit preflight. The UI disables generation and shows an honest panel when unconfigured.
- **Reason:** Preflighting or debiting a call that cannot run would burn credits on nothing; fabricating a placeholder image would violate the no-fake-output rule. Unconfigured honesty is unit-tested (zero network calls).
- **Reverse:** If a free fallback generator is ever added, gate it behind the same preflight and label outputs clearly.

### D111. Scene binding via `scenes.metadata.character_id`, not legacy `scenes.character_id`
- **Decision:** Character↔scene binding writes `character_id` into `scenes.metadata` JSONB (null to unbind, other keys preserved); the legacy `scenes.character_id` column is left untouched.
- **Reason:** Per the Phase 3 assignment; metadata binding avoids a schema dependency on the legacy column and keeps unbind idempotent.
- **Reverse:** If Stream F standardizes on the column, migrate bindings over and drop the metadata key.

### D112. Reference images stored as private paths; UI gets signed URLs
- **Decision:** `characters.reference_image_url` stores a storage path (`character-refs/<uid>/<cid>/ref.<ext>`), never a hotlinked URL; the UI receives 1-hour signed URLs. Upload validates JPEG/PNG/WebP and ≤5 MB before any storage write.
- **Reason:** SECURITY_MODEL roadmap item 4 (malware-safe handling): server-validated MIME/size, private bucket, no user-controlled public URLs.
- **Reverse:** None planned; magic-byte sniffing could strengthen validation later.

### D113. Character binding is a reference attachment, never a consistency claim
- **Decision:** Every reference surface shows “Reference attached — visual consistency across scenes is not yet verified. A 6-scene proof render is required before any consistency claim is made.” No consistency claim until a real six-scene proof render passes.
- **Reason:** The brief's explicit rule; claiming consistency without the proof render would be a fabricated capability. Recorded in KNOWN_ISSUES as a founder/Phase-4 blocker.
- **Reverse:** After the proof render passes, update the copy and FEATURE_MATRIX.

### D114. No debit after variant generation — billing policy left to Stream F
- **Decision:** `generateThumbnailVariants` preflights (affordability) but does not debit. The `debit_credits_for_job_once` RPC debits exactly 1 credit with no amount parameter (the legacy thumbnail flow's `p_amount` argument does not match the RPC signature), so inventing per-variant debit semantics here would be a money decision made without authority.
- **Reason:** Debiting real user credits with wrong semantics is worse than not debiting; preflight satisfies the "credit preflight before paid ops" rule. Documented in KNOWN_ISSUES as a Stream F integration need.
- **Reverse:** Once billing policy is decided (1/batch vs per-variant vs estimate-based), add the debit call in `generateThumbnailVariants` after successful persistence, with an idempotency key per generation run.

### D115. `getOrCreateThumbnailProject` normalizes to one `LoadedProject` shape
- **Decision:** The server function wraps the create path into `{ project, canvas, problems }` so the UI has a single contract whether the project was found or created.
- **Reason:** Two shapes (`ThumbnailProjectRow` vs `LoadedProject`) leaked into the UI and caused type errors; the normalization is server-side and invisible to callers.
- **Reverse:** None.

### D116. TTS fallback chain: ElevenLabs → OpenAI → gateway, one attempt each
- **Decision:** `synthesizeSpeechWithFallback` (Stream D) mirrors the Phase-1 `generateVideoWithFallback` pattern exactly: ordered providers, ONE attempt per provider, failed paid calls never retried blindly, `ProviderResult`-style envelopes that never throw, injectable fakes for tests (production resolves from env).
- **Reason:** Voice is paid per character; a retry loop against a failing paid provider is a money leak. The explicit order also makes the UI's "ElevenLabs first, OpenAI fallback, gateway last resort" copy truthful.
- **Reverse:** Reorder via `VOICE_TTS_FALLBACK` env (unknown ids are ignored, fail-closed); add providers by registering a new adapter in `resolveTtsChain`.

### D117. `voices` D89 local aliases + `asVoicesClient` (follows `asJobsClient`)
- **Decision:** Generated Supabase types predate the creation migrations (`voices` absent; `language_voices` carries pre-creation columns), so Stream D declares `VoiceRow`/`VoiceInsert`/`VoiceUpdate` from the Phase-1 migration SQL and narrows the client via `asVoicesClient` — the same contained-cast pattern as `asJobsClient` in `durable-jobs.server.ts`. `language_voices` is queried with its real columns (no `voice_type` — catalog entries are always builtins).
- **Reason:** D89 forbids broad unsafe casts; the contained `as unknown as` in one function keeps every query builder fully typed while callers pass ordinary clients.
- **Reverse:** Regenerate `src/integrations/supabase/types.ts` from the cloud DB and retire the local aliases.

### D118. Voiceover job cost recorded exactly once (no double-count)
- **Decision:** `recordProviderTask` records `costActual` (the estimate, the only measured figure for TTS); `completeGenerationJob` is called WITHOUT `costActualCredits` because it sums `provider_tasks.cost_actual` itself — passing both would double the job's `cost_actual_credits`.
- **Reason:** Budget math reads `cost_actual_credits`; a 2× overstatement would falsely trip workspace/project budget caps.
- **Reverse:** If TTS ever produces a metered actual (provider usage callback), record the real figure in the task and keep the completion param absent.

### D119. TTS debits ride the minute-based ledger RPC
- **Decision:** `runVoiceoverJob` debits via `debitMinutesForJob` (idempotent per job id, balance re-checked atomically, `failGenerationJob` refunds) — the only existing idempotent debit path for generation jobs. The TTS credit estimate is converted with `Math.ceil` (1 credit = 1 minute); the deprecated flat `debitOneCreditForProject` is not used.
- **Reason:** A bespoke non-idempotent debit would risk double-charging on retries; the minute ledger already has the refund path wired into job failure.
- **Reverse:** Add a dedicated credit-amount debit RPC when TTS estimates need sub-credit precision.

### D120. Contended voiceover jobs return `JOB_IN_PROGRESS`, not a throw
- **Decision:** When `claimGenerationJob` loses the race (another tab/worker owns the job), `runVoiceoverJob` returns `{ ok: false, code: "JOB_IN_PROGRESS" }` telling the caller to retry with the same idempotency key; a completed job reuses its stored `checkpoint.audio_url` with no paid work.
- **Reason:** Throwing a 500 on a normal race is hostile; the durable job already stores everything needed for a poll-and-reuse flow.
- **Reverse:** If a real async worker pool appears, replace the message with a job-status subscription.

### D121. `NO_TTS_PROVIDER` is checked before credit preflight
- **Decision:** The ordered-chain emptiness check runs before `preflightCreditsCheck`, so a user with no provider configured gets "connect a provider" instead of a misleading insufficient-credits error.
- **Reason:** Error precedence should name the true blocker; balance checks are meaningless when no provider could be called.
- **Reverse:** None — ordering is internal.

### D122. Stock unconfigured = honest, zero-network; mocks are explicit opt-in
- **Decision:** Without Pexels/Pixabay keys, `searchStockAssets` returns `{ configured: false }` without a single network call; the UI renders "stock provider not connected". Mock preview assets appear ONLY when the caller passes `includeMock: true`, keep `mock://` URLs and the D48 "MOCK — preview asset, not licensed for use" label, and are never written as licensed rows.
- **Reason:** Silent mock substitution in a licensing-sensitive flow is the exact failure D48 was written to prevent; the zero-call guarantee also means no surprise quota/key usage.
- **Reverse:** If a demo mode is ever wanted, it must be labeled `DEMO DATA` per D98.

### D123. Voice Studio extends the voiceover mode; `/voices` is a real route
- **Decision:** Stream D extends (not replaces) the existing voiceover mode: `/voices` route renders `VoiceStudio` (library + TTS tabs), linked from `/studio` header; `StockPicker` is a dialog component wired to `selectStockAsset` for Stream F's scene integration.
- **Reason:** The voiceover dialog's job flow stays intact; the studio adds library management and multi-provider TTS around it rather than forking a competing mode.
- **Reverse:** If the voiceover dialog is later merged into the studio, keep the `/voices` route as the canonical surface.

### D124. StockPicker lives in the project scene editor, not as a standalone page
- **Decision:** `StockPicker` is a controlled dialog hosted by `SceneCard` (`projects.$projectId.tsx`) — a "Stock" button beside "Visual" regenerate, pre-filled with the scene's `search_query`, selecting via `selectStockAsset` then invalidating the project query. The existing P4 `VoicePicker` catalog (`src/lib/voices.ts`) was deliberately NOT merged into the Stream-D voice library: unifying the two voice id schemes is a coordinator-level merge decision, and touching the P4 picker risks breaking flows other streams depend on.
- **Reason:** Scene assets are pipeline-written; the only manual visual-swap surface is the project page's per-scene card, so that is where manual stock selection belongs.
- **Reverse:** If Stream F's scene producer grows its own visual-repair UI, host a second StockPicker there — the component is scene-id-keyed and reusable.

### D125. Explicit `asplit=2` on the voice bus (narration duplication finding)

- **Decision:** `buildFinalAudioMix` (src/lib/audio.ts:117) builds the final
  mix graph with an explicit `[voice]asplit=2[vkey][vmix]` — one copy feeds
  sidechaincompress as the (inaudible) ducking key, the other feeds amix as the
  audible track. The worker keeps a dependency-free mirror of the same graph
  (worker/src/pipeline.ts:442-444).
- **Reason:** The old graph consumed the voice bus twice and relied on
  ffmpeg's implicit auto-split of multi-consumer pads. The double consumption
  was CORRECT by design (sidechain key = control signal, not audible audio —
  no narration duplication), but implicit: a future graph reorder could
  silently change which copy drives the compressor. Explicit split is
  unit-testable (`itFfmpeg` dry-run proves parse + run).
- **Reverse:** Revert to the implicit graph if an ffmpeg build ever rejects
  the explicit split — no known build does.

### D126. Studio checkpoints live in `generation_jobs.checkpoint.studio`; worker segment state in `renders.checkpoint.segments`

- **Decision:** App-side scene checkpoints (done/failed, first-incomplete,
  invalidate-one-scene repair) are stored under `generation_jobs.checkpoint.studio`
  via `saveCheckpoint` deep-merge (`src/lib/creation/checkpoints/checkpoints.ts`).
  Worker-side per-segment completion is stored under `renders.checkpoint.segments`
  (`worker/src/segment-checkpoints.ts`, `readRenderCheckpoint`/`markSegmentDone`).
- **Reason:** `scenes` is the mutable live head; `scene_versions` is history;
  generation-job checkpoints are the durable-jobs system's state. Two stores
  stay intentionally separate: the app checkpoint answers "which scenes are
  done for this job", the render checkpoint answers "which segments already
  rendered for this render id". The Studio status panel reads the generation-job
  checkpoint; the worker reads/writes the render checkpoint. They are NOT
  auto-synced — claiming end-to-end sync without proof would be dishonest.
- **Reverse:** Sync them (or surface render checkpoint state in the Studio UI)
  once the worker path is proven in production.

### D127. Repair invalidates one scene; only the paid regen steps cost credits

- **Decision:** `repairScene` kinds (`narration`/`audio`/`visual`/`timing`)
  invalidate exactly one scene's checkpoint entry and preserve siblings.
  `timing` repair is free (metadata-only `recomputeSceneTimingCore`).
  The repair function itself spends no credits; the paid regeneration steps
  (`regenerateSceneAudio`/`regenerateSceneVisual`) remain inside the existing
  preflighted credit-gated server functions.
- **Reason:** Keeps "repair" (state management) honest vs "regenerate" (paid
  provider call). A narration edit that also needs new audio routes through
  the preflighted regen path so the credit gate can't be bypassed.
- **Reverse:** Fold free timing repair into regen if UX demands one button.

### D128. F24 shorts: project linkage via `project_id`; `parent_id` is the source RENDER, not the project

- **Decision:** `renders.parent_id` is the self-FK to `renders(id)` documented
  in `20260926001000_renders_parent_id.sql` ("a dub/short derives from a
  finished render") — it takes a render id or NULL, never a project id. The
  short's link to its scenes' project travels on the standard `project_id`
  column. The Studio Shorts tab offers an optional "cut from finished render"
  picker (completed renders via existing `listRenders`); default is NULL.
  `meta.kind = "short"` distinguishes recuts; `meta.source` records the
  scene source.
- **Reason:** Passing the project UUID into `parent_id` would violate the
  self-referential FK and fail the insert. The earlier "D54 source-project
  pattern" assumption was wrong; the migration comment is authoritative.
- **Reverse:** None — schema constraint, not a choice.

### D129. Shorts plan is rule-based hook-first resequencing, labeled as such

- **Decision:** `planShort` reorders selected scenes by a deterministic rule
  (strongest hook candidates first, narration tightened, 9:16, duration cap)
  and the UI labels it "rule-based (not AI analysis)". No LLM call, no fake
  "AI analyzed your video" claims.
- **Reverse:** Swap in an LLM rerank later behind the same plan shape —
  keep the rule-based path as the honest fallback.

### D130. Video Studio extends, never forks, the render pipeline

- **Decision:** The Studio route (`/_authenticated/studio/$projectId`) enqueues
  through the existing `enqueueServerRender` (durable jobs + credit gate
  intact). `RenderPanel` gained optional passthrough props
  (`renderKind`, `parentRenderId`) with defaults preserving full-render
  behavior. The project page links to the Studio; no parallel render path
  exists. Never auto-publishes: shorts enqueue only.
- **Reason:** One enqueue path (D93) means one billing/preflight surface to
  audit. The Studio is a scene-editing front end on `scenes` + existing
  durable jobs, not a second renderer.
- **Reverse:** None planned.

### D131. Quick Create honesty model: skip envelopes, never fake paid stages

- **Decision:** The F23 11-stage pipeline resolves every paid stage
  (voiceover, visuals, render) through one honest resolver: no provider key →
  `skipped_unconfigured`; key present but no explicit spend approval →
  `skipped_needs_spend_approval` with the exact `ESTIMATE` cost of the real
  call attached (never null for paid stages). A stage is marked `done` only
  when its real work happened. The music stage has no music provider in the
  codebase, so it requires a real attached track and skips `skipped_unconfigured`
  otherwise — ducking config is recorded honestly when a track exists.
- **Reason:** The honesty constraint is the feature: a user must never see
  "render complete" for a render that never ran. Skips carry the estimate so
  the approval decision is informed, not blind.
- **Reverse:** When providers are wired, replace `skipped_*` with real
  Phase 1 preflight → debit → provider call → refund-on-failure flows behind
  the same stage states.

### D132. Render stage never enqueues by itself — human button only

- **Decision:** The render stage in Quick Create prepares a real enqueue
  payload (scenes, 9:16, captions burned, ducking) but stays
  `skipped_needs_spend_approval` / approval-ready until the user presses
  "Enqueue real render" in the UI, which calls the existing
  `enqueueServerRender` (D93/D130) with its own credit preflight. The pipeline
  "stops at download" — no auto-publish anywhere.
- **Reason:** Spend + publish are the two irreversible actions; both stay
  behind explicit human approval. One enqueue path keeps billing auditable.
- **Reverse:** None planned.

### D133. SEO Studio reuses the Title Lab engine; no CTR claims

- **Decision:** F26 generates title options through Stream A's
  `generateTitleVariants` + `scoreTitle` (same deterministic engine as Title
  Lab), descriptions/hashtags from fixed templates, and exactly 3 thumbnail
  *concepts* (composition + ≤4-word overlay + rationale) — never generated
  images, never CTR predictions. Export calls the project's real strict gate
  (`getProjectStrictGate`) and returns a blocked envelope with the reason when
  it fails.
- **Reason:** Reuse keeps scoring consistent across surfaces; the studio must
  not invent performance promises or bypass F12's CONFIRM-only gate.
- **Reverse:** Add LLM-assisted variants later behind the same package shape,
  still scored by the same engine.

### D134. Quick-create research facts are the claim candidates

- **Decision:** `runResearchStage` treats each caller-supplied, source-verified
  fact as one F11 claim candidate and links it to the persisted
  `research_sources` rows by keyword overlap, instead of running the
  heuristic `extractClaimCandidates` (which finds zero candidates in
  short declarative facts). Claims persist as `qualified`/`unreviewed` with
  the matched source ids in evidence.
- **Reason:** The fact text IS the claim; the extractor is tuned for
  free-text scripts. This keeps "every claim linked to a source" true without
  inventing claims the user didn't supply.
- **Reverse:** Revisit if fact text becomes long-form prose where extraction
  adds value.

### D135. E2E_30_SECOND_CREATION is the free-path contract test

- **Decision:** The permanent scenario (topic: "Why do airplane windows have
  a tiny hole?", 3 real sources with exact URLs) runs the whole pipeline as
  pure functions: F8 idea scoring, F11 claim linking, 25–35s script, 5–7
  scenes → pinned SceneManifest, scene-level regeneration, Stream E QC
  (fails honestly without visuals / passes with them), ESTIMATE-labeled
  captions, honest paid-stage skips, SEO package. Research wording verified
  2026-09-28 against Gizmodo/AFAR/Family Handyman/scienceblog URLs kept in
  the test header.
- **Reason:** A rerunnable contract that the free path stays honest end to
  end; any future "helpful" shortcut that fakes a stage breaks this test.
- **Reverse:** None — extend, don't replace.




### D136. Comment sentiment is rule-based at ingest; AI is deferred and labeled

- **Decision:** F36 sentiment/question classification ships as deterministic
  rule-based classifiers (`src/lib/comments/sentiment.ts`) run at ingest time.
  If an LLM classifier is added later (e.g. Lovable AI gateway), its outputs
  MUST be labeled "AI analysis" per the pinned contracts.
- **Reason:** Deterministic, offline, testable, zero cost. A rule-based
  baseline can't hallucinate confidence; AI sentiment without provenance
  labels would violate the honesty rules.
- **Reverse:** Swap in AI classification behind the same
  `classifySentiment` signature once gateway keys exist, with results tagged.

### D137. Notification type vocab moves to dotted names; legacy rows still render

- **Decision:** New notifications use the pinned dotted types
  (`render.completed`, `publish.published`, …). The Sprint 1-2
  `render_complete` type is kept in the `NotificationType` union and the bell
  label map so legacy rows render.
- **Reason:** Matches the pinned Phase 4 contract; keeps history readable.
- **Reverse:** None — additive only.

### D138. Consume-only triggers + dedup_key for exactly-once notifications

- **Decision:** `src/lib/notifications/triggers.server.ts` READS other
  streams' tables (generation_jobs, publish_jobs, experiments,
  workspace_budgets, channel_connections) and writes ONLY notification rows
  (asserted by `expectConsumeOnly` in tests). Every emission carries a
  `dedup_key` backed by a partial UNIQUE(user_id, dedup_key) index
  (migration 2026092804d000) plus a 23505 race fallback.
- **Reason:** Cross-stream coordination without write coupling; re-running a
  trigger (or two workers racing) cannot double-notify.
- **Reverse:** If streams grow their own emitters, keep dedup_key as the
  single exactly-once mechanism.

### D139. Comment-derived ideas file under an auto-created "Audience requests" research project

- **Decision:** The one-click idea handoff writes to the canonical
  `video_ideas` table under a per-user research project titled
  "Audience requests", created lazily on first handoff. No schema change.
  Second click on the same insight is a no-op (stamped `idea_id`).
- **Reason:** video_ideas requires a project_id; a dedicated project keeps
  audience-sourced ideas separate from research projects without a parallel
  table (pinned contracts forbid parallel tables).
- **Reverse:** Allow the user to pick a target project in the UI later.

### D140. Draft replies: pinned metadata shape, server-enforced approve-before-post

- **Decision:** Drafts live at `comments.metadata.draft_reply =
  { text, status: 'draft'|'approved'|'posted', approved_by, posted_at }`.
  `postApprovedReply` reads the stored row and throws unless status is
  exactly `'approved'`; the approver is stamped from the session user.
  Creating a draft never touches the network.
- **Reason:** Makes "drafts never auto-send" a server invariant, not a UI
  convention. A compromised/misbehaving client cannot bypass approval.
- **Reverse:** None.

### D141. Comment ingestion scope: top-level + one reply level via commentThreads.list

- **Decision:** Ingestion uses `commentThreads.list?part=snippet,replies`,
  storing top-level comments and their direct replies (each reply linked via
  `metadata.parent_external_comment_id`). Paginates up to 5 pages (500
  threads) per video per run.
- **Reason:** `part=replies` returns both levels in one quota-cheap call
  (1 unit/thread page). Deeper nesting adds little for request mining.
- **Reverse:** Raise maxPages or add `comments.list` per thread if deep
  threads prove valuable.

### D142. No YouTube grant → honest "unavailable", never fixture comments

- **Decision:** Ingestion without a stored grant (or with a revoked one)
  returns `{ status: "unavailable", reason }` and makes zero network calls.
  There is no fixture/sample fallback in the ingestion path.
- **Reason:** Fabricated comments would poison sentiment, mining, and idea
  handoffs. Honest unavailability is the only safe default.
- **Reverse:** None.

### D143. Bell keeps "mark read on open" (existing behavior)

- **Decision:** The notification bell marks all as read when the panel opens
  (existing Sprint 1-2 behavior); new types only add a category label chip.
- **Reason:** No reason to change a working interaction; the Stream D work
  is the new event sources, not the bell mechanics.
- **Reverse:** Per-row read toggles if users ask.

### D144. No platform comment-delete code path, enforced by test

- **Decision:** `drafts.test.ts` greps the comments module sources
  (comments stripped) for delete-shaped calls
  (`commentThreads.delete`, `.delete(`, `method: "DELETE"`) and fails the
  suite if any appear. Verified clean 2026-09-28.
- **Reason:** The pinned contract ("comments are NEVER auto-deleted") must
  survive future edits; a test is stronger than a comment.
- **Reverse:** None — deletion stays out of scope permanently.
### D145. Experiment stats engine is hand-rolled pure TypeScript (no new deps)

- **Decision:** `src/lib/experiments/stats.ts` implements the two-proportion
  z-test (pooled SE, two-tailed) and Welch's t-test from scratch: erf via
  Abramowitz–Stegun 7.1.26, t-CDF via the regularized incomplete beta
  (Numerical Recipes continued fraction), Lanczos log-gamma. No scipy/native
  dependency.
- **Reason:** The pinned stats discipline (p < 0.05, z-test for CTR, t-test for
  continuous) must be deterministic, dependency-free, and unit-testable in the
  worker/edge-safe bundle. Test fixtures carry p-values computed independently
  with scipy 1.11.4 (see test header) — the engine must match them to 1e-6.
- **Reverse:** Swap in a stats library later only if it reproduces the same
  fixtures; the fixtures are the contract, not the implementation.

### D146. Arm metrics jsonb shape: `{impressions,clicks}` for CTR, `{n,mean,variance}` for continuous

- **Decision:** `experiment_arms.metrics` carries, per `primary_metric`:
  CTR → `{ impressions, clicks }`; views/avg_view_duration_s/
  watch_time_minutes → `{ n, mean, variance }` (also accepts `{ std }` in
  place of `variance`). The min-sample gate counts `impressions` for CTR and
  `n` for continuous metrics against `experiments.min_sample_size`
  (default 100, CHECK ≥ 100 — never lower without a D-decision).
- **Reason:** The z-test needs raw counts; Welch's t-test needs mean/variance/
  n. One jsonb column with a documented per-metric shape keeps the migration
  minimal and the arm rows comparable.
- **Reverse:** Add per-observation rows later if real impression-level data
  arrives; the aggregate shape stays the read contract.

### D147. Conclusion rules: same gates for human and auto, pause = back to draft

- **Decision:** `concludeExperiment` (human) and the auto-conclude check run
  the SAME `evaluateConclusion`: min sample on every arm AND 24h wall-clock
  since `started_at` AND p < 0.05 before a winner may be named. A conclusion
  with no significant winner is recorded as `verdict: "inconclusive"`
  (`winner_arm_id: null`) — that is an honest conclusion, not a failure.
  `pauseExperiment` returns status to `draft` (data collection stops); the 24h
  gate stays wall-clock from first `started_at` (conservative: pausing cannot
  rewind the novelty-effect clock). Auto-conclude fires only from `running`,
  writes `decided_by: "auto"`, and NEVER applies the winner.
- **Reason:** "No conclusion before min sample AND 24h" applies to humans too —
  otherwise the UI would let a founder peek at p=0.04 on 30 impressions and
  declare victory. Pause-as-draft avoids a new column while keeping the state
  machine inside the pinned `draft|running|completed|archived` vocab.
- **Reverse:** Track accumulated run-seconds across pauses if pause/resume
  becomes frequent; the gate semantics stay the same.

### D148. "Apply winner" is a separate human-only action, audit-logged best-effort

- **Decision:** `applyWinner` requires a completed experiment whose conclusion
  is `verdict: "winner"`. It sets `seo_metadata.selected_title` (winning
  title variant) and/or `thumbnails.selected` (winning thumbnail, siblings
  deselected), marks the winning `title_variants` row `status: "winner"`, and
  writes `audit_logs` (`action: "experiment.winner_applied"`). The audit row
  needs a workspace (`workspace_id` NOT NULL); the workspace is resolved
  best-effort (owned → member). If the user has no workspace, the apply still
  succeeds but returns `auditLogged: false` and logs loudly — the UI must
  surface that.
- **Reason:** The pinned contract demands the apply be human and audit-logged;
  failing the whole apply when no workspace exists would punish users for a
  schema constraint. Loud logging + a visible flag keeps it honest.
- **Reverse:** Make audit mandatory if workspaces become universal.

### D149. Learning evidence gate enforced in code, not just documented

- **Decision:** `promoteLearning` (proposed → validated) throws unless
  `evidence` is non-empty AND `confidence` is a number in (0, 1]. Auto-drafted
  experiment learnings get `evidence: { type: "experiment_outcome",
  refs: [experimentId], metrics: {...}, sample }` and
  `confidence = 1 − p` (winner) or `0.5` (inconclusive), always `status:
  "proposed"`, `source: "system"`.
- **Reason:** The pinned "learning without evidence stays proposed" rule is
  only real if the promote path rejects gateless promotions. Confidence 0 is
  rejected — zero confidence is not evidence.
- **Reverse:** None.

### D150. Pattern mining drafts `kind: "pattern"` learnings, status proposed, source `ai_analysis`

- **Decision:** `minePatterns` aggregates VALIDATED learnings only, groups by
  `topic`, and drafts one `kind: "pattern"` learning per topic with
  `status: "proposed"`, `source: "ai_analysis"`, evidence refs = the cited
  learning ids, confidence = min cited confidence. The learnings UI renders
  every `ai_analysis` row with an "AI analysis" badge and a citation list.
- **Reason:** "Only validated learnings may feed brief advice" + "ALWAYS
  labeled AI analysis, always cites the underlying learnings". Proposed status
  keeps a human in the loop before pattern advice is treated as validated.
- **Reverse:** None — labeling is a contract requirement.

### D151. Comment-signal learnings are read-only over Stream D's `engagement_insights`

- **Decision:** `draftFromCommentSignals` only SELECTs `engagement_insights`
  (Stream D owns all writes). Insights from the last 30 days are grouped by
  `kind`; a kind with ≥ 3 insights drafts one `kind: "comment_signal"`
  learning (`status: "proposed"`, `source: "system"`,
  `evidence: { type: "comment_signal", refs: [insightIds], sample: n }`).
  Re-running skips kinds already drafted in the last 30 days (payload marker).
- **Reason:** Respects the read-only contract with Stream D while turning
  recurring audience signals into evidence-gated learnings. The ≥3 threshold
  keeps one-off comments from becoming "learnings".
- **Reverse:** Lower/raise the threshold with a D-decision if it misfires.

### D152. New columns are minimal: two gates on experiments, two labels on learnings

- **Decision:** Migration `2026092804c000_p4_experiments.sql` adds ONLY:
  `experiments.min_sample_size` (default 100, CHECK ≥ 100),
  `experiments.min_duration_hours` (default 24, CHECK ≥ 1),
  `learning_insights.topic` (default `"general"`),
  `learning_insights.source` (`human|ai_analysis|system`, default `human`),
  plus indexes. RLS policies already exist on both tables; the migration only
  re-asserts them. Everything else (conclusion shape, evidence shape) lives in
  the existing jsonb columns per the pinned contracts.
- **Reason:** The Phase 1 schema already carries experiments/experiment_arms/
  learning_insights/engagement_insights. "Only add what's genuinely missing":
  the per-experiment gate config and the AI-analysis label have no home today.
- **Reverse:** None.

### D153. Experiment/learn metric writes go through `recordArmMetrics`, never direct SQL from UI

- **Decision:** The only write path for arm metrics is the `recordArmMetrics`
  server function (jsonb merge + validation + auto-conclude check). UI never
  constructs metric rows. Every record triggers the auto-conclude evaluation
  so conclusions land without a cron.
- **Reason:** Single choke point keeps the stats discipline and the
  never-auto-apply rule enforceable; no background worker needed in v1.
- **Reverse:** Move to a cron/queue consumer if metric ingestion becomes
  high-volume; the evaluation function stays pure and reusable.
### D154. API keys store SHA-256 hashes only; raw key shown once

- **Decision:** `api_keys` stores the SHA-256 hash of the raw key — the raw
  value is returned once at create/rotate and never persisted, logged, or
  re-displayed. Authentication hashes the presented bearer and compares with
  a constant-time digest check after an indexed hash lookup (D154).
- **Reason:** A database or backup leak must not yield usable credentials;
  one-time display matches the industry pattern (Stripe, GitHub).
- **Reverse:** None — rotating is the recovery path for a lost key.

### D155. In-memory sliding-window rate limiter for API keys (single instance)

- **Decision:** Per-key 60/min (configurable) rate limiting uses an
  in-memory sliding-window limiter in the server process; limits are also
  exposed via `Retry-After` on 429 responses.
- **Reason:** No new infrastructure for the single-server deployment; the
  limiter is already abstracted behind a small interface.
- **Reverse:** Multi-instance deployment MUST move to a shared store
  (Redis/Upstash or the Postgres `check_rate_limit` RPC). Until then, each
  instance enforces its own window — document, don't silently widen.

### D156. MCP mutation tools hardcode `draft`; schemas expose no status override

- **Decision:** `vidora.draft_script` and `vidora.request_publish` hardcode
  `status: "draft"` at the tool layer, their Zod/JSON schemas expose no
  status field (unknown keys are stripped), and the dispatcher runtime-asserts
  the invariant — a port that returns non-draft fails the tool loudly.
- **Reason:** The pinned contract ("can never publish") must hold even
  against a hostile or buggy tool caller; defense in depth across schema,
  dispatch, and port layers.
- **Reverse:** None — publishing stays a human-gated pipeline outside MCP.

### D157. API/MCP audit writes are best-effort and never break the call

- **Decision:** Every authenticated API and MCP tool call writes an
  `audit_logs` row, but a failing audit insert is caught, logged, and never
  fails the authenticated operation (the audit hook throwing is covered by
  test).
- **Reason:** Availability of the API outranks completeness of the audit
  trail; a down audit path must not become a self-inflicted outage.
- **Reverse:** If compliance ever requires guaranteed audit, switch to
  fail-closed explicitly — do not silently change this default.

### D158. Brand Library uses a dedicated workspace-scoped `brand_assets` table

- **Decision:** Brand assets (logos, fonts, intro/outro clips) live in the
  new workspace-scoped `brand_assets` table + private `brand-library` bucket,
  NOT in `content_assets`. `content_assets` is user-scoped and requires a
  `content_item_id` (research pipeline); brand assets are workspace-shared
  brand identity independent of any content item. An optional
  `content_asset_id` links back only when the asset genuinely originated as
  a content row (rights tracking stays there). At most one `is_default` per
  (workspace, kind) via a partial unique index.
- **Reason:** Reusing `content_assets` would require manufacturing fake
  content items per workspace — a worse integrity lie than a parallel table
  with the same storage conventions.
- **Reverse:** If brand assets ever need per-user rights tracking, promote
  via `content_asset_id` linkage rather than duplicating rows.

### D159. Workspace invites are hashed bearer tokens with explicit acceptance

- **Decision:** Invite tokens (`vdinv_` + 32 chars) are shown/emailed once;
  only the SHA-256 hash is stored. Acceptance is an explicit signed-in action
  on `/invite/accept`: the token must be live (unexpired, unrevoked,
  unaccepted) AND the account's email must match the invited email. Members
  read invites; owners/editors create/revoke. Email is best-effort via the
  existing Resend REST pattern; when unconfigured, the inviter copies the
  link manually.
- **Reason:** Email-only verification is spoofable; binding the token to the
  invited address keeps forwarding the link useless without the right
  account. One live invite per (workspace, email) prevents invite spam.
- **Reverse:** None planned; magic-link sign-in for invitees would be a
  separate auth-stream decision.

### D160. MCP transport is JSON-RPC 2.0 over HTTP POST

- **Decision:** The MCP server is exposed as JSON-RPC 2.0 at `POST /api/mcp`
  (`tools/list`, `tools/call`), with a `GET /api/mcp` authenticated
  discovery manifest — no SSE or stdio transport.
- **Reason:** Fits the serverless TanStack Start deployment (plain request/
  response, no long-lived connections); JSON-RPC error codes map cleanly
  onto the auth/validation failures the tools already produce.
- **Reverse:** Add SSE/streaming later only if a client requires it; the
  tool dispatcher is transport-agnostic by design.

### D161. Brand Library uses a dedicated workspace-scoped `brand_assets` table (coordinator sign-off)

- **Decision:** F39 ships `brand_assets` (workspace_id, kind, is_default, nullable
  `content_asset_id` provenance link) rather than forcing brand assets into
  `content_assets`. Approved at Phase 4 integration.
- **Reason:** `content_assets` requires a `content_item_id` and is item-scoped;
  brand assets are workspace-scoped with a "one default per kind" rule — a
  genuinely different access pattern. The nullable `content_asset_id` preserves
  honest provenance (set only when the asset genuinely originated as a content
  asset) instead of manufacturing fake linkage. Rights tracking stays in
  `content_assets` via D49.
- **Reverse:** Merge into `content_assets` later only if the item-scoping
  constraint is lifted; migrate rows with their provenance links intact.

### D162. Every publish job gets a unique DB-backed idempotency key

- **Decision:** `publish_jobs.idempotency_key` (unique, default `job_<uuid>`,
  backfilled) — `createPublishJob` returns the existing owned job on key retry.
- **Reason:** Upload retries and double-clicks must never create duplicate
  publish jobs or double uploads.
- **Reverse:** None — idempotency is load-bearing for the publish pipeline.

### D163. Retry only transient platform failures

- **Decision:** `withTransientRetry` retries only 429/5xx/network errors with
  backoff + jitter; never 4xx, auth failures, or approval rejections. Wired
  into YouTube scheduling, remote metadata read/update, and health probes.
- **Reason:** Blind retries of auth/approval failures burn quota and can
  trigger platform rate-limit escalation.
- **Reverse:** None.

### D164. Drag/drop on the calendar changes only `scheduled_for`

- **Decision:** Calendar drag-drop reschedules `approved`/`scheduled` jobs to
  future times only; null unschedules back to `approved`. Scheduling never
  executes publishing.
- **Reason:** The calendar is a planning surface; execution stays behind the
  approval + test-account gates.
- **Reverse:** None.

### D165. Rejection is terminal cancellation with an immutable reason

- **Decision:** Rejecting a publish job in Review Studio requires a reason,
  cancels terminally, and writes an immutable `publish.rejected` audit row.
  Client sign-off is displayed separately and never substitutes server approval.
- **Reason:** "AI prepares. Human approves." — a rejected job must not be
  silently revivable into the publish path.
- **Reverse:** None.

### D166. Live metadata overwrites need diff + confirm bound to a fresh remote snapshot

- **Decision:** Before overwriting live YouTube metadata, fetch the current
  remote title/description, show the diff, and require explicit human confirm
  bound to a SHA-256 hash of that fresh snapshot (TOCTOU protection). Also
  gated on an approved publish job whose `youtube_video_id` matches the target.
  Writes `publish.metadata_overwritten` audit.
- **Reason:** Never silently overwrite live metadata — the founder's live
  channel metadata is one misclick away from damage otherwise.
## Phase 4 — Stream B (Analytics), 2026-09-28

### D167. `source` is REQUIRED on analytics/retention snapshots, defaulting to 'fixture'

- **Decision:** `analytics_snapshots.source` and `retention_snapshots.source`
  are `NOT NULL DEFAULT 'fixture'` with
  `CHECK (source IN ('youtube_analytics','meta_insights','fixture'))`.
  Ingestion paths write the real source explicitly; anything else renders
  with a DEMO DATA badge in the UI.
- **Reason:** The pinned contracts require a source label on every snapshot.
  Defaulting to `fixture` makes the honest label the path of least
  resistance — an unlabelled row can never masquerade as platform-measured.
- **Reverse:** If a new platform source is added, extend the CHECK in a new
  migration; never loosen the default.

### D168. Dashboard deltas compare against the prior 28d, honestly

- **Decision:** `pickDeltaPair` takes the latest snapshot and the latest
  snapshot dated ≥28 days earlier, labeled "vs prior 28d". With no such
  prior snapshot the UI shows "insufficient history" and no delta number.
- **Reason:** A delta without a real baseline is a fabricated comparison.
- **Reverse:** Window stays 28d unless a D-decision changes it.

### D169. Content buckets derive from project metadata, never invented labels

- **Decision:** Bucket key = `<projects.category> · <projects.preset>`
  (pillar × format); missing metadata → "Uncategorized · standard".
  Single-video buckets render with a `thinData` flag ("anecdote, not a trend").
- **Reason:** Buckets must be explainable from data the user already owns.
- **Reverse:** Add more dimensions (e.g. visual_style) via a new decision.

### D170. Weakest-scene diagnosis from real points only

- **Decision:** Hook baseline = mean of the first 3 retention points;
  weakest scene = scene owning the point with the largest drop below that
  baseline. Requires ≥4 points, never interpolates, counts unattributed
  (scene-less) points separately. Diagnosis text is positional
  (early/mid/late) and descriptive, never a guaranteed fix.
- **Reason:** D73 honesty rules — no invented points.
- **Reverse:** None.

### D171. Channel audit findings are descriptive or AI-labeled, always evidenced

- **Decision:** Five rules (upload cadence, CTR trend, retention vs the
  documented 35% niche reference, metadata completeness, subscriber growth
  stall over `channel_snapshots`). Every finding cites evidence rows
  (snapshot ids/dates/values); guidance is `descriptive` or prefixed
  "AI analysis — not a guaranteed fix".
- **Reason:** An audit that can't show its work is a black box; one that
  promises fixes is dishonest.
- **Reverse:** Add rules freely; removing evidence citation needs a decision.

### D172. Revenue is ESTIMATE unless provably measured

- **Decision:** `revenueLabel()` returns `measured` only when
  `revenue_basis='measured'` AND `source != 'fixture'`; fixture rows are
  always demoted to `estimate`. RPM/CPM-derived revenue is always ESTIMATE;
  `summarizeMonetization` returns `null` (not $0) when no RPM is set. The UI
  carries a no-earnings-guarantees notice.
- **Reason:** Contracts default `revenue_basis` to `estimate`; the UI must
  make that impossible to misread.
- **Reverse:** None.

### D173. ROI costs are net ledger credits; unattributed spend stays visible

- **Decision:** Cost per video = net `credit_ledger` deltas (debits negative,
  refunds positive) attributed via
  `ref_id → renders.id | renders.job_id (video_jobs) | projects.id (legacy)`
  → `renders.project_id` → `publish_jobs` → video. Unattributable rows are
  reported as "unattributed production cost", counted in totals, never
  silently dropped. USD equivalents shown at every plan's effective
  per-credit rate (`src/lib/billing/plans.ts`).
- **Reason:** Real costs, honest gaps; per-plan transparency for the
  founder's pricing decisions.
- **Reverse:** None.

### D174. video_ideas.score is jsonb, not numeric (migration bug fixed pre-apply)

- **Decision:** `20260928020400_p1_extensions.sql` added `video_ideas.score numeric`;
  the Phase 3 idea engine (`src/lib/creation/ideas/ideas.functions.ts`)
  writes a JSON cache payload `{ computed_at, score: IdeaScore }` via
  `buildScoreCachePayload` and reads it back as an object (line 49 type:
  `score: { computed_at?: string; score?: IdeaScore } | null`). A numeric
  column would break scoreIdeaFn's cache write. The migration was corrected
  to `ADD COLUMN IF NOT EXISTS score jsonb` BEFORE it was applied to the live
  database (file 5 not yet applied as of this decision); the live DB and repo
  file now agree. The Phase 3 migration `20260928041000_p3_stream_a.sql` also
  declares `score jsonb` — its ADD COLUMN IF NOT EXISTS is a harmless no-op.
  No code reads `video_ideas.score` as a number (verified via grep).
- **Reason:** Code is the contract; the migration file was wrong. Caught before
  live apply, so no data migration needed.
- **Reverse:** None — jsonb is the only type the code supports.

### D175. pg_cron schedule deferred — SQL editor role cannot manage cron.job (2026-09-28)

- **Decision:** File 6 (`20260928020500_p1_vector_cron.sql`) was split on apply:
  the pgvector half (extension + 3 embedding columns + 3 ivfflat indexes) was
  applied via the SQL editor; the pg_cron half (extension + `requeue-stale-renders`
  schedule) was NOT applied because the editor role gets `permission denied for
  table cron.job` on `DELETE FROM cron.job` (the whole script runs as one
  transaction and rolled back). The migration file itself anticipated this
  (caveat a): pg_cron must be enabled via Lovable dashboard → Database →
  Extensions, an owner-only step. Until the owner enables it,
  `requeue_stale_renders()` stays server/worker-invoked exactly as today —
  no behavior change, no data touched.
- **Owner action needed:** enable the pg_cron extension in the Lovable Cloud
  dashboard (Database → Extensions), then run the schedule block:
  `DELETE FROM cron.job WHERE jobname='requeue-stale-renders';`
  `SELECT cron.schedule('requeue-stale-renders','*/5 * * * *',
    $$SELECT public.requeue_stale_renders()$$);`
  Verify with `SELECT jobname, schedule FROM cron.job;`
- **Reason:** Safest reversible alternative per autopilot rules — the vector
  half is independent and safe; the cron half needs a dashboard permission
  only the owner has.
- **Reverse:** Once pg_cron is enabled, apply the schedule block above.

### D176. Live characters table predates migration shape — hardened p3_stream_c (2026-09-28)

- **Found:** live `public.characters` has columns
  id/user_id/name/description/style/reference_image_url/created_at only —
  NO `updated_at`, NO `style_notes` (it has a legacy `style` text column),
  no CHECK/FK constraints, and existing policies "No guest sessions" +
  "Users manage own characters". The repo migration's
  `CREATE INDEX characters_user_idx ON (user_id, updated_at DESC)` failed
  with 42703 and the whole file rolled back (nothing applied).
- **Decision:** hardened `20260928041200_p3_stream_c.sql` to cover this shape:
  `ADD COLUMN IF NOT EXISTS updated_at`, `ADD COLUMN IF NOT EXISTS
  style_notes`, plus a guarded backfill preserving legacy `style` text into
  `style_notes` as `{legacy_style: ...}` where style_notes is still empty.
  All changes additive; existing policies and the legacy `style` column are
  left in place. The live recovery block applies exactly this hardened file.
- **Reason:** safest reversible alternative — additive-only, no data dropped,
  preserves the legacy style text instead of orphaning it.
- **Reverse:** drop the added columns/index/trigger if needed; the legacy
  `style` column remains untouched.

### D177. client_errors anon insert kept; DB payload caps added (2026-09-28)

- **Found:** Lovable's pre-publish security scan flags `client_errors` because
  its INSERT policy is `WITH CHECK (true)` for anon+authenticated. The policy
  is intentional: anonymous crash telemetry must work for signed-out visitors
  hitting the root error boundary, and the table is insert-only (no SELECT
  policy — only the service role can read rows; no PII stored).
- **Decision:** keep the anonymous insert path; add DB-enforced payload caps
  (`client_errors_payload_caps_check`: message ≤ 2000, stack ≤ 8000,
  route ≤ 500, user_agent ≤ 1000) via
  `2026092804f000_client_errors_hardening.sql` (added NOT VALID, then
  validated). Caps sit slightly above the client-side truncation in
  `src/routes/__root.tsx` (message ≤1000, stack ≤4000, route ≤200,
  user_agent ≤300) so legitimate reports can never be rejected by drift.
  The caps remove the blob-store abuse vector without breaking telemetry.
- **Reverse:** drop the constraint; the anon INSERT policy remains the
  documented intentional surface.

### D182. F42 extension token model: separate minimal-scope keys, publish:request excluded (2026-09-28)

- **Found:** the extension (DOCS ONLY — no code) is a client of the
  existing MCP surface (`/api/mcp`, D160). The pinned scope vocab
  (`API_KEY_SCOPES`) already gates every tool per-call on the server.
- **Decision:** the extension gets its own dedicated `vdsk_` key per
  install/user with one of two profiles: Status
  (`read:projects` + `read:analytics`, default) or Status + Drafts
  (adds `write:projects`, explicit opt-in at key creation).
  `publish:request` is deliberately excluded — the extension cannot touch
  the publish pipeline at all — and `admin:keys` is never granted to
  extension keys. Key stored in `chrome.storage.local` only, never in page
  JS or the web app's client JS. Server-side scope re-checks (existing)
  make a tampered client unable to escalate (403). Stolen key → revoke or
  rotate via the existing key routes; blast radius is scope-limited by
  design. Documented in `docs/CHROME_EXTENSION.md`.
- **Reason:** minimal scopes + existing server gates give the companion
  UX (status reads, draft prep) with zero new server attack surface and no
  path past the human-approval gates.
- **Reverse:** revoke/rotate the key; no server changes exist to revert.

### D183. Phase 5 merge: D178 claimed by all three streams — renumbered (2026-09-28)

- **Found:** the contract said "new D-numbers continue from D178" to all
  three streams; Stream B used D178 (rate-limit headers) + D180
  (credit-gating audit) in code comments, Stream C used D178 (extension
  token model) in DECISIONS.md, Stream A used D178 in a commit message only.
- **Decision:** Stream B keeps D178/D180 (most in-code references);
  Stream C's entry renumbered to D182; Stream A's commit-message label left
  as-is (history is not rewritten). Future phases: the coordinator assigns
  D-number ranges per stream up front.

### D184. F10 Vidora Agent: draft-only, preflight-per-turn, tool results asserted (2026-09-28)

- **Decision:** the agent loop (`src/lib/agent/agent.server.ts`) runs a
  credit preflight before EVERY LLM turn (jobType `llm_chat`, debit-first
  per turn, mirroring `generateScriptDraft`); calls the 8 pinned MCP tools
  through the Supabase MCP port (no duplicated tool logic); asserts every
  `draft_script`/`request_publish` result has `status === "draft"` and ends
  the turn with `invariant_violated` otherwise; max 6 tool iterations;
  every tool call audit-logged (`agent.tool_call`); assistant messages
  persisted with provenance `ai_analysis`. The agent cannot approve,
  publish, schedule, or spend beyond the existing gates — human approvals
  stay in the publish pipeline.
- **Reverse:** disable the `/agent` route; the agent tables are additive.

### D200. E2E runs against the production build with deterministic adapters (2026-09-28)

- **Decision:** `npm run test:e2e` = `npm run build:e2e && playwright test`, where
  `build:e2e` builds the production bundle (`NITRO_PRESET=node-server`,
  `VITE_SUPABASE_URL=http://127.0.0.1:54321`) and the Playwright webServer
  (`e2e/serve.mjs`) boots (1) a deterministic in-memory Supabase stub
  (`e2e/stub-supabase/server.mjs`: GoTrue auth, PostgREST-ish CRUD, credit
  RPCs with the same idempotency/debit/refund semantics as the SQL
  migrations) on 127.0.0.1:54321 and (2) `.output/server/index.mjs` on
  127.0.0.1:3100 with `VIDORA_E2E_ADAPTER=deterministic`. Script generation
  takes a deterministic-adapter branch (canned topic-derived sections, zero
  provider cost) while the real credit preflight, debit-first charge, and
  version-save path run unchanged. This VM's Chromium hard-blocks direct
  loopback navigation (`ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`, no
  working disable switch), so every spec page routes loopback requests
  through a Playwright fulfillment bridge (`bridgeLocalhost`): the REAL
  server responses are fetched by Node and fulfilled to the browser — app
  code, server functions, and stub are all real; only the last-mile
  transport is bridged. Adapter-dependent tests are labeled `[adapter]`.
- **Reason:** no Supabase credentials, Docker, or provider keys exist in this
  environment; the deterministic stub + adapters let the full critical-path
  suite (signup, projects, script debit, approvals, stale-job refund, all
  nav targets) run honestly against the production build with real
  `credit_ledger` assertions.
- **Reverse:** `test:e2e`/`playwright.config.ts` revert to `npm run dev`;
  delete `e2e/serve.mjs`, `e2e/stub-supabase/`, `e2e/fixtures.ts`,
  `e2e/adapter-helpers.ts`, `e2e/workflows.spec.ts` and the
  `VIDORA_E2E_ADAPTER` branch in `scripts.functions.ts`.

### D201. E2E stub fidelity + mobile project + stale-copy assertion updates (2026-09-28)

- **Decision:** four follow-ups to D200's harness.
  1. **Stub mirrors Postgres column defaults.** The Supabase stub now
     applies migration column defaults server-side on INSERT
     (`scripts.status: "draft"`, `projects.*`, `render_jobs.*`,
     `script_versions.*`, `created_at`/`updated_at`) because raw
     PostgREST inserts rely on the database; without this the app crashed
     reading `scripts.status.label` after script creation.
  2. **Stub seeds deterministic `pricing_plans`.** Starter $19 / Studio $49
     / Scale $149 (+ INR anchors 1599/3999/11999) mirrored from the
     migration seed INSERTs, installed on every reset — the pricing page
     reads them via `getPricingPlans`, so plan-card tests assert real
     values instead of an empty page.
  3. **Mobile project uses viewport emulation, not `devices["iPhone 13"]`.**
     That descriptor carries `defaultBrowserType: "webkit"` and crashes this
     VM's Chromium on launch (`Target page, context or browser has been
     closed`); the mobile project now sets `viewport 375×667` +
     `isMobile` + `hasTouch` on Chromium directly, and the desktop
     `chromium` project ignores `mobile.spec.ts` (it previously ran every
     spec file, double-running the mobile tests and failing the 375px
     hero-width assertion at desktop width).
  4. **Stale marketing-copy assertions updated to the cinema redesign.**
     `public`/`stranger`/`mobile` specs expected the pre-redesign hero
     ("AI video studio"), the old checkout note ("checkout is not live"),
     and a modal dialog at `/studio?create=script`; the current site says
     "Script in.", "Checkout is being set up", and renders the create UI
     as a page (`asPage`, no `role="dialog"`). Tests now assert the real
     copy/behavior. No app copy changed — the redesign is user-approved.
- **Reason:** keep the E2E suite honest against the production build: the
  stub must behave like Postgres (defaults, seed data), the mobile
  project must actually launch, and assertions must match the shipped UI
  rather than a previous design.
- **Reverse:** remove `COLUMN_DEFAULTS`/`seedStatic` from
  `e2e/stub-supabase/server.mjs` (falls back to empty tables); restore the
  iPhone 13 device descriptor in `playwright.config.ts` once WebKit or a
  fixed Chromium is available; revert spec copy changes if the marketing
  site is redesigned again.

### D220. Onboarding: connect and scan steps are skippable (2026-09-28)

- **Context:** the /onboarding wizard (Phase 6 Stream B) has nine steps:
  welcome → connect → creator-type → niche → goal → brand → scan → idea →
  video. Forcing every step would trap users who lack a YouTube channel or
  don't want to spend credits yet.
- **Decision:** `connect` and `scan` are skippable; every other step requires
  an answer. YouTube can be connected later from the studio (the OAuth flow
  itself is unchanged), and the niche scan costs a real research credit —
  skipping is the honest option, never a dark pattern. `isSkippable()` in
  `src/lib/onboarding/onboarding.ts` is the single source of truth.
- **Reverse:** remove either step from `isSkippable()`; nothing else depends
  on the skippable set.

### D221. Onboarding: resume semantics and auto-skip to /studio (2026-09-28)

- **Decision:** `/onboarding` never shows the wizard to a user who shouldn't
  see it. `resolveOnboardingEntry()` redirects to `/studio` when there is no
  progress row (never started, e.g. a fresh signup who landed here by
  mistake) or when the row is `completed`. An in-progress row resumes at the
  persisted `current_step`; a row with an unrecognized step restarts
  defensively at `welcome`. `current_step` records where the user IS — the
  advance mutation persists the *next* step before rendering it — so a tab
  close or OAuth round-trip loses nothing.
- **Reverse:** change `resolveOnboardingEntry()`; the DB rows remain valid.

### D222. Onboarding: scan results persist immediately because the scan spends a credit (2026-09-28)

- **Decision:** the niche-scan step (`createResearchProject`) debits a real
  research credit via the existing rate-limit/debit path. On success the
  wizard calls `onPersist()` immediately — before the user advances — so the
  sub-niches and `research_project_id` are in `onboarding_progress.answers`
  even if the tab closes. Re-running the scan on resume is never required.
  Results are labelled "AI analysis" with an explicit no-guarantees note
  (`ob_scan_credit_note`).
- **Reverse:** drop the `onPersist` call in the scan step; the credit debit
  still stands on its own.

### D223. Onboarding route is reachable but not in the main nav (2026-09-28)

- **Decision:** `/onboarding` is deliberately NOT in the app nav (excluded
  from `src/components/vidora/appNav.ts`; the appNav reachability test does
  not cover it). Entry points are (1) post-signup redirect in `auth.tsx`
  (explicit `?next=` still wins) and (2) a "New here? Take the guided setup"
  link in the studio empty state only. The route sets `noindex` so it is
  never indexed.
- **Reverse:** add it to the nav groups; entry-point links are independent.
### D240. E2E_30_SECOND_CREATION runs on deterministic test-fixture adapters (2026-09-28)

- **Decision:** the 30-second creation scenario test
  (`src/lib/creation/quick-create/e2e-30-second-deterministic.test.ts`,
  topic "Why do airplane windows have a tiny hole?") runs the REAL stage
  logic (research linker, script builder, scene planner, caption timeline,
  QC gate, SEO package, scene manifest schema) against in-test
  deterministic adapters for the paid/heavy steps (TTS, image, music,
  storage, publish gate, credit ledger). Every fixture output is labeled
  `provider: "deterministic-test-adapter"`; timing is `estimate`, never
  presented as measured; the assembly step produces a RECORD, never a
  playable video. Research sources are real URLs verified 2026-09-28.
- **Reverse:** delete the one test file; no production code depends on it.

### D241. /admin/readiness: fail-closed tri-state banner, admin-only (2026-09-28)

- **Decision:** the new `/admin/readiness` route
  (`src/routes/_authenticated/admin.readiness.tsx` + pure logic in
  `src/lib/readiness.ts` + probes in `src/lib/readiness.functions.ts`)
  renders inside the existing `AdminLayout` shell (reused guard: inline
  403 for non-admins) and the server function additionally enforces
  `assertAdmin`. Check statuses are tri-state PASS / FAIL / UNCONFIGURED;
  UNCONFIGURED means "probe could not run" (never "fine") and always
  carries an exact remediation naming the missing key/secret/deploy and
  where to set it. `computeReadinessBanner` is fail-closed: the banner
  reports READY only when every BLOCKING check passes — it can never show
  READY while a blocking check fails or is unconfigured. Blocking checks:
  AI text, TTS, image gen, storage, database, FFmpeg/render service, job
  queue, billing. Non-blocking: video gen (Complete Video Mode), YouTube
  OAuth (per-user channel connection is the real gate). Public `/status`
  untouched.
- **Reverse:** remove the route file, nav entry, and the two lib files.

### D242. Paid probes never auto-run — deliberate two-step opt-in (2026-09-28)

- **Decision:** the two paid probes (one tiny ElevenLabs TTS synthesis,
  one test image via the Lovable AI gateway) run ONLY when an admin
  deliberately checks the opt-in box AND presses "Run checks with paid
  probes"; the default run is free metadata/config probes only. The paid
  button is disabled until the checkbox is ticked, and a paid-probe run is
  labeled `PAID PROBE` with an estimated cost note on the check card and in
  the banner timestamp line.
- **Reverse:** set `includePaidProbes` default differently — the flag is a
  single zod default on the server function input.

### D243. routeTree.gen.ts regenerated with the official TanStack Generator (2026-09-28)

- **Decision:** `src/routeTree.gen.ts` was regenerated with the bundled
  `@tanstack/router-generator` `Generator` class (same defaults the vite
  plugin uses: `./src/routes`, single quotes, no semicolons) instead of
  hand-editing; the diff is purely additive. The generator does not emit
  the TanStack Start `Register` module-augmentation block, so it was
  re-appended verbatim (single-quote style) after regeneration.
- **Reverse:** regenerate again after any route change with the same
  command; never hand-edit the file.

### D244. Readiness probes are free-metadata only; paid-provider failure is FAIL, not UNCONFIGURED (2026-09-28)

- **Decision:** probes distinguish missing config (UNCONFIGURED — the key
  isn't set, so the probe cannot run) from a configured-but-broken
  dependency (FAIL — e.g. an invalid ElevenLabs key returning HTTP 401, a
  stale render-worker heartbeat, an unreachable Supabase bucket). The TTS
  check treats an absent ElevenLabs key + present `OPENAI_API_KEY` as a
  PASS-with-note (fallback path documented), not a false green. No probe
  ever presents config presence as a health guarantee without a free
  metadata call when one exists (ElevenLabs /v2/user, gateway /v1/models,
  bucket list, profile count).
- **Reverse:** adjust per-check `blocking` flags or remediation copy in
  `src/lib/readiness.functions.ts`.
### D270. Phase 6 Stream D: docker-compose.yml reworked, service renamed to `worker` (2026-09-28)

- **Decision:** the pre-existing compose service was named `render-worker`; renamed the service key to `worker` (container_name `vidora-render-worker` unchanged, so `scripts/deploy-worker.sh`'s `docker inspect` still works). Added per-variable comments documenting every worker env var and a docs pointer to `worker/.env.example`. Kept the pre-existing `deploy.resources.limits` but added an explicit NOTE that plain `docker compose up` (non-swarm) does not enforce them — the VPS itself must be sized (~4 vCPU / 8 GB for defaults).
- **Reason:** the old file had zero per-variable documentation; a founder deploying this must know what each variable does and which are secrets without reading worker source.
- **Reverse:** rename the service key back; nothing else references the key.

### D271. Phase 6 Stream D: `worker/.env.example` is the authoritative worker env reference (2026-09-28)

- **Decision:** added `worker/.env.example` covering all 11 vars from `worker/src/config.ts` (checked 1:1 against ConfigSchema), each with what-it-is / where-to-get-it / secret-or-not. The repo-root `.env.example` keeps its full worker section (deploy script + compose `env_file` read root `.env`) with a pointer to `worker/.env.example`; added the two missing keys (`BRAND_LOGOS_BUCKET`, `WORKER_CHAPTER_CONCURRENCY`).
- **Reason:** the old root section was incomplete and undocumented; two env references must not drift — the pointer establishes which one is canonical.
- **Reverse:** delete `worker/.env.example`; root section remains self-sufficient.

### D272. Phase 6 Stream D: `docs/RENDER_WORKER_DEPLOY.md` — one-command deploy + /status verification (2026-09-28)

- **Decision:** new deploy guide with: one-time Oracle host setup, `WORKER_HOST=... ./scripts/deploy-worker.sh` as the single deploy command, a full secrets checklist (required/secret/where/what-breaks), DB pre-checks (worker_heartbeats table + the 5 RPCs + private buckets, all with their real migration filenames), heartbeat verification on https://vidoratube.lovable.app/status ("no heartbeat recorded yet" → "Operational", 15-min ok / 60-min degraded thresholds read from `src/lib/worker-health.ts`), and a rollback procedure (compose down; claim lease reclaims jobs automatically).
- **Reason:** the worker is still undeployed (founder blocker #1); the blocker is now actionable in one command with an observable success criterion instead of a vague "needs a deploy target".
- **Reverse:** docs-only; nothing to revert in code.

### D273. Phase 6 Stream D: FEATURE_MATRIX live-verification legend + ledger; COMPLETE ≠ live-verified (2026-09-28)

- **Decision:** added a live-verification legend (`live`/`fakes`/`unconfigured`/`untested`/`design`/`infra`) and a per-feature "Live-provider verification ledger" at the end of `docs/FEATURE_MATRIX.md`. Documented the standing rule explicitly: COMPLETE in this matrix means code-complete with unit/integration tests green — it does NOT mean verified against real providers. Honest bottom line recorded: as of 2026-09-28, zero features have been exercised against a live external provider; all provider tests use fakes/mocks with zero network calls; the live-verified surface is infrastructure only (migrations applied, RLS checked, bundle published).
- **Reason:** the matrix's U/I/E/M columns let a reader mistake "COMPLETE" for "proven live". The ledger is now the only place that answers "has it touched a real provider?"
- **Reverse:** docs-only.

### D274. Phase 6 Stream D: removed 4 stale jammed rows in FEATURE_MATRIX.md (2026-09-28)

- **Decision:** the Creation table had 4 lines where stale Wave-1 duplicate rows were jammed after `||` on the same line as the proper row (F15, F17, F19, F26 duplicates with outdated content, e.g. "migration unapplied"). Deleted only the duplicate suffixes; kept the proper rows. The F26 content existed only as a jammed suffix, so I restored it as a proper row with the migration recorded as applied live 2026-09-28.
- **Reason:** the jammed rows made the table unparseable and carried stale claims.
- **Reverse:** docs-only; git history retains the old lines.

### D275. Phase 6 Stream D: fixed stale migration filename in worker/README.md (2026-09-28)

- **Decision:** the README told the founder to apply `supabase/migrations/20260925143500_server_render_worker.sql` — that file does not exist in this tree; `claim_render_job`/`heartbeat_render_job` actually live in `20260925120000_schema_reconciliation.sql`. Replaced with the verified full dependency list (worker_heartbeats, claim/heartbeat RPCs, requeue_stale_renders, finalize_render_billing, requeue_stale_chapters + their real migration filenames).
- **Reason:** a founder following the old instruction would chase a missing file. Found by grep, not guessed.
- **Reverse:** docs-only.

### D276. Phase 6 Stream D: ElevenLabs `verified: true` voice IDs are code-claims, never live-checked (2026-09-28)

- **Decision:** recorded as KNOWN_ISSUES.md #13: the `language_voices` seed + `src/lib/voices.ts` mark catalog voice IDs `verified: true`, but no `ELEVENLABS_API_KEY` exists in this environment, so no ID has ever been checked against the ElevenLabs API in this program. A wrong/rotated ID fails as a provider 404 on the first real TTS call — after the credit debit. One unqualified TTS call per catalog voice is founder-gated before paid paths are trusted; the ledger marks F17 `unconfigured`.
- **Reason:** `verified: true` reads as "proven" and sits one step before real money; the honest state is "claimed in code, never tested".
- **Reverse:** docs-only; flip the flag only after a live check.

### D277. Phase 6 Stream D (continuation): fixed 3 accuracy gaps found on re-verification (2026-09-28)

- **Decision:** (1) `docker-compose.yml`'s per-variable comment called SUPABASE_URL "secret" — it is public by design; only the service-role key is the secret. Fixed to "*required* (not a secret — it's public)". (2) `worker/README.md` still said the compose file ships "one `render-worker` service" after the D270 rename to `worker`; fixed to "one `worker` service (container `vidora-render-worker`)". (3) Added `stub` (= placeholder UI / partial shell, not implemented) to the FEATURE_MATRIX.md live-verification legend — the F19 row already used it but it was undefined.
- **Reason:** a founder following the old wording would misclassify the URL as a secret or chase the old service key; the undefined legend code made F19's honesty label meaningless.
- **Reverse:** docs-only.

### D278. Phase 6 Stream D (continuation): historical test counts left as history; measured 87/87 (2026-09-28)

- **Decision:** the old `76/76` worker-test counts in `docs/TEST_RESULTS.md`, `docs/SPRINT_REPORTS.md`, `docs/PRODUCT_AUDIT.md`, and pre-Phase-6 `IMPLEMENTATION_STATUS.md` sections are past-run records — left untouched. `docs/RENDER_WORKER_DEPLOY.md` states `npm run test:worker` 87/87 because I ran it in this worktree and measured it (10 test files, 87 pass / 0 fail).
- **Reason:** rewriting past-run logs would falsify history; the deploy guide is a current runbook and must reflect a measured number.
- **Reverse:** docs-only.

### D279. Phase 6 Stream D (continuation): `docker compose config` unverified in this VM (2026-09-28)

- **Decision:** recorded as unverified, not claimed as validated: `docker` is not installed in this VM's PATH, so `docker compose config` could not be run. The compose file was hand-checked against the real consumer (`scripts/deploy-worker.sh` — same filenames, same `container_name` in its `docker inspect`, same `WORKER_HOST`/`REMOTE_DIR` defaults) and the YAML follows the pre-existing file's proven structure; the real parse check happens on the deploy host when `scripts/deploy-worker.sh` runs `docker compose up -d`.
- **Reason:** claiming a validation I never ran is exactly the dishonesty Stream D exists to remove. `IMPLEMENTATION_STATUS.md`'s Phase 6 section already marks this as the coordinator-visible gap.
- **Reverse:** docs-only; re-verify on any host with Docker before the first real deploy.
### D300. Watchtower: on-demand evaluation over existing tracked data, notification + draft idea (2026-09-28)

- **Decision:** Phase 6 Stream E applies the Algrow AG-5 alert pattern as
  Watchtower: alert rules evaluate the user's already-tracked channels,
  videos, and snapshots on demand (a "Check now" button; no background
  worker — Lovable's pg_cron is not provisioned per D175). Rule types:
  breakout_video, title_pattern, growth_condition. Firing rules dedup with
  stable keys (`alert:<ruleId>:<videoId|channelId>`) so re-checks never
  re-fire. Each newly delivered alert emits an `intel.alert` notification
  AND auto-creates a draft `video_ideas` row, so the signal lands in the
  ideation backlog instead of stopping at a ping. Empty states are honest
  (`no_rules`, `no_data`).
- **Reverse:** drop the `/intelligence/alerts` route and the `alert_rules`
  table; the evaluation library is additive.

### D301. Title format library: deterministic packaging aids, never predictions (2026-09-28)

- **Decision:** the TubeAI TI-3 pattern lands as a 12-format deterministic
  library (`src/lib/creation/titles/formats.ts`) with slot templates, lever
  labels, and usage notes. Deliberately no outperformance multipliers, no
  CTR/virality claims — a unit test asserts the library serialization
  contains none. Formats are starting points; the title generator fills
  slots in the creator's voice.
- **Reverse:** remove the format selector from Title Lab; formats are
  in-memory, nothing persisted.

### D302. Word vectors computed only from the user's own outlier corpus (2026-09-28)

- **Decision:** the TubeAI TI-6 pattern is reimplemented without a
  cross-platform word database: vectors are computed from the user's own
  tracked `outlier_videos` with sample floors (≥3 videos per word, ≥10
  videos before the panel renders) and median-outlier lift versus the
  corpus median. Pairing suggestions and all copy use non-predictive
  language; `insufficient_data` is an explicit state, never silence.
- **Reverse:** hide the vectors panel in Title Lab; no new tables.

### D303. Thumbnail surface previews are original generic mocks (2026-09-28)

- **Decision:** the TubeAI TI-9 5-surface preview lands as a "Surface
  preview" tab built from original generic mocks at explicit display
  widths, labeled as approximations — no YouTube UI recreated, no
  competitor videos embedded. Pure presentational component.
- **Reverse:** remove the tab; surface specs are data, easily replaced.

### D304. URL ingestion stores provenance only — no server-side fetching (2026-09-28)

- **Decision:** the ShortForge SF-1 pattern lands as a "Start from"
  selector on project creation (topic / draft / transcript / article /
  URL). A URL source is stored as reference/provenance metadata only;
  Vidora never fetches arbitrary URLs server-side (SSRF surface, untrusted
  content, no evidence of competitor doing so safely). Optional pasted
  notes can accompany a URL. Source provenance persists in
  `projects.source_kind/source_text/source_url`.
- **Reverse:** revert the creation form to topic/draft; columns are
  nullable and additive.

### D305. Packaging checklist is advisory; dismissals never bypass gates (2026-09-28)

- **Decision:** the AgentTube AT-10 pattern lands as a versioned
  pre-publish checklist in Review Studio (title / description / tags /
  privacy / safety score / schedule rules, `CHECKLIST_VERSION = 1`).
  Dismissals require a reason and are scoped global or per-channel, but
  are purely advisory — they never bypass the strict evidence gate,
  safety checks, approval workflow, or publish execution. The checklist
  cannot block publishing on its own.
- **Reverse:** remove the checklist component; the `checklist_dismissals`
  table is additive.

### D306. Onboarding: no-row users start the wizard instead of redirecting (2026-09-28)

- **Bug found during live verification:** `resolveOnboardingEntry()` (D221)
  redirected users with NO `onboarding_progress` row to `/studio`. Since
  post-signup (`auth.tsx`) sends brand-new users to `/onboarding` and new
  users have no row, every new signup bounced straight to `/studio` — the
  wizard was unreachable for exactly the users it was built for. Live check
  confirmed: `/onboarding` showed "Loading your setup…" then redirected to
  `/studio` for a fresh admin account.
- **Fix:** no row -> `{ action: "resume", step: "welcome" }`; only
  `completed = true` redirects to `/studio`. Safe because
  `saveOnboardingProgress` upserts on the first step save, so the row is
  created the moment the user advances. Doc comments and the D221-era test
  updated to the corrected behavior.
- **Reverse:** revert `resolveOnboardingEntry()` in
  `src/lib/onboarding/onboarding.ts`; DB rows remain valid.

### D307. Marketing numbers are derived from code, never hardcoded (2026-09-28)

- **Decision:** the homepage claimed "25+" AI voices and "10" visual styles
  while code truth is 16 built-in voices (`VOICE_CATALOG` minus
  `library: true`) and 6 styles (`STYLES`). `Hero.tsx` now imports
  `VOICE_CATALOG` from `@/lib/voices` and `STYLES` (newly exported) from
  `StyleGallery.tsx`, deriving both counts at module load. The "narrates it
  in 25+ voices" sentence now reads from the same constant.
- **Reverse:** revert the import + constant + copy edits in `Hero.tsx`.

### D308. StyleGallery's own inflated claims corrected (2026-09-28)

- **Decision:** `StyleGallery.tsx` said "Ten ways to look" and footnoted
  "+ 4 more in the studio, including a custom style trained on your
  references" — four styles that exist nowhere in code. The heading now
  renders `STYLES.length`, the footnote only states the library size, and
  the "characters stay consistent throughout" clause was dropped because
  F16's own UI says cross-scene consistency is not yet verified.
- **Reverse:** revert the three copy edits in `StyleGallery.tsx`.

### D309. feature-catalog.ts is the marketing single source of truth (2026-09-28)

- **Decision:** new `src/lib/feature-catalog.ts` holds the six pillars and
  all 49 marketable features for the public showcase. It is separate from
  `docs/FEATURE_MATRIX.md`, which remains the engineering inventory — the
  two serve different readers and must not be merged.
- **Reverse:** delete the file and its two consumers (`OsMap`, `/features`).

### D310. Six-pillar framing: Discover / Validate / Create / Publish / Measure / Learn (2026-09-28)

- **Decision:** the public showcase is organized as six moves, each with a
  name, tagline, anchor id, app route, and feature list. Platform items
  (API & MCP, Chrome extension, workspaces, credits, /status) live under
  Learn as "run the team on one OS" rather than getting a seventh pillar.
- **Reverse:** re-categorize in `feature-catalog.ts`.

### D311. Honest one-liners in the catalog (2026-09-28)

- **Decision:** every feature gets one sentence with no guarantees, no
  virality predictions, no income claims. Provider-gated features name the
  key they need ("connect a YouTube Data API key", "ElevenLabs key",
  "Pexels or Pixabay key", "YouTube Analytics API key"). Badges:
  `Needs a key`, `Shipping next` (Short-Form Engine, Meta publishing UI),
  `Design only` (Chrome extension — docs only, never built).
- **Reverse:** edit `feature-catalog.ts`.

### D312. Catalog routes are real, verified against src/routes (2026-09-28)

- **Decision:** every feature's `route` is an existing app route a signed-in
  user lands on (checked against the `src/routes` tree). The Chrome
  extension, having no route, points at `/settings/api-keys` — the closest
  real surface, where its token model lives.
- **Reverse:** edit `feature-catalog.ts`.

### D313. OsMap placement on the homepage (2026-09-28)

- **Decision:** the new "One OS. Six moves" section (`OsMap.tsx`, cinema
  design language) sits between `StyleGallery` and `DemoReel`, i.e. after
  the pipeline/style area and before pricing. No existing section was
  removed or reordered.
- **Reverse:** remove the `<OsMap />` line in `src/routes/index.tsx`.

### D314. /features rebuilt as the full public catalog (2026-09-28)

- **Decision:** `/features` now renders all 49 features from
  `feature-catalog.ts` with pillar anchors, a sticky
  "Everything below is included — sign in to use it." bar, and a sign-in
  CTA. The old `DemoUI`/`FeatureSection`/`ResultsSection` blocks were
  removed from this page only; the components remain in the repo.
- **Reverse:** restore the previous `features.tsx` from git.

### D315. Sign-in CTAs target /auth; feature links target app routes (2026-09-28)

- **Decision:** "Sign in to use everything" goes to the existing `/auth`
  route. Each feature links to its real app route — signed-out visitors hit
  the auth guard and land at sign-in, which is real behavior, not a fake
  button. No dead links.
- **Reverse:** edit `OsMap.tsx` / `features.tsx`.

### D316. marketing-claims.test.ts guardrails (2026-09-28)

- **Decision:** new test pins code truth (16 built-in voices, 6 styles),
  fails on stale hardcoded claims in `Hero.tsx` ("25+", "10"-styles in any
  quoting style — excluding legitimate CSS values like `border-white/10`),
  and validates the catalog: six pillar ids, every feature with a route
  starting in "/", descriptions ≥ 20 chars, no banned phrases, provider-gated
  features naming their key, unbuilt features badged and self-describing.
- **Reverse:** delete `src/lib/marketing-claims.test.ts`.

### D317. Banned-phrase patterns are targeted, not naive (2026-09-28)

- **Decision:** the catalog honesty patterns ban affirmative claims only
  ("guarantee you'll earn", "will go viral", "predicts virality",
  "trusted by N", "$X per month") so honest disclaimers like "never
  guarantees" or "never a virality prediction" pass.
- **Reverse:** edit the `BANNED_CATALOG` list in the test.

### D318. Homepage shows headlines; /features shows everything (2026-09-28)

- **Decision:** pillar cards list 3–4 headline capabilities each to avoid
  overwhelming visitors; the complete 49-feature list lives on `/features`
  with anchors. Counts (`TOTAL_CATALOG_FEATURES`) are computed, never typed.
- **Reverse:** edit `HEADLINES` in `OsMap.tsx`.

### D319. Credits and /status cataloged under Learn (2026-09-28)

- **Decision:** "Credits & Budgets" (`/billing`) and "Production Readiness"
  (`/status`, kept public) are cataloged as Learn-pillar features — they are
  part of running the business on the OS, not part of making a video.
- **Reverse:** edit `feature-catalog.ts`.

### D320. ElevenLabs probe used the real /v1/user endpoint (2026-09-29)

- **Decision:** the TTS probes in `src/lib/readiness.functions.ts` and
  `src/lib/status.functions.ts` called `GET https://api.elevenlabs.io/v2/user`,
  which does not exist — the probe 404'd on every key, valid or not, and the
  failure text blamed the key ("may be invalid or revoked"). Both now call
  `GET /v1/user` (ElevenLabs' real account-info endpoint); `xi-api-key` auth
  was already correct, as is the production `POST /v1/text-to-speech` path.
  A regression test pins the `/v1/user` URL in both files.
- **Reverse:** revert the two URL edits; delete the "ElevenLabs probe URL"
  describe block in `src/lib/readiness.test.ts`.

### D321. Dodo allowed in billing provider CHECKs (2026-09-29)

- **Decision:** new migration `20260929010000_billing_dodo_provider_check.sql`
  adds `'dodo'` to the provider CHECK constraints on `public.subscriptions`
  and `public.billing_events`. Without it, the first Dodo webhook (the USD
  path) would 500 on a CHECK violation and never grant credits. Idempotent;
  drops any provider CHECK that still excludes 'dodo'.
- **Reverse:** new migration removing 'dodo' from both CHECKs (do not edit
  published migrations).

### D322. client_errors policy enforces its own caps (2026-09-29)

- **Decision:** migration `20260929020000_client_errors_policy_caps.sql`
  replaces the flagged `WITH CHECK (true)` on the `client_errors` INSERT
  policy with the payload caps that were previously only a table constraint
  (message <= 2000, stack <= 8000, route <= 500, user_agent <= 1000).
  Anonymous insert-only telemetry (D177) is preserved; the policy itself now
  rejects oversized rows instead of waving everything through.
- **Reverse:** new migration restoring `WITH CHECK (true)`.

### D323. Billing go-live docs corrected (2026-09-29)

- **Decision:** `.env.example` DODO_PRODUCT_IDS example now uses the real
  catalog slugs (`creator`, `studio`, `pack_s`, `pack_m`, `pack_l`) instead
  of the stale marketing names; `docs/FOUNDER_TODO.md` documents
  `DODO_ENVIRONMENT=live` (without it, checkout calls Dodo's test API even
  with live keys); Razorpay's dead-end "pay with Stripe (USD)" errors now
  say Dodo (Stripe is not approved). Razorpay subscriptions stay
  deliberately unimplemented (INR = one-time packs only).
- **Reverse:** edit the three files back.

### D324. Duration + aspect-ratio options in every creation flow (2026-09-29)

- **Decision:** the user spotted that creation flows had no duration or
  aspect-ratio (9:16 / 16:9) options. Audit confirmed: Script-to-Video had
  neither (aspect hardcoded 16:9 in `composeQuickJobMp4`, duration
  auto-derived); Voiceover had duration presets but no aspect picker (its
  backend schema already accepted `aspect_ratio`); Auto Edit already had
  both; Quick Create is correctly fixed to 9:16/30s.
- **Change:** new shared `AspectRatioSelect` (16:9 Landscape / 9:16 Vertical /
  1:1 Square) added to Script-to-Video and Voiceover dialogs; Script-to-Video
  also gains a target-length selector (Auto / 30s / 1m / 1:30 / 3m / 5m /
  10m) plus a live narration estimate (`words / 150 wpm`) with an over/under
  hint. Target length guides the AI narration rewrite via the plan prompt
  (never silently trims audio); aspect flows end-to-end: stored on
  `video_jobs.aspect_ratio` (new migration
  `20260929030000_video_jobs_aspect_ratio.sql`), drives the scene-still
  image prompt orientation, and drives the final MP4 frame in the
  client-side compose.
- **Reverse:** revert the dialog UI additions; drop the column via migration.
