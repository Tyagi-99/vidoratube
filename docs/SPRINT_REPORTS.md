# Sprint Reports

End-of-sprint reports in the investor's required format: published URL +
commits, claims-table diff, stranger checklist pass/fail, proof attachments,
grep confirmation, blockers only the founder can resolve.

---

## Sprint 0 remainder — 2026-09-25

**Published URL:** https://vidoratube.lovable.app/ (publish pending — parent to run
Lovable publish after this handoff; all verification below is local unless noted)

**Commits (all on `main`, forward-only, pushed to `origin/main`):**

| Hash | Subject |
|------|---------|
| `3353a05` | Sprint 0: legal config with neutral fallbacks (no placeholders) |
| `c590d27` | Sprint 0: Dodo Payments (USD) + Razorpay (INR), Stripe out of routing |
| `cb2526d` | Sprint 0: per-finished-minute credit model |
| `d75c3e7` | Sprint 0: FAQ JSON-LD + pricing currency toggle + per-minute copy |
| `ef4979c` | Sprint 0: worker deploy package + server-worker feature detection |
| `22b9e55` | Sprint 0: DECISIONS.md + founder TODO updates |
| `e9d795c` | Sprint 0: Dodo webhook accepts base64-encoded secrets (whsec_) |
| `f849329` | Sprint 0: remove character-consistency claim, add DemoReel section |
| `15256f2` | Sprint 0: real 60s English demo video + homepage DemoReel |
| `a3fce33` | Sprint 0: FIX refund RPC money bug + exact migration reason |
| `5f9a905` | Sprint 0: worker idle heartbeat + payment review close-out |

**Shipped:**

1. **Legal config** (`src/config/legal.ts`) — entity/governing-law/grievance fields
   with neutral fallbacks (`Vidora AI`, India). Terms shows the entity section;
   Privacy shows grievance redressal (links `/contact` until an officer is named).
   Payment wording already Dodo USD + Razorpay INR.
2. **Payments** — Dodo Payments adapter (USD, direct REST, Standard-Webhooks
   verification, 5-min replay tolerance); Razorpay stays for INR; Stripe removed
   from routing but kept in the provider type for future return. New
   `/api/webhooks/dodo` route (verify → claim → normalize → process; credits from
   our plan catalog, never the payload). `paymentsLive()` gates checkout:
   buttons read **"Coming soon"** until keys exist, then switch on automatically.
3. **Per-minute credits** — `src/lib/billing/per-minute.ts` (1 credit = 1 finished
   minute, Story/standard; premium voice ×2, cinema stock ×1.5, AI hero 1cr/10s,
   2.5D +0.25/min, dubbing 0.5/min/language, shorts 0.5 each; totals rounded up;
   exact cost shown before rendering). Migration `20260925194000` adds
   `debit_credits_for_minutes` / `refund_credits_for_minutes` RPCs (atomic,
   idempotent per ref) and append-only conversion entries (`delta=0`,
   `reason='migration_per_minute'`, 1:1 — no balances touched, no rows edited).
   Render path debits per finished minute; **failed renders refund automatically**
   (catch block + stale-job reaper reads the actual debited minutes).
4. **FAQ JSON-LD** — `FAQPage` script rendered by `FaqSection` from the same array
   as the visible accordion; in initial SSR HTML on `/` and `/pricing`.
5. **Pricing page** — USD default globally; INR pre-selected only for Indian
   visitors (best-effort `cf-ipcountry`-first header chain, unknown → USD) plus a
   manual USD/INR toggle (localStorage). Honest per-minute cost under each price
   (`≈ $X per finished minute`); "1 credit = 1 finished minute" everywhere;
   checkout buttons "Coming soon" until the matching provider (Dodo/USD,
   Razorpay/INR) is live.
6. **Worker deploy package** — `worker/Dockerfile`, root `docker-compose.yml`,
   root `.env.example` (extended), `scripts/deploy-worker.sh` (one-command Oracle
   Cloud deploy), `worker/README.md` deploy guide. Queue: `FOR UPDATE SKIP LOCKED`
   claims, 5-min lease + heartbeats, dead-worker requeue, 3 attempts (2 retries).
   App feature-detects worker liveness (`getServerWorkerStatus`, 15-min heartbeat
   window) and auto-falls-back to browser FFmpeg.wasm; the server button shows
   "offline" until the worker is deployed.
7. **Demo video** — real 60-second English MP4 rendered through the assembly
   pipeline (TTS narration + 6 AI scene stills + burned-in captions + loudness
   normalization), embedded on the homepage. See Proof below.
