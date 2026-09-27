# VidoraTube — Product Audit

Phase 0a audit, 2026-09-27. Every feature/route classified against the live
`main` codebase with file/line evidence. Verdicts:

- **REAL** — implemented and wired end-to-end (UI + logic + data)
- **PARTIAL** — exists but incomplete, unreachable, or stubbed
- **FAKE** — presents as functional but returns placeholder/mock as if real, or a dead button
- **BROKEN** — errors, crashes, or dead code paths

## REAL

| Feature / route | Evidence |
|---|---|
| `/` homepage (hero, pipeline, voice wall, style gallery, demo reel, pricing, FAQ) | `src/routes/index.tsx` imports all sections; `DemoReel.tsx:10` comment: "Only real renders may appear here — never mockups"; plays real 60s pipeline render `demo/vidora-demo-60s.mp4` |
| `/features` product mock | Honestly labeled "The mock below is a product sketch, not a finished render" (`src/routes/features.tsx:30-32`); preview pane shows generated warship still |
| `/pricing` + `/studio` billing buttons | Disabled with "Coming soon" until `paymentsLive()` env check — D2; `src/lib/billing/payments-live.ts` |
| `/auth`, `/reset-password` | Supabase `signUp`/`signInWithPassword` (`src/routes/auth.tsx:100-113`) |
| `/studio` creation (script / voiceover / auto_edit / story modes) | `CreateSurface`, `AutoEditCreateDialog`, `VoiceoverCreateDialog`, `GenerateVideoDialog`, `StudioV2Panel` — all wired via `useServerFn` to real server functions |
| Render quoting + enqueue (browser + server engines) | `RenderPanel` → `quoteMultiAspectRender` → `enqueueServerRender`; exact-quote math pinned by tests (D26/D27/D30) |
| Browser render to real MP4 | `src/lib/render/browser-render.ts` — genuine H.264/AAC MP4 via FFmpeg.wasm, IndexedDB segment flushing, 24h resume TTL |
| Thumbnail studio (4 variants) | `ThumbnailStudio.tsx:107-110` → `generateThumbnails`/`listThumbnails`/`selectThumbnail`; D80 |
| SEO studio | `SeoStudio.tsx:48-50` → `generateSEOMetadata`/`getSEOMetadata`/`updateSEOMetadata`; D81 |
| YouTube connect + publish pipeline | `YouTubePanel` (`getYouTubeConnection`/`startYouTubeConnect`/`requestUploadScope`/`disconnectYouTube`); `PublishPipeline`/`PublishDialog` (`publishJobToYouTube`); scopes `youtube.upload` + `youtube.force-ssl` (D66) |
| Publish safety gate | `approvePublishJob` writes server-only `approvals` row; `executePublishJob` re-verifies; score<50 blocks public, no override (D61/D62); `src/lib/publish.functions.ts:351,477` |
| Scheduling calendar | No auto-publish; "Publish now" disabled until due (`ScheduleCalendar.tsx:147`); D82 |
| `/analytics` | `getChannelOverview`, `getRetentionCurve`, `getNextVideoRecommendations` (D72–D74); `analytics.index.tsx:34` |
| `/research` | Real server functions; `research.index.tsx:40` `createFn` → navigates to `research.$projectId` |
| `/agency/*` (workspaces, members, channels, brand kit, bulk scheduler, approvals) | All wired: `BulkScheduler.tsx:41-44`, `ChannelManager.tsx:27-29`, `BrandKitEditor.tsx:21-23`, `ApprovalQueue`, `WorkspaceList` |
| `/admin/*` (overview, users, jobs, content, plans, integrations, messages, safety) | Every exported server fn calls `assertAdmin` — `src/lib/admin.functions.ts` |
| Dodo + Razorpay webhooks | Signature verified before processing (`verifyDodoWebhookSignature`, `verifyRazorpayWebhookSignature`); event dedupe via `claimBillingEvent` — `src/routes/api/webhooks/dodo.ts:22-26`, `razorpay.ts:20-24` |
| Contact form | Rate-limited 5/hr (`contactLimiter`, `src/lib/public.functions.ts:54`); RLS-level input validation (migration `20260925112402:26`) |
| Referrals `/r/$code` | Code format validated (`isValidReferralCode`), fixed redirect target — no open redirect; `src/routes/r.$code.tsx` |
| CapCut export | Real client-side ZIP packager with 500 MB memory cap; `CapCutExportButton.tsx:128-143` |
| Resume compose | Real; `ResumeComposeButton.tsx` → `useComposeJobMp4` |
| Guides `/guides/*` | Static in-code content; `guides.$slug.tsx` renders sections as plain text (no markdown injection surface) |
| Status page `/status` | `getSystemStatus` runs real checks |
| Mock stock assets | Honestly labeled `mock://` URLs + `"MOCK — preview asset, not licensed for use"` (D48); `src/lib/stock/mock.ts:43-47` |
| Dubbing/Shorts queue button | Intentionally disabled with honest date: "Queue — Shipping next (target Oct 2026)" (D57); `DubShortsQuote.tsx:127` — not fake, explicitly labeled |

## Phase 2 — Intelligence (2026-09-27, branch `phase2/intelligence`)

