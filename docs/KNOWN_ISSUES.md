# Vidora OS — Known Issues & Founder Blockers

Updated 2026-09-28. Only verified items; nothing speculative.

## Founder-only blockers (need the project owner)

| # | Blocker | Why only the founder | Status |
|---|---|---|---|
| 1 | **Render worker not deployed** — no heartbeat in production; server-engine renders sit `queued` | Needs a deploy target + secrets | Open since Phase 0 |
| 2 | **Migrations not applied** — 9 new files `20260928020000`–`20260928020600` (Phase 1) + `20260928030000_p2_channel_niche` + `20260928030100_p2_blueprint` (Phase 2) + `20260928041000_p3_stream_a` (Phase 3 Stream A: `video_ideas.score` jsonb) + `20260928041100_p3_stream_b` (Phase 3 Stream B) exist in-repo only | Lovable does not auto-apply; apply via dashboard SQL editor in filename order, then verify: `select * from pg_extension where extname in ('vector','pg_cron')`, `select * from cron.job`, spot-check new tables/columns in `information_schema` | Open || 3 | **pg_cron / pgvector availability unverified** — no local Postgres on this VM | Confirm extensions exist on the target before/after applying `20260928020500_p1_vector_cron.sql`; the migration is defensive (schedule block fails without touching data; requeue stays server/worker-invoked) | Open |
| 4 | **Provider keys missing** — Pexels/Pixabay, second video-gen provider, web-search API | Keys live with the founder; code degrades honestly without them | Open |
| 5 | **YouTube Data API** — no `YOUTUBE_API_KEY`; quota needed for Phase 2 ingestion + E2E configured branch | Founder's Google Cloud project; without the key all intelligence surfaces return the honest `unconfigured` envelope (unit-verified: zero network calls, zero quota inserts) | Open |
| 6 | **Live payments / OAuth verification / Meta app review** | Founder accounts | Open since Phase 0 |
| 7 | **No authenticated E2E credentials** — `TEST_USER_EMAIL`/`TEST_USER_PASSWORD` unset; `e2e/niche-finder.spec.ts` configured branch (and all authenticated specs) cannot run | Founder seeds a test account; spec self-skips without creds (recorded as pending, not passed) | Open |
| 8 | **`LOVABLE_API_KEY` not set in this environment** — AI script draft (F12) returns the honest `unconfigured` envelope; the configured path (real LLM call + 1-credit debit) is unit-verified only against mocks | Key lives with the founder; generation is preflight-gated and never spends blind | Open |

## Code-level known issues

- Budget spend is computed from `generation_jobs.cost_actual_credits` (the ledger has no workspace/project columns). Jobs that debit purely via ledger RPCs without a `generation_jobs` row are invisible to budgets — documented in code; acceptable for Phase 1, revisit if ledger gains workspace refs.
- `viewer→client` backfill in `20260928020600` assumes legacy `viewer` rows were client seats (per the agency migration's own comment). Reversible pre-apply; flag if any genuine read-only viewers existed.
- Razorpay webhook dedupe key is payload-derived, weaker than Dodo's `webhook-id` (S3, Low) — forgery still impossible; prefer provider event id when available.
- Admin 403 is an inline panel (no separate route) — server-side `assertAdmin` remains the real gate (S2 unchanged).
- `worker/src` tests live outside the vitest glob; `npm run test:worker` is the gate (fixed Phase 0).
- **Phase 2 Smart Folder rule scan limit:** `matchFolderRules` scans at most 500 rows per table per folder — folders over very large asset sets may miss older rows; documented in code (Stream D). Revisit if asset counts grow past this.
- **Phase 2 E2E configured branch unrun:** `e2e/niche-finder.spec.ts` selector alignment fixed 2026-09-27 (New niche dialog flow, `data-testid` row hooks); the configured branch still needs a real `YOUTUBE_API_KEY` + test account and burns real quota — must be run deliberately by the founder.
- **Phase 3 Stream A (verified 2026-09-27):**
  - `video_ideas.score` migration `20260928041000_p3_stream_a.sql` is idempotent (`ADD COLUMN IF NOT EXISTS`) but unapplied — until applied, `scoreIdeaFn`'s cache write fails and the `/create` score button surfaces the error honestly; scoring itself (`scoreIdea`) is pure and unaffected.
  - Stream A makes no paid provider calls (deterministic scorer, template-based titles) — credit preflight not wired; if a future stream adds paid generation to Title Lab/Campaign items, preflight must be added before the provider call (D58/D60).
  - Authenticated E2E for `/create/*` routes not run (no live-browser access, no test account) — delegated to parent/root.
  - VM rebooted mid-session; all Stream A gates were rerun after the reboot.
- **Phase 3 Stream B package export gate is client-enforced:** the ZIP is generated client-side in `projects.$projectId.tsx`, so the strict gate there is a disabled button + pre-packaging re-check, not a server check. The money path (YouTube upload via `runExecutePublishJob`) is fully server-gated. Reversal path: move the gate into a server-side package endpoint when one exists (D102).
- **Phase 3 Stream B migration is forward-only additive** (`20260928041100_p3_stream_b.sql`): adds `research_sources.position`, `research_claims.review_state` + review columns, `projects.research_strict_mode`. Safe to apply; existing owner-scoped RLS untouched. Not yet applied to production (see blocker #2).

## Deliberately not built (by design)

- Worker deployment, live payment keys, YouTube/Meta publish against real accounts, checkout flow — all gated on founder items above.
- Chrome extension: architecture/design only in this program.
- No fake-functional buttons, no mock analytics presented as real, no fabricated data in tests.
