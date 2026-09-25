# Decisions

Non-obvious decisions made under autopilot (Investor Reply #3: "Decide, don't
ask"). Each entry: decision, reason, how to reverse. Newest first.

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