| Feature / route | Evidence |
|---|---|
| `/intelligence` hub + `/intelligence/folders` (F7 Smart Folders) | Hub links to all six surfaces; folder CRUD/rules/pins with server-side matching (`src/lib/intelligence/folders.functions.ts`, 20 unit tests); rule scan limit 500 rows/table/folder documented |
| `/intelligence/niches` + `/$nicheId` (F1 Niche Finder, F2 Blueprints) | Deterministic scoring with visible factors — demand **ESTIMATE**-labeled, competition/velocity/freshness, confidence degrades on weak evidence; `niche_snapshots` persisted; deterministic rule-based blueprints in `niches.blueprint` (no LLM); create dialog + filter bar with label associations (a11y/testability) |
| `/intelligence/channels` + `/$channelId` (F3 Channel Explorer) | Channel search/track/sort/filter, subscriber sparkline, ESTIMATE-labeled similar channels (`getSimilarChannels`), `data-testid="channel-row|video-row"` hooks |
| `/intelligence/outliers` (F4 Outlier Explorer) | Outlier score = latest views ÷ sibling median; "3.2× median" badge, velocity, factors, confidence; **"Draft script" handoff creates a real `video_ideas` row** in an Outlier drafts project — no mock ideas |
| `/intelligence/videos/$videoId` (F5 Video Intelligence) | Descriptive packaging/publishing/performance facts, 3-video comparison, `aiNotes: []` (no LLM wired) |
| `/intelligence/trends` (F6 Trend Radar) | Trends derived from video-snapshot velocity; every trend cites ≥1 `research_sources` row (links rendered) |
| YouTube ingestion honesty | Without `YOUTUBE_API_KEY` every fetch returns `{ status: "unconfigured" }` naming the key — zero network calls, zero quota inserts (unit-tested); with key, `youtube_api_cache` TTLs (channels 24h / videos 6h / search 1h) + quota recording |
| Honest labels everywhere | Estimates labeled **ESTIMATE**; stored/real data vs estimates distinguished in UI; no virality/CTR/RPM guarantees anywhere |

## PARTIAL

| Feature | Gap | Evidence |
|---|---|---|
| Meta (Facebook/Instagram) publishing | Backend fully implemented (Graph v26, token encryption, IG container→poll→`media_publish`, fail-closed test-account gates D67–D69, `src/lib/meta-publish.server.ts` 584 lines) but **unreachable**: the exposing module `src/lib/meta.functions.ts` (`getMetaConnection`, `startMetaConnect`, `disconnectMeta`, `publishJobToMeta`) is dead code — zero importing routes/components; publish UI is YouTube-only | `grep` consumers of `meta.functions.ts` → 0 hits; `publishJobToMeta` only at `src/lib/meta.functions.ts:88` |
| Server render worker | Enqueue path real, but worker not deployed / no heartbeat in production; renders would sit `queued` | `getServerWorkerStatus` exists; deploy is a known founder blocker |
| Razorpay subscriptions | Throws "not set up yet" — one-time packs only (D31) | `src/lib/billing/razorpay.ts` |
| Parallax intensity | Toggle is boolean; intensity fixed at 0.5 (documented honest gap, D40) | `src/lib/render/parallax.ts` |

## FAKE

**None found.** Swept for: buttons without `onClick` (2 hits were `DialogTrigger
asChild` — legitimate), `throw "not implemented"` (0 hits), unlabeled mock data
(0 hits). All disabled/honest patterns (DubShortsQuote, pricing "Coming soon",
DemoUI "product sketch", `mock://` stock) are explicitly labeled.

## BROKEN

**None found.** Past crash root causes verified fixed: D86 (`node:crypto` in
client bundle — pure-JS SHA-1, pinned test vector) and D87 (homepage
`reading 'grade'` — render-monitor clock clamped, 8 regression tests).
`src/lib/client-bundle-safety.test.ts` guards the class. Runtime route check
(2026-09-27): all routes 200, no SSR exceptions.

## Dead code / tech debt (not user-visible)

| Item | Evidence |
|---|---|
| `src/components/vidora/HomeCreateModes.tsx` — exported, never imported (homepage uses cinema sections; component says "four doors" while `CREATION_MODES` has 5) | `grep -rl HomeCreateModes src/` → only the file itself |
| `src/lib/meta.functions.ts` — 221 lines, 4 server fns, zero consumers (see PARTIAL above) | 0 consumers |
| `src/lib/providers.functions.ts` — 110 lines (`getProviderStatus` etc.), zero consumers; admin integrations page uses `admin.functions.ts` instead | 0 consumers |
| **Latent auth landmine in dead code:** `meta.functions.ts` uses `requireSupabaseAuth` (permits anonymous-guest JWTs) instead of `requireAppUser` — harmless while dead, but guests could invoke Meta connect/publish if it is ever wired up | `src/lib/meta.functions.ts:21` vs `src/lib/server-auth.ts` |
| `/sitemap.xml` 404s — route is `/sitemap/xml` (`src/routes/sitemap.xml.tsx`); search engines and `robots.txt` conventions expect `/sitemap.xml` | runtime check 2026-09-27 |

## Test coverage of the above

- 1105/1105 Vitest unit tests pass (116 files), incl. 129/129 intelligence tests
  (8 files: A37 + B35 + C37 + D20); `tsc --noEmit` clean under
  strict + `noUnusedLocals` + `noUncheckedIndexedAccess` +
  `exactOptionalPropertyTypes`.
- Playwright `e2e/niche-finder.spec.ts` (Phase 2) selector-aligned to the real
  UI 2026-09-27; configured branch unrun (needs API key + test account),
  unconfigured branch unit-verified. Phase 0/1 specs (`e2e/public.spec.ts`,
  `authenticated.spec.ts`, `mobile.spec.ts`, `stranger.spec.ts`) not executed
  in this audit.
- Worker package tests (`npm run test:worker`) — 76/76 pass.