8. **Docs** — `docs/DECISIONS.md` (13 decisions), `docs/FOUNDER_TODO.md` (9 items),
   this report.

**Claims-table diff (vs 2026-09-25 19:20 IST baseline):**

| Claim | Before | After |
|-------|--------|-------|
| 16 built-in voices | shown | unchanged, still shown |
| 6 visual styles | shown | unchanged, still shown |
| Hindi-first | removed | stays removed |
| Character consistency | removed (pending proof) | **verdict below — claim stays removed unless proof passes** |
| 1 credit = 1 finished video | shown | **changed → 1 credit = 1 finished minute** |
| Checkout | Stripe+Razorpay copy | **Dodo (USD) + Razorpay (INR); "Coming soon" until keys land** |
| Pricing currency | USD only | **USD default, INR for Indian visitors + manual toggle** |
| Server render | "coming" (no detect) | **auto-fallback to browser until worker deployed** |

**Stranger checklist (honest, local verification; live pass pending parent publish):**

- [x] Homepage loads with no console errors (local build)
- [x] "1 credit = 1 finished minute" on pricing + generate dialog (no per-video copy left)
- [x] Pricing shows USD by default; toggle switches to ₹ prices
- [x] Checkout buttons read "Coming soon" with no keys configured
- [x] FAQ answers present in initial HTML + valid FAQPage JSON-LD
- [x] Demo MP4 plays, ~60s, 1080p, English narration, captions burned in
- [ ] Live stranger pass on https://vidoratube.lovable.app/ — **pending parent publish**

**Proof:**

- Tests: **392 passed** (`npx vitest run`), 0 failed — includes 20 Dodo, 12
  per-minute math, 7 currency, 9 credits, 5 Razorpay, RLS audit, language-neutrality
  guardrail. Refund RPC additionally verified by `scripts/test-minute-refund.sh`
  against real PostgreSQL 16: 10/10 (no-debit no-op, exact refund, double-refund
  no-op, inflated-claim cap, reason normalization). Worker `npx tsx --test`: 11/11.
- `npx tsc --noEmit`: clean (app + worker). Production build: clean.
- Demo video (`public/demo/vidora-demo-60s.mp4`, proof in `demo-assets/proof.txt`):
  ffprobe-verified 1920×1080 H.264 + AAC stereo 48kHz, **60.000s**, 18.5 MB
  (under 25 MB budget); loudness measured **−14.04 LUFS** integrated, −2.19 dBTP
  true peak, 2.7 LU LRA; captions burned in (spot-checked at 25s); 6-scene
  character-consistency test **PASS** (same woman, early 30s, short black hair,
  rust-orange jacket in every scene) — the consistency claim is restored on the
  homepage.
- Screenshots at 375/768/1280: **pending parent publish + verification**.

**Grep confirmations:**

- `grep -rn "Hindi-first" src/` → 0 hits (unchanged)
- `grep -rn "1 credit = 1 finished video\|One credit per render" src/` → 0 hits
- `grep -rn "stripe" src/lib/billing.functions.ts` → routing: none (type union only)
- `grep -rn "migration_per_minute" supabase/migrations/` → 1 file (the new migration)

**New founder TODO items:** #8 (email users about the credit migration), #9 (apply
the four new migrations). Full list in `docs/FOUNDER_TODO.md`.

**Decisions:** `docs/DECISIONS.md` (D1–D13).

**Blockers only the founder can resolve:** unchanged from `docs/FOUNDER_TODO.md`
(legal entity, grievance officer, Dodo/Razorpay keys, vidora.ai, Oracle deploy,
YouTube test channel, migration email, apply migrations).

---

## Sprints 1–2 — 2026-09-25 (evening)

**Published URL:** https://vidoratube.lovable.app/ (publish pending — parent to run
Lovable publish after this handoff; all verification below is local unless noted)

**Commits (all on `main`, forward-only, pushed to `origin/main`):**

| Hash | Subject |
|------|---------|
| `48839c9` | Sprint 1-2 (DB/queue): dead-worker requeue as server-side RPC |
| `f417efd` | Sprint 1-2 (DB/queue): multi-aspect enqueue, queue depth, decisions |
| `6e8fb6b` | Sprint 1: worker-health thresholds + engine-select fallback (+tests) |
| `524119a` | Sprint 1: quoteMultiAspectRender exact multi-aspect quote helper (+tests) |
| `068faa8` | Sprint 1: exact deterministic render settlement migration (+tests) |
| `4f4b4ac` | Sprint 1: reserveRenderBilling reserves the exact quoted credits |
| `9b74976` | Sprint 1: /status render-worker check |
| `b7c9dd7` | Sprint 1: admin worker panel + unit economics |
| `8c8c15e` | Sprint 2: RenderPanel multi-aspect selection + exact cost UI |
| `0570a28` | Sprint 1-2: decisions D7-D12 + stale cost_mode JSDoc fix |
| `650cc6c` | Sprint 1-2 (cost): central recordApiCost helper + unit tests |
| `b32abf4` | Sprint 1-2 (cost): route all provider calls through recordApiCost |
| `42341d0` | Sprint 1-2 (billing): refund every failure path via the fixed RPC |
| `9187d31` | Sprint 1-2 (cost): measured cost-per-minute + plan margins |
| `277f466` | Sprint 1: status page shows 5 loading skeletons (5 checks now) |
| `35e191c` | Sprint 1-2: stranger e2e, purchase round-trip tests, completion email + notifications |

