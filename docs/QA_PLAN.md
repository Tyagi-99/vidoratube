# VidoraTube — QA Plan

Phase 0a audit, 2026-09-27. Inventory of what exists, measured results, gaps,
and notes for the two mandated E2E scenarios.

## 1. Existing test inventory (measured 2026-09-27)

| Layer | Runner | Result |
|---|---|---|
| Unit / integration (app) | `vitest run` (`src/**/*.test.ts`, node env) | **850/850 passed, 0 failed, 0 skipped, 96/96 files** (~40s) |
| Typecheck | `npx tsc --noEmit` (strict + `noUnusedLocals` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`) | **0 errors** (~35s) |
| Production build | `npm run build` (prebuild ffmpeg-core vendoring + `vite build` + Nitro) | **PASS**, 36.5s, no errors/warnings |
| E2E (browser) | Playwright 1.63.0 — `e2e/public.spec.ts`, `authenticated.spec.ts`, `mobile.spec.ts`, `stranger.spec.ts` (`test:e2e`) | **Not executed in this audit** |
| Worker package | `worker/src/*.test.ts` (aspects, finish-job, parallax-story, benchmark-model, worker) | **Exist but outside the Vitest include glob — not run by `npm test`** |
| Static security audits | `src/lib/rls-policies.test.ts` (RLS per table), `src/lib/client-bundle-safety.test.ts` (no `node:crypto` in client bundle) | Pass (part of the 850) |
| Lint/format | ESLint 9 + Prettier | Configured; not run in this audit |

Runtime route check (dev server, 2026-09-27): `/`, `/features`, `/pricing`,
`/status`, `/contact`, `/auth`, `/privacy`, `/terms`, `/guides` → 200;
`/r/testcode` → 307 to `/`; unknown paths → styled 404; `/sitemap.xml` →
**404** (route is `/sitemap/xml` — bug, see PRODUCT_AUDIT.md); no SSR
exceptions.

## 2. Gaps to close before Phase 1

1. **Run the Playwright suite** (`test:e2e`) in CI and record a baseline;
   several mandated workflows (signup, niche search, 30-sec creation) will
   extend it.
2. **Include worker tests in the test command** (extend the Vitest glob or
   add a `test:worker` script wired into CI) — currently silently skipped.
3. **Add lint to the gate** — ESLint/Prettier are configured but were not
   part of the verified pass criteria.
4. **Fix `/sitemap.xml`** — serve the sitemap at the conventional path
   (or redirect), and add a test asserting it.
5. **Seed/contract tests for provider adapters** — the provider
   contract/registry has health checks but no adapter-level test doubles;
   the brief requires "real provider call OR explicitly marked deterministic
   test adapter" per AI feature.
6. **RLS/security tests for new tables** — extend `rls-policies.test.ts`
   with every new migration (the pattern exists; keep it).
7. **No load/perf tests** — dashboard progressive loading, pagination of
   intelligence datasets, and render-queue depth need baselines before the
   intelligence features land.

## 3. Mandated scenario notes

### E2E_30_SECOND_CREATION ("Why do airplane windows have a tiny hole?")

Prerequisites in the current codebase: browser FFmpeg.wasm render
(`src/lib/render/browser-render.ts`), scene model (`scenes` table),
TTS via ElevenLabs/gateway, caption pipeline, thumbnail studio, SEO studio.
Missing pieces to build first: a research/source-evidence store
(`research_sources`/`research_claims` don't exist), claim↔citation
relationships on scripts, and a QC gate.

Test outline (to implement as a Playwright spec + API-level assertions):
1. Research step stores ≥2 credible sources with URL/title/publisher/retrieved date.
2. Script is 25–35s of narration; factual claims carry source relationships.
3. 5–7 scenes generated; narration + visuals + word/phrase-synced captions + subtle music.
4. 9:16 MP4 produced; assert valid audio + video streams (probe with ffprobe).
5. Title suggestions, 3 thumbnail concepts, description + hashtags generated.
6. All assets persisted to the project; QC passes.
7. Scene-level regeneration works without re-rendering the whole video.
8. Download works; **publish is never triggered** (assert no `publish_jobs` row).

Factual-wording gate: the provided sample script must be verified against
retrieved sources before the test is marked green — never hardcode a
passing script.

### E2E_NICHE_FINDER ("faceless history mysteries")

The Niche Finder does not exist yet — this scenario is the acceptance test
for building it (brief FEATURE 1). Current codebase has the `niches` table
and YouTube connection plumbing to build on.

Required assertions (from the brief): results derive from actual
retrieved/indexed channel data (no fabricated channels); every result shows
freshness/source; scores expose factor contributions; channel card opens;
sorting/filtering work; saved folder works; similar-channel search works;
outlier tab works; result can become a Channel Blueprint and an Idea project.
Required fields per result: channel, handle, subscribers, channel age,
recent uploads, median recent views, views/sub ratio, recent momentum, best
recent outlier, upload cadence, opportunity score, confidence.
If data is insufficient the UI must say **INSUFFICIENT DATA** — never
fabricate a result to make the test green.

## 4. Standing QA rules (from the brief, adopted)

- No feature is COMPLETE until UI + backend + database + permissions +
  loading + error + retry + mobile states work and tests pass.
- Production UI must never show unlabeled fake data — `DEMO DATA`,
  `ESTIMATE`, or `AI INTERPRETATION` labels where applicable
  (current codebase already follows this: `mock://` assets, "product
  sketch", "Coming soon", "Shipping next" labels).
- Never delete a failing test to get green; never mark incomplete work complete.
- AI-generation features need: real provider call or marked test adapter,
  output persistence, failure handling, usage/cost accounting, no duplicate
  charges, retry behavior.
- YouTube features need: OAuth, quota/error handling, data provenance, and
  live-vs-estimated labels.
