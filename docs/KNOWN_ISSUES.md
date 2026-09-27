# Vidora OS — Known Issues & Founder Blockers

Updated 2026-09-27. Only verified items; nothing speculative.

## Founder-only blockers (need the project owner)

| # | Blocker | Why only the founder | Status |
|---|---|---|---|
| 1 | **Render worker not deployed** — no heartbeat in production; server-engine renders sit `queued` | Needs a deploy target + secrets | Open since Phase 0 |
| 2 | **Migrations not applied** — 9 new files `20260928020000`–`20260928020600` (Phase 1) + `20260928030000_p2_channel_niche` + `20260928030100_p2_blueprint` (Phase 2) exist in-repo only | Lovable does not auto-apply; apply via dashboard SQL editor in filename order, then verify: `select * from pg_extension where extname in ('vector','pg_cron')`, `select * from cron.job`, spot-check new tables/columns in `information_schema` | Open |
| 3 | **pg_cron / pgvector availability unverified** — no local Postgres on this VM | Confirm extensions exist on the target before/after applying `20260928020500_p1_vector_cron.sql`; the migration is defensive (schedule block fails without touching data; requeue stays server/worker-invoked) | Open |
| 4 | **Provider keys missing** — Pexels/Pixabay, second video-gen provider, web-search API | Keys live with the founder; code degrades honestly without them | Open |
| 5 | **YouTube Data API** — no `YOUTUBE_API_KEY`; quota needed for Phase 2 ingestion + E2E configured branch | Founder's Google Cloud project; without the key all intelligence surfaces return the honest `unconfigured` envelope (unit-verified: zero network calls, zero quota inserts) | Open |
| 6 | **Live payments / OAuth verification / Meta app review** | Founder accounts | Open since Phase 0 |
| 7 | **No authenticated E2E credentials** — `TEST_USER_EMAIL`/`TEST_USER_PASSWORD` unset; `e2e/niche-finder.spec.ts` configured branch (and all authenticated specs) cannot run | Founder seeds a test account; spec self-skips without creds (recorded as pending, not passed) | Open |

## Code-level known issues

- Budget spend is computed from `generation_jobs.cost_actual_credits` (the ledger has no workspace/project columns). Jobs that debit purely via ledger RPCs without a `generation_jobs` row are invisible to budgets — documented in code; acceptable for Phase 1, revisit if ledger gains workspace refs.
- `viewer→client` backfill in `20260928020600` assumes legacy `viewer` rows were client seats (per the agency migration's own comment). Reversible pre-apply; flag if any genuine read-only viewers existed.
- Razorpay webhook dedupe key is payload-derived, weaker than Dodo's `webhook-id` (S3, Low) — forgery still impossible; prefer provider event id when available.
- Admin 403 is an inline panel (no separate route) — server-side `assertAdmin` remains the real gate (S2 unchanged).
- `worker/src` tests live outside the vitest glob; `npm run test:worker` is the gate (fixed Phase 0).
- **Phase 2 Smart Folder rule scan limit:** `matchFolderRules` scans at most 500 rows per table per folder — folders over very large asset sets may miss older rows; documented in code (Stream D). Revisit if asset counts grow past this.
- **Phase 2 E2E configured branch unrun:** `e2e/niche-finder.spec.ts` selector alignment fixed 2026-09-27 (New niche dialog flow, `data-testid` row hooks); the configured branch still needs a real `YOUTUBE_API_KEY` + test account and burns real quota — must be run deliberately by the founder.
- **Phase 3 Stream D live-provider verification blocked:** no ElevenLabs / OpenAI / Pexels / Pixabay keys in this environment. The TTS fallback chain and stock search configured paths are unit/integration-tested with fakes only; real-API verification (TTS audio quality, Pexels/Pixabay license fields, signed-URL playback) must be run deliberately by the founder with keys.
- **Phase 3 Stream D pre-existing lint notes (untouched, per D92):** 3 prettier errors in `src/routes/guides.$slug.tsx` (implicit `any`, earlier commit), 3 prettier errors in legacy lines of `src/routes/_authenticated/studio.tsx`, 2 prettier notes in coordinator-owned `src/lib/creation/contracts.ts` (not editable). None introduced by Stream D; Stream-D-touched lines are eslint-clean.
- **`voices` absent from generated Supabase types:** the Phase-1 creation migration added `voices` (and reshaped nothing about `language_voices`), but `src/integrations/supabase/types.ts` was never regenerated. Stream D uses D89 local type aliases + `asVoicesClient` structural cast (same pattern as `asJobsClient`). If types are regenerated from the cloud DB, the local aliases should be retired.
- **TTS debit rides the minute-based ledger:** `debitMinutesForJob` converts the TTS credit estimate to whole minutes (`Math.ceil`, 1 credit = 1 minute). There is no dedicated credit-amount debit RPC; this is the only idempotent per-job debit path. Revisit if TTS estimates need sub-credit precision.

## Deliberately not built (by design)

- Worker deployment, live payment keys, YouTube/Meta publish against real accounts, checkout flow — all gated on founder items above.
- Chrome extension: architecture/design only in this program.
- No fake-functional buttons, no mock analytics presented as real, no fabricated data in tests.