**Shipped:**

1. **Exact-cost rendering (Sprint 1, app/UI)** — `quoteMultiAspectRender` is the
   single price source: per-aspect breakdown + exact grand total, reused by the
   RenderPanel cost box and the server enqueue reserve, so the shown price IS
   the charged price. RenderPanel: 16:9 / 9:16 / 1:1 checkboxes (default all
   three, min one), engine fallback via `resolveEffectiveEngine`, honest copy
   ("exact reserve, tab can close, progress updates live"). `reserveRenderBilling`
   reserves the exact quoted credits (no more hard-coded 10-minute estimate);
   `finalize_render_billing` settles exact-quote rows at exactly the quoted
   credits (migration `20260925220000_exact_render_settle.sql`, function-body
   replacement only; legacy rows keep the output-duration/wall-clock path).
2. **DB/queue (Sprint 1–2)** — `enqueueServerRender` accepts `aspects[]`
   (default all three): one `renders` row per aspect, shared `meta.group_id`,
   legacy singular `aspect` still honored. Dead-worker requeue moved server-side
   (`requeue_stale_renders` RPC, migration `20260925210000`, SECURITY DEFINER,
   service-role only). Worker liveness thresholds shared in
   `src/lib/worker-health.ts` (ok <15m, degraded 15–60m, down 60m+; stale =
   queued >1h, running >2h).
3. **Cost tracking (Sprint 1–2)** — one `recordApiCost` helper for every
   provider call (ElevenLabs, gateway, Shotstack; fail-open), measured
   cost-per-finished-minute + plan margins, admin worker panel (heartbeat,
   queue depth, stale counts) + unit economics with an honest empty state
   ("No measured data yet" — never zeros as measurements). `/status` gains a
   Render-worker check (5 skeletons while loading).
4. **Refunds on every failure path (Sprint 1–2, billing)** —
   `refundDebitedMinutes` refunds exactly the real debit via
   `refund_credits_for_minutes` (idempotent per job id, clamps to the actual
   debit, never throws); wired into the createVideoJob catch, the
   provider-failed branch (previously bypassed refunds), and
   `failVideoJobCompose`. Worker `finish-job` refunds reserved minutes on
   failed/cancelled with `p_ref_id` = job id.
5. **Stranger-test Playwright suite (verification)** — new `e2e/stranger.spec.ts`.
   Runs with `E2E_BASE_URL=https://vidoratube.lovable.app/ npm run test:e2e --
   stranger`. Homepage/pricing checks always run; signup runs only with
   `TEST_USER_PASSWORD` set (or localhost); the real render → MP4 download →
   ffprobe (H.264 + AAC) runs only with `E2E_RUN_RENDER=1`. Everything else is
   `test.skip` with an explicit reason — CI-safe, no secrets required.
6. **Test-mode purchase verification (verification)** — new
   `src/lib/billing/purchase-roundtrip.test.ts`: full round trip for a
   one-time pack purchase (Growth pack `pack_m`, 70 credits — no "Maker" plan
   exists in the catalog; see D31) on Dodo USD and Razorpay INR with mocked
   fetch (no network, no real money): checkout session/order creation →
   webhook delivery → real HMAC signature verification → event claim → credits
   resolved from OUR plan catalog → `grant_credits_once`; duplicate delivery
   grants exactly once (23505 replay → deduped). Dodo `subscription.active`
   → renewal grant + subscription upsert also covered.
7. **Completion email + in-app notifications (verification)** —
   `sendRenderCompleteEmail` (`src/lib/notifications.server.ts`): ALWAYS
   stores a `notifications` row (new table, migration
   `20260925200000_notifications.sql`, RLS: users read own / mark own read,
   writes service-role only); sends email via Resend REST only when
   `RESEND_API_KEY` is set (no SDK). Fire-and-forget with catch — delivery can
   never fail a completion; email links to `/studio`, never embeds the signed
   URL. Studio header bell (`NotificationsBell`) shows unread count + list,
   marks read on open. Hooked into `completeRender`.
