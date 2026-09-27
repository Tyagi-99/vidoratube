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
- **Stream E (Phase 3): app checkpoint vs render checkpoint not auto-synced (D100).** The Studio status panel reads `generation_jobs.checkpoint.studio`; the worker reads/writes `renders.checkpoint.segments`. They are intentionally separate stores; no code claims end-to-end sync. Surface render-checkpoint state in the Studio UI (or merge the stores) once the worker path is proven in production.
- **Stream E (Phase 3): scene reorder/add/delete use sequential updates, not a transactional RPC.** Worst case of a mid-write failure is non-contiguous `scene_number` values (repairable by reorder); no data loss. If this ever bites, add a `reorder_scenes(project_id, ordered_ids[])` SECURITY DEFINER RPC with owner checks (forward-only `IF NOT EXISTS` migration).
- **Stream E (Phase 3): scene duration is an ESTIMATE until measured audio exists.** `estimateSceneDurationSec` (150 WPM + 0.5s pad) labels itself as such in the Studio UI; QC long-scene warnings are based on the estimate. Measured narration duration replaces it once TTS audio is generated.

## Deliberately not built (by design)

- Worker deployment, live payment keys, YouTube/Meta publish against real accounts, checkout flow — all gated on founder items above.
- Chrome extension: architecture/design only in this program.
- No fake-functional buttons, no mock analytics presented as real, no fabricated data in tests.