8. **Docs** — `docs/DECISIONS.md` D25–D35 (app/UI duplicates D7–D12 renumbered
   to D25–D30, cross-references fixed; verification decisions D31–D35);
   `docs/FOUNDER_TODO.md` #9 updated (seven migrations), #10 added (Resend
   setup, exact steps, 20–30 min); this report.

**Claims-table diff (vs Sprint 0 remainder state):**

| Claim | Before | After |
|-------|--------|-------|
| 1 credit = 1 finished minute | shown | unchanged, still shown (now also quoted exactly pre-render) |
| Exact cost before rendering | shown (per-minute copy) | **strengthened → RenderPanel shows the exact per-aspect quote; reserve = quote = settle** |
| "You can close this tab" | banner added (Sprint 2) | **backed → completion now stores a notification row; email when Resend is configured** |
| Checkout "Coming soon" | shown (no keys) | unchanged — keys still not configured |
| Character consistency | restored (6-scene proof) | unchanged |

**Stranger checklist (honest):**

- [x] `e2e/stranger.spec.ts` written: homepage (no console errors, "Script in.",
  "16 built-in voices", "1 credit = 1 finished minute"), pricing ($19 +
  "Coming soon" honesty), timestamped signup, cost-before-render assertion,
  render → MP4 download → ffprobe H.264 + AAC
- [x] Spec typechecks standalone; 2/5 tests are unconditional, 3 skip
  gracefully without secrets (`TEST_USER_PASSWORD`, `E2E_RUN_RENDER`)
- [x] Purchase round trips verified in test mode (mocked): Dodo USD + Razorpay
  INR checkout → webhook → signature → grant; duplicate → single grant
- [x] Completion email flag on/off tested (8 tests): no key → row only, no
  network; key → Resend post; Resend failure swallowed, row kept
- [ ] Browser run of stranger.spec against the live site — **blocked, not
  skipped silently:** this VM's Chromium cannot reach the public internet
  (egress proxy → `ERR_EMPTY_RESPONSE`; direct → `ERR_SSL_PROTOCOL_ERROR`).
  The pre-existing `public.spec.ts` fails identically, so it is environmental,
  not the spec. CI / a normal network can run it; command documented above.
- [ ] Real render + ffprobe on prod — **not run:** needs `E2E_RUN_RENDER=1` +
  a funded test account + live worker (money gate, by design).
- [ ] Live publish + screenshot verification — **pending parent publish**.
- Note: `e2e/public.spec.ts` asserts the string "checkout is not live", which
  does not exist anywhere in `src/` (actual copy is the "Coming soon" button);
  that test is stale and was left untouched.

**Proof:**

- Tests: **474 passed** (`npm run test`), 0 failed — up from 392. New: 8
  notification tests, 5 purchase round-trip tests, worker-health 12, quote
  tests, settle static-audit 5, recordApiCost unit tests, RLS audit updated
  for `notifications`.
- `npx tsc --noEmit`: clean. Production build (`npm run build`): clean.
- Purchase round trips: Dodo TEST endpoint `https://test.dodopayments.com/
  checkout/sessions` asserted with metadata `{plan_slug, user_id}`; Razorpay
  `https://api.razorpay.com/v1/orders` asserted with `amount: 159900,
  currency: "INR"`; real HMAC verification both sides; replay → exactly one
  `grant_credits_once` RPC call per provider.
- Email: `sendRenderCompleteEmail` returns `{notified, emailed, emailError}`;
  off-path performs zero network calls (fetch stub asserted not called).
- ffprobe assertions live in `e2e/stranger.spec.ts` (H.264 + AAC on the
  downloaded MP4); execution pending the render money gate above.
- Demo video proof unchanged from Sprint 0 (ffprobe 1920×1080 H.264 + AAC,
  60.000s, −14.04 LUFS).

**Grep confirmations:**

- `grep -rn "Maker" src/lib/billing/plans.ts` → 0 hits (no Maker plan; D31)
- `grep -rln "RESEND_API_KEY" src/ docs/` → `src/lib/notifications.server.ts`,
  docs only (no key values anywhere)
- `grep -rn "checkout is not live" src/` → 0 hits (stale public.spec assertion)
- `grep -c "create policy" supabase/migrations/20260925200000_notifications.sql` → 2
  (select-own, update-own-read; no INSERT policy by design, D34)
- `grep -n "^### D" docs/DECISIONS.md | awk … | sort | uniq -d` → no duplicates

**New founder TODO items:** #9 updated (apply the **seven** migrations, listed in
order), #10 (Resend setup for completion email — exact steps, 20–30 min;
in-app bell works with zero setup). Full list in `docs/FOUNDER_TODO.md`.

**Decisions:** `docs/DECISIONS.md` (D1–D35; app/UI D7–D12 renumbered to D25–D30
with cross-references D22/D17/D20 fixed; new D31–D35 for verification calls).

**Blockers only the founder can resolve:** unchanged from `docs/FOUNDER_TODO.md`
(legal entity, grievance officer, Dodo/Razorpay keys, vidora.ai, Oracle deploy,
YouTube test channel, migration email, apply migrations) + #10 Resend key for
completion email.

---

## Sprints 3–4 (in progress) — item 6: 20-minute Story Mode render benchmark

**Target:** a 20-minute Story Mode video completes in under 15 minutes on one
worker. **Method:** `worker/scripts/benchmark-20min.ts` (run: `cd worker &&
npm run benchmark`) drove the REAL chapter implementation
(`worker/src/chapters.ts` `renderChapter` + `stitchChapters`) on 2 chapters x
150 s = 300 s of media, with SYNTHETIC paragraph narration (locally generated
sine-noise WAVs served over a local HTTP loopback server — zero spend, no API
calls). Per chapter the real code downloads the paragraph clips, concatenates
them to one AAC 160k track, builds word-cue ASS with the real
`spreadWordCues`, and does a SINGLE x264 pass (solid-color background from the
continuity brief + subtitles burn-in, preset medium CRF 20, +faststart); stitch
is the real `stitchChapters` (concat copy + faststart, no re-encode). Then
projected 8 chapters x 150 s = 1200 s with the unit-tested model in
`worker/src/benchmark-model.ts`: `total = ceil(8/C) x median(chapter wall) +
stitch`, loudnorm extrapolated linearly from the measured single-pass rate.
Both measured and projected numbers are reported; nothing is hidden. Full
methodology in the script header and `worker/benchmark-results.md`.

**Honest exclusions:** TTS/LLM/image-generation wall time is NOT measured and
NOT in the totals (separate pre-stage in the real system; the harness
substitutes zero-cost synthetic assets). Asset download/upload not measured
(loopback instead of Supabase; generation time labelled synthetic). The −14
LUFS loudness pass is PROPOSED, not in `chapters.ts`; its cost is measured
separately (14.0x realtime) and shown both with and without.

**Measured (2 x 150 s chapters, real FFmpeg, this VM — 2 x AMD EPYC, 8 GB):**
chapter 0: 59.3 s (prep 0.9 s synthetic, single pass 58.3 s); chapter 1: 61.6 s
(prep 0.9 s synthetic, single pass 60.7 s) — i.e. ~2.5x realtime, because the
shipped chapter design encodes a static solid background rather than
per-scene stills. Stitch: concat+faststart 0.5 s (real), proposed loudnorm
21.4 s over 300 s media. Full per-stage table in `worker/benchmark-results.md`.

**Projected 20-minute totals (target ≤ 15m 00s):** C=1 (sequential): **9m 31s
with proposed loudnorm / 8m 06s without — HIT**. C=2 (`WORKER_CHAPTER_CONCURRENCY`
default): **5m 29s / 4m 04s — HIT**. C=4 hypothetical: 3m 28s / 2m 03s — HIT
(unmeasured, needs >2 vCPU). Bottleneck is the single-pass x264 chapter
encode; stitch is a cheap copy pass. Run: `npx tsx scripts/benchmark-20min.ts`,
2026-09-25 16:24 UTC, load 1.12 at start, commit `b03dc6b`.

**Adapter seam:** the harness renders through a `ChapterPipeline` interface and
auto-detects `worker/src/chapters.ts#renderChapter`/`stitchChapters` when
present (used here); otherwise it falls back to `BaselineChapterPipeline`,
which mirrors the legacy scene pipeline's ffmpeg args. No changes were made to
`chapters.ts`, `pipeline.ts`, or any chapter code.

**Bug found (not fixed — routed to pipeline owner):** `pipeline.ts`'s music
ducking filtergraph feeds the voice bus into BOTH `sidechaincompress` (as
sidechain) and `amix` without `asplit`; ffmpeg 8 rejects a doubly-consumed
filter pad (`Stream specifier 'v1' ... matches no streams`), so ANY render with
`musicUrl` + `musicDucking` fails at the audio-mix stage. Fix: insert
`asplit=2` on the voice bus. The fallback baseline measures the corrected
graph (one extra `asplit`, negligible cost); production `pipeline.ts` still
needs the fix.
