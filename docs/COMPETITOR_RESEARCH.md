# COMPETITOR_RESEARCH.md

**Vidora — YouTube Creator OS · Phase 0b**
**Date:** 2026-09-27
**Method:** Public web search + page-text fetch (browser_search / browser_open). No logins, no purchases, no JS interaction. Anything requiring login or JS interaction is marked **UNVERIFIED — NEEDS MANUAL REVIEW**.
**IP rule compliance:** This document studies capabilities and workflows only. All descriptions are paraphrased in the researchers' own words. No proprietary source code, copyrighted assets, datasets, verbatim marketing copy, exact layouts, or pixel-identical interfaces are reproduced. Product names are used as identifiers only. Useful capability *patterns* are recorded for independent reimplementation — never copied implementations.

**Products covered (7):**
1. Existing Vidora — https://vidoratube.lovable.app/ (our product; repo inspected at `~/workspace/vidoratube`)
2. Tube Accelerator — https://tubeaccelerator.com/secretoffer (+ TubeMagic/VidAI ecosystem tools)
3. TubeGen — https://www.tubegen.ai/
4. Algrow — https://algrow.online/
5. TubeAI — https://tubeai.app/
6. ShortForge — https://shortforge.netlify.app/
7. youtube-automation-agent ("AgentTube") — https://github.com/darkzOGx/youtube-automation-agent (open source, MIT)

**Feature-record field legend:** every record below carries SOURCE / FEATURE OBSERVED / EVIDENCE / WHY USERS VALUE IT / VIDORA VERSION OF THE IDEA / HOW OUR IMPLEMENTATION WILL DIFFER / IMPLEMENTATION STATUS / TEST STATUS. IMPLEMENTATION STATUS values marked as guesses by workers (vs. the public homepage only) must be confirmed in the Phase 0a audit; statuses from the existing-Vidora worker (repo-inspected) are the most reliable.

---

## 1. Existing Vidora (our product)

### 1.1 Product summary

Vidora AI is a faceless-video generation studio, live at https://vidoratube.lovable.app/ ("Script in. Film out."). It takes a topic or draft script and produces a downloadable 1080p MP4 through a 5-stage pipeline: **script structuring → AI narration → AI scene stills → burned-in captions → MP4 mux** (with optional user-supplied music, auto-ducked under the voiceover).

**Who it's for:** Faceless YouTube/Shorts creators in history/documentary, stories/kids (Hindi), explainers, travel/culture niches. The features page explicitly states the product does not publish fake view or revenue numbers.

**Pricing (evidence: homepage FAQ + `src/lib/billing/plans.ts` + migrations):** Credit model — **1 credit = 1 finished minute of video** (`src/lib/billing/per-minute.ts`); free accounts get **10 credits**. Plan catalog (P7 launch defaults): Creator $19/mo (60 credits), Studio $49/mo (200), one-time packs Starter $9 (25), Growth $19 (70), Scale $49 (200) — USD with INR equivalents for Razorpay. **Checkout is NOT live**: `src/routes/_authenticated/billing.index.tsx:131` renders "Coming soon" until Dodo/Razorpay keys exist (founder blockers: account approval + KYC pending).

**Maturity impression:** Broad, well-architected surface (marketing site + app + admin + billing scaffolding + worker) with 825 app tests / 76 worker tests green. But the revenue path (checkout) is off, the server render worker is undeployed (fallback is in-browser FFmpeg.wasm with "keep the tab open"), and several capabilities are gated on founder-only keys/accounts (YouTube OAuth verification, Pexels/Pixabay keys, ElevenLabs live verification, vidora.ai domain ownership). Honest classification: **working early-access prototype, READY FOR STAGING — NOT PRODUCTION**.

### 1.2 Feature records

**V-1 — AI script → scenes pipeline**
- SOURCE: Existing Vidora — https://vidoratube.lovable.app/; `src/routes/_authenticated/projects.index.tsx`; `src/lib/creation-modes.ts`
- FEATURE OBSERVED: Script generation/structuring ("Quick generate")
- EVIDENCE: Homepage: topic or rough draft is structured into scenes with hooks, beats, and a payoff. Repo create-project form has topic input + "Paste a finished script to skip AI writing" and a creation-mode selector (`script`, `voiceover`, `auto_edit`, `story`).
- WHY USERS VALUE IT: Removes the blank-page step; hooks/beats/payoff structure maps directly to retention.
- VIDORA VERSION OF THE IDEA: Already implemented — carry forward.
- HOW OUR IMPLEMENTATION WILL DIFFER: N/A — existing; Phase 0a assesses gaps (some creation modes show "coming soon").
- IMPLEMENTATION STATUS: PARTIAL (some creation modes disabled)
- TEST STATUS: NOT TESTED

**V-2 — AI narration: 16 built-in voices**
- SOURCE: Existing Vidora — https://vidoratube.lovable.app/ (voice marquee); `src/lib/voices.ts`; migration `20260925233000_language_voices_and_gates.sql`
- FEATURE OBSERVED: ElevenLabs TTS narration, 12 English + 4 Hindi built-in voices (George, Sarah, Rachel, Adam, Domi, Elli, Josh, Arnold, Antoni, Nova / Aisha, Arjun, Kavya, Vikram); 11 more languages marked beta.
- EVIDENCE: Homepage lists 16 named voices with descriptions; `voices.ts` marks each `verified: true` with real ElevenLabs voice IDs.
- WHY USERS VALUE IT: Voice quality is the difference between watchable faceless content and instant-skip; a curated cast removes TTS trial-and-error.
- VIDORA VERSION OF THE IDEA: Already implemented — carry forward.
- HOW OUR IMPLEMENTATION WILL DIFFER: N/A — existing; Phase 0a assesses gaps (new premade IDs need end-to-end TTS verification).
- IMPLEMENTATION STATUS: EXISTING (code-complete; end-to-end TTS unverified — founder key needed)
- TEST STATUS: NOT TESTED

**V-3 — AI scene stills: 10 visual styles**
- SOURCE: Existing Vidora — https://vidoratube.lovable.app/; `src/lib/styles.ts`
- FEATURE OBSERVED: Per-scene AI image generation in 10 styles (cinematic, anime, photoreal, watercolor, cyberpunk, documentary, minimalist, render3d, vintage_film, neon_noir).
- EVIDENCE: Homepage shows 6 styles in the gallery; repo `styles.ts` defines exactly 10 `StudioStyleId`s.
- WHY USERS VALUE IT: One consistent visual identity across scenes is the hardest part of faceless production; style presets make "one script, ten different films" instant.
- VIDORA VERSION OF THE IDEA: Already implemented — carry forward.
- HOW OUR IMPLEMENTATION WILL DIFFER: N/A — existing; Phase 0a assesses gaps (character-consistency claim was removed from copy pending a 6-scene proof render).
- IMPLEMENTATION STATUS: EXISTING
- TEST STATUS: NOT TESTED

**V-4 — Burned-in captions**
- SOURCE: Existing Vidora — https://vidoratube.lovable.app/ and /features; `src/lib/render/` caption code
- FEATURE OBSERVED: Captions burned into the MP4 frame.
- EVIDENCE: Homepage claims "Word-level captions burned into the frame, timed to the narration." **Contradiction:** /features says "one readable cue per scene — not karaoke word-sync yet."
- WHY USERS VALUE IT: Most Shorts are watched muted on phones; baked-in captions are a retention necessity and survive re-uploads.
- VIDORA VERSION OF THE IDEA: Already implemented — carry forward; resolve the word-level vs per-scene contradiction in Phase 0a.
- HOW OUR IMPLEMENTATION WILL DIFFER: N/A — existing; Phase 0a must determine which claim is true.
- IMPLEMENTATION STATUS: PARTIAL (copy contradicts itself)
- TEST STATUS: NOT TESTED

**V-5 — MP4 render + download (browser FFmpeg.wasm path)**
- SOURCE: Existing Vidora — https://vidoratube.lovable.app/ (FAQ); `src/lib/render/browser-render.ts`; `docs/FOUNDER_TODO.md`
- FEATURE OBSERVED: In-browser MP4 composition/download via FFmpeg.wasm; server-side render worker built but not deployed.
- EVIDENCE: FAQ: "The last step muxes the MP4 in this browser tab, so leaving or closing it can stall the job." Worker exists (`worker/` Docker image) but per FOUNDER_TODO the app falls back to in-browser FFmpeg.wasm until the worker is deployed; no heartbeat observed.
- WHY USERS VALUE IT: A finished 1080p MP4 with no editing software installed is the entire product promise — "Script in. Film out."
- VIDORA VERSION OF THE IDEA: Already implemented (browser render) — carry forward; server render is the missing half.
- HOW OUR IMPLEMENTATION WILL DIFFER: N/A — existing; Phase 0a assesses gaps (worker deploy is a founder action).
- IMPLEMENTATION STATUS: PARTIAL (browser path coded; server worker undeployed)
- TEST STATUS: NOT TESTED (standing rule: prove a real end-to-end in-browser render produces a playable MP4 — never demonstrated)

**V-6 — Publish to YouTube**
- SOURCE: Existing Vidora — https://vidoratube.lovable.app/; `src/lib/youtube.functions.ts`; `src/lib/youtube-publish-gates.test.ts`
- FEATURE OBSERVED: YouTube OAuth connect + one-click publish with safety/approval gates.
- EVIDENCE: Server functions `getYouTubeConnection`, `startYouTubeConnect`, `requestUploadScope`, `disconnectYouTube`, `publishJobToYouTube`; publish-gate test suites exist; `/api/public/youtube-callback` route. FOUNDER_TODO: no YouTube test channel connected yet — never tested live; Google OAuth verification pending (multi-week).
- WHY USERS VALUE IT: Publishing is the last mile; one-click upload removes the export→Studio→upload grind.
- VIDORA VERSION OF THE IDEA: Already implemented — carry forward.
- HOW OUR IMPLEMENTATION WILL DIFFER: N/A — existing; Phase 0a assesses gaps.
- IMPLEMENTATION STATUS: PARTIAL (code exists, no live test channel)
- TEST STATUS: NOT TESTED

**V-7 — Publish to Meta (Facebook/Instagram)**
- SOURCE: Existing Vidora — `src/lib/meta-publish.server.ts`, `src/lib/meta.functions.ts`; migration `20260926030000_meta_connections.sql`
- FEATURE OBSERVED: Meta OAuth connect + publish (`getMetaConnection`, `startMetaConnect`, `disconnectMeta`, `publishJobToMeta`).
- EVIDENCE: Full function surface plus server implementation and tests (`meta-publish.test.ts`); not mentioned on marketing pages; no live verification evidence.
- WHY USERS VALUE IT: Multi-platform distribution from one render multiplies the value of every minute rendered.
- VIDORA VERSION OF THE IDEA: Already implemented — carry forward.
- HOW OUR IMPLEMENTATION WILL DIFFER: N/A — existing; Phase 0a assesses gaps.
- IMPLEMENTATION STATUS: PARTIAL (code exists, unverified)
- TEST STATUS: NOT TESTED

**V-8 — Creator research / outlier analysis**
- SOURCE: Existing Vidora — `src/routes/_authenticated/research.index.tsx`, `research.$projectId.tsx`; `src/lib/research.functions.ts`
- FEATURE OBSERVED: Research projects — import outliers (YouTube channel recent videos + stats via API), idea generation, save/dismiss ideas, "use idea" → project.
- EVIDENCE: `research.functions.ts` exports `createResearchProject`, `importOutliers`, `listOutliers`, `generateIdeas`, `saveIdea`, `dismissIdea`, `useIdea`; implementation calls `fetchChannelRecentVideos` + `fetchVideoStats` — real YouTube API, not mocked.
- WHY USERS VALUE IT: Idea mining from proven outliers is how faceless channels actually grow; wiring research→project closes the loop from "what to make" to "made."
- VIDORA VERSION OF THE IDEA: Already implemented — carry forward; closest thing to the creator-OS strategy layer.
- HOW OUR IMPLEMENTATION WILL DIFFER: N/A — existing; Phase 0a assesses gaps.
- IMPLEMENTATION STATUS: EXISTING
- TEST STATUS: NOT TESTED

**V-9 — Studio projects dashboard + jobs monitoring**
- SOURCE: Existing Vidora — `src/routes/_authenticated/studio.tsx`, `projects.index.tsx`, `projects.$projectId.tsx`; admin jobs routes
- FEATURE OBSERVED: Project list, per-project scene/still/voice editor, studio render queue with notification bell on completion.
- EVIDENCE: `projects.$projectId.tsx`: scene list, regenerate/remove stills mutations, music query input; `requeue_stale_renders` migration shows job-state handling.
- WHY USERS VALUE IT: A real editing surface (regenerate a still, tweak a scene, re-render) turns the generator from one-shot toy into a workflow.
- VIDORA VERSION OF THE IDEA: Already implemented — carry forward.
- HOW OUR IMPLEMENTATION WILL DIFFER: N/A — existing; Phase 0a assesses gaps.
- IMPLEMENTATION STATUS: EXISTING
- TEST STATUS: NOT TESTED

**V-10 — Billing / credits / plans**
- SOURCE: Existing Vidora — `src/lib/billing/` (dodo.ts, razorpay.ts, stripe.ts, plans.ts, per-minute.ts); `src/routes/_authenticated/billing.index.tsx`; webhook routes `/api/webhooks/dodo|razorpay|stripe`
- FEATURE OBSERVED: Per-minute credit ledger (append-only, debit/refund RPCs, auto-refund on failed renders), plan catalog, Dodo (USD) + Razorpay (INR) + Stripe webhook handlers, currency geo-default.
- EVIDENCE: `billing.index.tsx:131` — checkout "Coming soon" until keys; webhook routes exist; founder blockers: live Dodo/Razorpay keys pending (approval + KYC).
- WHY USERS VALUE IT: Per-minute metering aligns price with delivered value; auto-refund on failures builds trust.
- VIDORA VERSION OF THE IDEA: Already implemented — carry forward; checkout switch-on is a founder action.
- HOW OUR IMPLEMENTATION WILL DIFFER: N/A — existing; Phase 0a assesses gaps.
- IMPLEMENTATION STATUS: PARTIAL (ledger + plans wired; checkout disabled pending live keys)
- TEST STATUS: Unit-tested (billing suites green); NOT live-tested

**V-11 — Stock footage (Pexels/Pixabay) + music provenance**
- SOURCE: Existing Vidora — https://vidoratube.lovable.app/features; `src/lib/music.server.ts`, `music-provenance.ts`
- FEATURE OBSERVED: Studio render path can pull stock video when keys configured; music tracks with provenance tracking.
- EVIDENCE: Features page: "Stock video matching is on the studio path when keys are configured." `music_tracks` table with public-read RLS; "We do not claim a cleared commercial library yet."
- WHY USERS VALUE IT: Stock b-roll raises perceived production value; provenance records protect monetization-eligibility questions.
- VIDORA VERSION OF THE IDEA: Already implemented — carry forward; founder must supply keys.
- HOW OUR IMPLEMENTATION WILL DIFFER: N/A — existing; Phase 0a assesses gaps (Pexels/Pixabay keys are founder blockers).
- IMPLEMENTATION STATUS: PARTIAL (code exists; keys not set)
- TEST STATUS: NOT TESTED

**V-12 — Admin panel, analytics, safety, guides**
- SOURCE: Existing Vidora — `src/routes/_authenticated/admin.*.tsx` (8 files); `analytics.index.tsx`; `src/routes/guides.index.tsx`
- FEATURE OBSERVED: Founder admin (users, plans, content moderation, integration keys, safety rules/approvals, job queue, messaging), creator analytics (YouTube sync, CSV export), public guides/blog with sitemap; agency workspaces scaffolding (`20260926010000_agency_workspaces.sql`).
- EVIDENCE: 8 admin route files; `analytics.index.tsx` has export-CSV + sync + "learn" actions; safety migration `20260926020000_safety_rules_approvals.sql`.
- WHY USERS VALUE IT: Analytics close the feedback loop (which videos work → research → more of that); admin/safety gates are required for a publish-to-YouTube product to stay trustworthy.
- VIDORA VERSION OF THE IDEA: Already implemented — carry forward.
- HOW OUR IMPLEMENTATION WILL DIFFER: N/A — existing; Phase 0a assesses gaps.
- IMPLEMENTATION STATUS: EXISTING
- TEST STATUS: NOT TESTED

### 1.3 Routes found (from `src/routeTree.gen.ts`)

**Marketing/public:** `/`, `/features`, `/pricing`, `/auth`, `/contact`, `/privacy`, `/terms`, `/guides`, `/guides/$slug`, `/r/$code` (referral codes), `/reset-password`, `/status`, `/robots/txt`, `/sitemap/xml`
**Authenticated app:** `/studio`, `/projects`, `/projects/$projectId`, `/research`, `/research/$projectId`, `/billing`, `/plans`, `/analytics`, `/integrations`, `/jobs`, `/messages`, `/agency`, `/agency/$workspaceId`, `/users`, `/content`, `/safety`
**Admin:** `/admin`, `/admin/users`, `/admin/plans`, `/admin/content`, `/admin/integrations`, `/admin/safety`, `/admin/messages`, `/admin/jobs`
**API:** `/api/public/youtube-callback`, `/api/public/meta-callback`, `/api/webhooks/dodo`, `/api/webhooks/razorpay`, `/api/webhooks/stripe`

### 1.4 Stubs, gates, and contradictions (evidence-backed)

1. **Checkout "Coming soon"** — intentionally gated, but no money can change hands today (`billing.index.tsx:131`; FOUNDER_TODO items 3–4).
2. **Some creation modes "(coming soon)"** — `projects.index.tsx:341–343` disables modes with `enabled: false`.
3. **ElevenLabs "Library" voices are placeholders** — `voices.ts:250–267`: 11 beta entries, `verified: false`, `providerVoiceId: null`; cannot render without a user key.
4. **Caption fidelity contradiction** — homepage claims word-level; /features says scene-level ("not karaoke word-sync yet"). One is wrong; treat word-level as unverified.
5. **hello@vidora.ai inbox** — shown on site; FOUNDER_TODO item 5: vidora.ai ownership unconfirmed, emails go nowhere. Support path broken until domain decision.
6. **Server render worker undeployed** — every render depends on the user's browser tab staying open; real UX fragility.
7. **`/status` page** — "Checking services…" in static fetch; actual states need JS execution.

### 1.5 Gap notes vs the creator-OS vision

The existing product is a **render pipeline + publishing plumbing**, not a creator OS. Not implemented as user-facing features today: content calendar/scheduling, multi-channel management beyond OAuth connects, comment/community tools, thumbnail A/B testing (a `thumbnail_variants` table exists in migration `20260926002000` but no surfaced feature confirmed), team roles beyond agency-workspace scaffolding, revenue/monetization analytics, trend detection (research is outlier-import only).

---

## 2. Tube Accelerator (+ TubeMagic / VidAI ecosystem)

### 2.1 Product summary

Tube Accelerator 2.0 is **not a software product** — it is a cohort-based YouTube business course + coaching + community program (one-time purchase, listed at **$797** on its Whop storefront, ~1.3K members; main site currently shows sold-out/waitlist). Its differentiator is monetization-first positioning ("set up income streams before posting the first video"). The software tools named on its sales page (TubeMagic, VidAI, hook generators, thumbnail testers, monetization analyzers, an "AI Matt" chatbot) are separate products offered as trials/bonuses — the program teaches, coaches, and prompts; it does not generate video itself. (Note: the /secretoffer page itself timed out on fetch — details come from the join page, Whop listing, and first-party tool pages.)

**Associated ecosystem tools (verified first-party):**
- **TubeMagic** (tubemagic.com) — AI pre-production suite: multi-LLM script generator (custom length ~100 words ≈ 1 min up to 3000 ≈ 20 min; channel-style matching from a channel link; inspiration-video-based writing; editable/chat-refine), video idea generator, keyword research with a proprietary "Magic Score" (search volume + competition), Niche Explorer (high-RPM niches), Top Video Finder, Ideas Manager pipeline tracker, AI thumbnail generator, YouTube-to-transcript / article-to-script / video-to-script, Warp Upload Optimizer (one-shot title/tags/description optimization on upload), title/description/tag generators, timestamps, community post writer, channel name generator, plagiarism checker, Chrome extension, 95+ languages. ~$47/mo or $497/yr (one plan), 30-day money-back, Paddle payments.
- **VidAI** (vid.ai) — text-to-video faceless generator: prompt/script → narrated video with stock B-roll or AI images, AI captions, background music, timeline editor; Shorts (60/90s) and long-form to ~20 min; template packs; multi-platform aspect ratios; 33+ narrators incl. ElevenLabs-powered voices; notable **MCP integration ("VidAI MCP")** for generating videos from inside Claude/ChatGPT via chat. From $19/mo.

### 2.2 Feature records

**TA-1 — AI coaching: real-time feedback on creative assets**
- SOURCE: Tube Accelerator — https://tubeaccelerator.com/join
- FEATURE OBSERVED: AI coach giving feedback on ideas, titles, thumbnails, hooks, scripts.
- EVIDENCE: Join page lists "AI Coaching: real-time feedback on ideas, titles, thumbnails, hooks, and scripts" as a core inclusion.
- WHY USERS VALUE IT: Mentor-grade critique without booking human time; feedback at creation time prevents weak packaging from shipping.
- VIDORA VERSION OF THE IDEA: A "Package Coach" agent scoring/critiquing title/thumbnail/hook/script against retention and CTR heuristics before publish.
- HOW OUR IMPLEMENTATION WILL DIFFER: Data-driven against the user's own channel analytics and competitor corpus rather than a founder's playbook; an in-workflow checklist rather than a chat upsell.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**TA-2 — "AI Matt": persona chatbot trained on founder's corpus**
- SOURCE: Tube Accelerator — https://tubeaccelerator.com/join
- FEATURE OBSERVED: 24/7 AI persona trained on everything the founder has produced.
- EVIDENCE: Join page lists it as a bonus: an AI trained on the founder's full corpus, askable anytime.
- WHY USERS VALUE IT: Instant answers grounded in a trusted creator's system, no waiting for weekly calls.
- VIDORA VERSION OF THE IDEA: A channel-specific knowledge agent trained on the user's own past videos, notes, and channel strategy.
- HOW OUR IMPLEMENTATION WILL DIFFER: Grounded in the user's own data (transcripts, analytics, strategy docs) instead of a guru persona; retrieval-scoped and cite-backed to avoid hallucinated advice.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**TA-3 — Monetization-first curriculum (income streams before first upload)**
- SOURCE: Tube Accelerator — https://whop.com/tubeaccelerator/tubeaccelerator?a=sleekopener
- FEATURE OBSERVED: Program teaches establishing income streams before publishing the first video.
- EVIDENCE: Whop listing bullets: monetization set up before the first video is posted.
- WHY USERS VALUE IT: Removes the months-of-grinding-with-zero-revenue problem that causes most channel abandonment; gives ROI clarity upfront.
- VIDORA VERSION OF THE IDEA: A monetization planning module — niche RPM estimate, affiliate/offer suggestions, revenue projections attached to a channel brief before production starts.
- HOW OUR IMPLEMENTATION WILL DIFFER: Data-driven estimates (RPM ranges by niche) inside the planning workflow rather than a course lesson; linked to actual publish output.
- IMPLEMENTATION STATUS: NOT IMPLEMENTED (best guess) — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**TA-4 — Day-by-day accountability outline**
- SOURCE: Tube Accelerator — https://tubeaccelerator.com/join (+ mattpar.com phased plan)
- FEATURE OBSERVED: Structured day-by-day action plan for the first ~30 days (niche → monetization → pillar video → batch production → scale).
- EVIDENCE: Join page lists a day-by-day outline; the phased plan runs Days 1–3 niche, 3–10 monetization, 10–15 pillar video, 15–20 batch a month of content, 20+ scale.
- WHY USERS VALUE IT: Converts "grow a channel" into daily tasks; kills decision paralysis.
- VIDORA VERSION OF THE IDEA: Guided onboarding roadmap inside Vidora — sequential missions (pick niche → set monetization → generate pillar video → batch 4 weeks of content) with checklists tied to actual project states.
- HOW OUR IMPLEMENTATION WILL DIFFER: Executable missions wired to the creator OS (completing a mission checks it off automatically) rather than a static course syllabus.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**TA-5 — Bundled micro-tools (hook generators, thumbnail testers, monetization analyzers)**
- SOURCE: Tube Accelerator — https://tubeaccelerator.com/join
- FEATURE OBSERVED: Suite of single-purpose generators: hooks, thumbnail tests, monetization analysis.
- EVIDENCE: Join page bonus list names hook generators, thumbnail testers, monetization analyzers.
- WHY USERS VALUE IT: Single-purpose generators are fast, low-friction, and match how creators work (one small decision at a time).
- VIDORA VERSION OF THE IDEA: Micro-tools inside the Vidora pipeline: hook-line generator, thumbnail A/B concept tester, niche RPM/monetization analyzer.
- HOW OUR IMPLEMENTATION WILL DIFFER: Native pipeline stages with shared project context (same script, same channel data) instead of disconnected one-off tools.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**TA-6 — VidAI MCP: generate videos from inside Claude/ChatGPT chat**
- SOURCE: VidAI (Tube Accelerator ecosystem) — https://vid.ai/mcp (first-party)
- FEATURE OBSERVED: MCP server — connect once, then request and iterate on videos conversationally from Claude/ChatGPT; returns finished video link. Faceless Shorts (60/90s) and long-form to 20 min.
- EVIDENCE: First-party vid.ai/mcp page describes Streamable HTTP connection; user describes idea, picks length/narrator/style, refines script and scenes in chat.
- WHY USERS VALUE IT: Eliminates app-switching; creators request and iterate conversationally from wherever they already work.
- VIDORA VERSION OF THE IDEA: Expose Vidora's render pipeline as an MCP server so external agents can request scripted, narrated, rendered videos.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora's MCP would expose the full creator-OS graph (niche, script, style, voice, project status) as typed tools with credit gating and audit logs, not just a chat video endpoint.
- IMPLEMENTATION STATUS: NOT IMPLEMENTED (best guess) — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**TA-7 — Inspiration-video-based script writing (TubeMagic)**
- SOURCE: TubeMagic (Tube Accelerator ecosystem) — https://tubemagic.com/features (first-party)
- FEATURE OBSERVED: Paste links to top-performing videos; the scriptwriter extracts their best ideas and merges them into the new script.
- EVIDENCE: First-party features page describes inspiration-based writing from video links.
- WHY USERS VALUE IT: Outlier-based ideation is how top faceless channels actually work; automating "study the winners" is a direct quality lever.
- VIDORA VERSION OF THE IDEA: Competitor-intel stage where outlier videos are analyzed (structure, hooks, pacing) and their patterns offered as inputs to script generation.
- HOW OUR IMPLEMENTATION WILL DIFFER: Store outlier analyses as structured data (hook type, retention beats) on the competitor record, reusable across many scripts, rather than a one-shot paste field.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**TA-8 — Warp Upload Optimizer (one-shot metadata optimization at upload)**
- SOURCE: TubeMagic (Tube Accelerator ecosystem) — https://tubemagic.com/features (first-party)
- FEATURE OBSERVED: Feed it an unlisted video; get optimized titles, tags, descriptions in one pass.
- EVIDENCE: First-party features page describes the one-shot optimization output.
- WHY USERS VALUE IT: Catches the packaging step creators do last and worst; one click upgrades discoverability right before it matters.
- VIDORA VERSION OF THE IDEA: Pre-publish optimizer reviewing the finished package (title, description, tags, chapters) against SEO/CTR heuristics with final-fix suggestions.
- HOW OUR IMPLEMENTATION WILL DIFFER: Run on the Vidora project itself (which already holds script, transcript, visuals) rather than an unlisted-video URL, so suggestions reference actual content.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**TA-9 — TubeMagic keyword research with "Magic Score" + Niche Explorer**
- SOURCE: TubeMagic — https://tubemagic.com/features (first-party)
- FEATURE OBSERVED: Keyword research combining search volume + competition into a proprietary score; Niche Explorer surfacing high-RPM niches.
- EVIDENCE: First-party features page lists keyword research with the score and the Niche Explorer.
- WHY USERS VALUE IT: Quantifies "should I make this" before production spend.
- VIDORA VERSION OF THE IDEA: Demand/competition scoring on topics inside Vidora's research module, with RPM-signal niches.
- HOW OUR IMPLEMENTATION WILL DIFFER: Explainable composite scores (factor contributions visible, confidence labeled) rather than a black-box proprietary number — per the brief's niche opportunity model.
- IMPLEMENTATION STATUS: NOT IMPLEMENTED (best guess) — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

### 2.3 UNVERIFIED — NEEDS MANUAL REVIEW

1. The /secretoffer page itself (fetch timed out) — offer stack and pricing there need a live-browser pass.
2. "AI Coaching" and "AI Matt" behavior — no public demo found; needs product access.
3. TubeMagic current pricing details — third-party reviews cite figures; first-party page confirms guarantee + Paddle but shows no prices; free-trial status changed over time.

---

## 3. TubeGen

### 3.1 Product summary

TubeGen (tubegen.ai) is an all-in-one AI YouTube automation platform purpose-built for faceless channels: a single web app chaining niche research → retention-structured scripting → AI voiceover → consistent-character AI visuals + animation + stock B-roll → thumbnail studio with A/B testing → built-in editor (export up to 30 min) → metadata writing. Its core thesis is eliminating 6–8 subscriptions and the manual handoffs between them.

**Who it's for:** Faceless YouTube automation operators publishing on a schedule (long-form); each tool also usable standalone.

**Pricing (evidence: https://www.tubegen.ai/pricing, fetched 2026-09-27):** Credit-based subscription — BYOP $27+/mo (4,050+ credits); Starter $149/mo (33,000 credits, scripts to 3,000 words, 1 min animation/video, 30s avatars, 2 saved styles, 3 active projects); Pro $297/mo (100,000 credits, 10,000-word scripts, 10 min animation/video, 2 min avatars, 3 voice clones, 10 saved styles, 5 projects, 1 seat); Premium $849/mo (340,000 credits, 20,000-word scripts, unlimited animation/avatars, 10 clones, 20 styles, 10 projects, 3 seats); Enterprise custom. Unused credits roll over one billing cycle. **No free trial, no refunds** (first-party FAQ). Standalone Niche Finder from $33/mo. Generation supported in 8 languages (EN, DE, ES, FR, PT, PL, CS, KO).

**Maturity impression:** High product maturity for a vertical all-in-one: detailed public plan-comparison matrix, 12+ module training course included, Trustpilot 4.0/5 (self-claimed). Testimonials are self-published (monetization/RPM claims like "$37.69 RPM", "monetized in 15 days") — treat revenue claims as marketing, not evidence.

### 3.2 Feature records

**TG-1 — Niche Finder (trending-channel research → feeds straight into production)**
- SOURCE: TubeGen — https://www.tubegen.ai/ and https://www.tubegen.ai/blog/youtube-ai-tools
- FEATURE OBSERVED: Research tool tracking thousands of trending channels/keywords, surfacing proven topics with high-RPM revenue signals; result flows directly into script production.
- EVIDENCE: Homepage: tracks thousands of trending channels and keywords to surface new-video insight early. Blog: niche finder searches real channels by views and high-RPM revenue signals and feeds the result straight into production.
- WHY USERS VALUE IT: Topic selection is the highest-leverage decision in a faceless channel; data-backed topics beat guessing, and zero-handoff into scripting saves hours.
- VIDORA VERSION OF THE IDEA: Niche research panel surfacing trending topics + estimated RPM, pushing a selected topic into the script stage with one click.
- HOW OUR IMPLEMENTATION WILL DIFFER: Combine trend signals with the user's existing channel analytics and competitor watchlists as a persistent research board, not a one-shot search page.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**TG-2 — Retention-structured AI scriptwriter (3,000 → 20,000 words, channel-style trained)**
- SOURCE: TubeGen — https://www.tubegen.ai/ (FAQ) + https://www.tubegen.ai/reviews/nexlev-review
- FEATURE OBSERVED: Long-form script generation (3,000 words Starter / 10,000 Pro / 20,000 Premium ≈ 2 hrs narration) tuned for hooks, pattern interrupts, and watch time, matching a reference channel's style.
- EVIDENCE: First-party FAQ describes the word tiers and retention tuning; blog says it trains on a reference channel's style and writes to a retention structure.
- WHY USERS VALUE IT: Long-form faceless scripts are the hardest content to produce at volume; retention structure directly moves the monetization needle.
- VIDORA VERSION OF THE IDEA: Script stage with retention-structure templates (hook → setup → open loops → payoff) and optional style-learning from a reference channel URL.
- HOW OUR IMPLEMENTATION WILL DIFFER: Section-level editable outline with per-section retention annotations and version diffing, rather than single-shot generation.
- IMPLEMENTATION STATUS: PARTIAL (best guess — Vidora has script generation; long-form retention structure + style-matching unverified) — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**TG-3 — Voiceover in 8 languages + voice cloning, timed to scenes automatically**
- SOURCE: TubeGen — https://www.tubegen.ai/ (FAQ) + https://www.tubegen.ai/reviews/nexlev-review
- FEATURE OBSERVED: Narration in 8 languages with library voices plus voice cloning (3 clones Pro / 10 Premium), audio auto-timed to scenes on the timeline.
- EVIDENCE: FAQ describes the voice library, clone tiers, and scene-timed audio.
- WHY USERS VALUE IT: Removes manual narration recording and the export-and-align step; cloning preserves a channel's sonic identity; multilingual opens new markets.
- VIDORA VERSION OF THE IDEA: Voice stage with clone library, multi-language narration, and narration-driven scene timing.
- HOW OUR IMPLEMENTATION WILL DIFFER: Treat voice as a first-class track (waveform-synced subtitles, emphasis marks, per-section re-voicing) within Vidora's own render; keep user-uploaded clone consent records for safety.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit (Vidora has voice features; cloning/tiering unverified)
- TEST STATUS: NOT TESTED

**TG-4 — Scene Builder: timed AI images per scene, locked art style, consistent recurring characters**
- SOURCE: TubeGen — https://www.tubegen.ai/ (FAQ) + https://www.tubegen.ai/blog/youtube-ai-tools
- FEATURE OBSERVED: Batch generation of one AI image per scene, locked to a saved art style (2/10/20 by tier), with consistent characters held across scenes and the whole channel; multiple image models selectable per scene; Storyblocks B-roll mixing.
- EVIDENCE: FAQ: every major image model inside the Scene Builder, batch generation timed to voiceover, consistent recurring characters across a video and channel; saved art styles by tier.
- WHY USERS VALUE IT: Character consistency is the #1 visual quality problem in AI faceless videos; style-locking keeps a channel coherent at 10+ videos/week.
- VIDORA VERSION OF THE IDEA: Per-scene visual generation with persistent character sheets and style presets scoped to the channel.
- HOW OUR IMPLEMENTATION WILL DIFFER: Character/style as versioned channel assets (reference image + seed + style prompt stored per character) reusable across all projects, with a visual consistency preview before render.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit (Vidora has visual styles; per-scene consistent characters unverified)
- TEST STATUS: NOT TESTED

**TG-5 — AI animation + AI avatars in-pipeline (tiered minute caps)**
- SOURCE: TubeGen — https://www.tubegen.ai/pricing (first-party)
- FEATURE OBSERVED: Animated scenes and lip-synced AI-avatar presenters (upload photo or generate character) generated inside the same pipeline, already timed to narration.
- EVIDENCE: Pricing matrix rows for animation minutes (1/1/10/unlimited) and avatar minutes (30s/30s/2min/unlimited); FAQ describes photo upload or generated character with lip-synced voiceover.
- WHY USERS VALUE IT: Motion and a face-stand-in lift retention on faceless channels without filming; in-pipeline timing removes assembly labor.
- VIDORA VERSION OF THE IDEA: Optional animation/avatar layers on scenes — talking-head avatar for intros, animated transitions for listicles.
- HOW OUR IMPLEMENTATION WILL DIFFER: Render via Vidora's own pipeline with transparent per-scene cost, rather than black-box tiered minute caps.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**TG-6 — Original soundtrack scored to the voiceover**
- SOURCE: TubeGen — https://www.tubegen.ai/reviews/nexlev-review (first-party TubeGen content)
- FEATURE OBSERVED: AI-generated background music composed/matched to the narration.
- EVIDENCE: First-party review content: "an original soundtrack scored to the voiceover."
- WHY USERS VALUE IT: Royalty-free music hunting is a time sink and a copyright-strike risk; auto-scored music keeps energy matched to narration.
- VIDORA VERSION OF THE IDEA: Background-music track auto-selected/composed to match script pacing and mood, with auto-ducking under voice.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora already documents "bring your own music; we auto-duck it" — the Vidora equivalent adds generated options with per-scene energy mapping.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**TG-7 — Thumbnail Studio: generate, edit, A/B test + save style presets**
- SOURCE: TubeGen — https://www.tubegen.ai/ (FAQ)
- FEATURE OBSERVED: Thumbnail generation from the video and references, variant A/B testing, saved style presets for channel visual consistency; trained on real high-CTR YouTube thumbnails.
- EVIDENCE: FAQ describes generation, A/B testing, and style presets.
- WHY USERS VALUE IT: Thumbnails drive CTR more than almost any other variable; A/B testing compounds gains; presets keep the channel grid coherent.
- VIDORA VERSION OF THE IDEA: Thumbnail stage generating 3+ variants per video with preset styles, side-by-side comparison, and post-publish CTR tracking per variant.
- HOW OUR IMPLEMENTATION WILL DIFFER: Close the loop with real YouTube CTR data per thumbnail variant once analytics are connected, so the studio learns from actual performance.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**TG-8 — Built-in editor with pre-assembled timeline timed to narration, export up to 30 min**
- SOURCE: TubeGen — https://www.tubegen.ai/ (FAQ) + https://www.tubegen.ai/blog/youtube-ai-tools
- FEATURE OBSERVED: In-app video editor whose timeline arrives pre-assembled and timed to the narration; exports up to 30 minutes; import capability.
- EVIDENCE: FAQ: built-in editor supporting 30-minute exports; "idea to upload without leaving the platform." Blog: editor arrives pre-assembled and timed to the narration.
- WHY USERS VALUE IT: Eliminates external editors for standard automation workflows; pre-assembly is the highest-leverage time saving in the whole chain.
- VIDORA VERSION OF THE IDEA: Render pipeline producing a reviewable timeline before final export, with scene-level re-generation without re-rendering everything.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora's render already happens via its pipeline — add a review/edit layer where each scene (script line + voice + visual) is individually editable and re-renderable.
- IMPLEMENTATION STATUS: PARTIAL (best guess — Vidora renders video; an editable pre-assembled timeline unverified) — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**TG-9 — Auto metadata: descriptions, hashtags, chapter timestamps**
- SOURCE: TubeGen — https://outlierkit.com/blog/tubegen-ai-alternatives (third-party, citing product features); https://www.tubegen.ai/reviews/nexlev-review
- FEATURE OBSERVED: Auto-generated video descriptions, hashtags, and chapter timestamps; a description writer finishes the metadata.
- EVIDENCE: Third-party review lists auto-generated descriptions, hashtags, chapter timestamps; TubeGen's own review mentions the description writer.
- WHY USERS VALUE IT: Chapters improve retention/navigation and search surface; metadata is pure tedium creators otherwise skip or half-do.
- VIDORA VERSION OF THE IDEA: Auto-generate description, tags, hashtags, and chapter timestamps from the finished script as part of the packaging stage.
- HOW OUR IMPLEMENTATION WILL DIFFER: Generate chapters from the actual narration timestamps (known from the voice track) so chapter markers are frame-accurate, not LLM-guessed.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**TG-10 — Credit transparency: "typical cost per finished video minute" per plan**
- SOURCE: TubeGen — https://www.tubegen.ai/pricing (first-party)
- FEATURE OBSERVED: Each plan shows a "typical cost per minute of finished video" derived from real aggregate credit spend (Starter $2.47/min, Pro $2.01/min, Premium $1.94/min), explicitly framed as "not a fixed rate," plus median user output ("60 Minutes of Video — the median Starter user makes 60 minutes of video per month").
- EVIDENCE: Pricing page shows the per-plan figures with the "real credit spend divided by video length, not a fixed rate" framing.
- WHY USERS VALUE IT: Converts an opaque credit system into an answerable question ("what does one video cost me?") and sets honest expectations, reducing billing surprise and churn.
- VIDORA VERSION OF THE IDEA: Show estimated credits-per-finished-minute per project type in Vidora's pricing/docs, computed from real aggregate usage.
- HOW OUR IMPLEMENTATION WILL DIFFER: Present cost estimates at the project-planning stage (before generation starts), not just on the pricing page, so users can scope projects to budget.
- IMPLEMENTATION STATUS: NOT IMPLEMENTED (best guess) — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**TG-11 — Modular standalone tools (Build-Your-Own from $27/mo; Niche Finder standalone $33/mo)**
- SOURCE: TubeGen — https://www.tubegen.ai/reviews/nexlev-review (first-party)
- FEATURE OBSERVED: Individual tools (niche finder, script writer, voiceover, thumbnail studio) purchasable standalone, decoupled from the full pipeline.
- EVIDENCE: First-party content: individual tools from $27/mo on Build-Your-Own; Niche Finder from $33/mo; tools run standalone without the full pipeline.
- WHY USERS VALUE IT: Lowers entry price; lets creators adopt one capability (e.g. thumbnails) without a $149 all-in-one commitment; expands addressable market.
- VIDORA VERSION OF THE IDEA: Offer Vidora pipeline stages (e.g. thumbnail studio, voice) as standalone modules at lower tiers alongside the full creator-OS plan.
- HOW OUR IMPLEMENTATION WILL DIFFER: Keep one unified project model so a standalone-tool user can upgrade to full-pipeline later with all assets (styles, voices, characters) already attached to their channel.
- IMPLEMENTATION STATUS: NOT IMPLEMENTED (best guess) — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**TG-12 — Included 12+ module video course (~3 hours) bundled with the tool**
- SOURCE: TubeGen — https://www.tubegen.ai/reviews/nexlev-review (first-party)
- FEATURE OBSERVED: Training course (12+ modules, ~3 hours) included with the subscription.
- EVIDENCE: First-party review content describes the included course.
- WHY USERS VALUE IT: Tool + training reduces the "powerful but I don't know the workflow" adoption gap, especially for faceless automation beginners.
- VIDORA VERSION OF THE IDEA: In-app guided curriculum teaching the faceless-channel workflow using Vidora itself, not separate docs.
- HOW OUR IMPLEMENTATION WILL DIFFER: Make lessons executable — each module drives a real step in a sample project inside Vidora rather than passive video.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

### 3.3 UNVERIFIED — NEEDS MANUAL REVIEW

1. TubeGen actual dashboard UX, onboarding flow, and whether the pipeline matches marketing — no public dashboard screenshots or docs/help center found. Needs signup (minimum $27 BYOP or $149 Starter, no refunds) or a walkthrough recording.
2. Character-consistency, voice-clone, and animation quality — all vendor-stated claims; no independent hands-on verification.
3. Whether any public API exists — no API docs surfaced.
4. Testimonial revenue claims ($100k revenue, $37.69 RPM, "monetized in 15 days") — self-published marketing; treat as unverified, not evidence.
5. All Vidora IMPLEMENTATION STATUS guesses above — confirm in the Phase 0a audit.

---

## 4. Algrow

### 4.1 Product summary

Algrow (algrow.online) is an all-in-one YouTube intelligence + AI media platform with two halves: (a) a **research** half — searchable Shorts and Longform channel databases with daily growth tracking, outlier/viral-video discovery, and competitor analysis; and (b) a **creation** half — scriptwriting, AI image and video generation, TTS voiceovers, and a thumbnail studio, all billed from one credit pool.

**Who it's for:** Faceless/automation YouTube creators and small studios running multiple channels — people who live inside YouTube and want one subscription instead of four.

**Pricing (evidence: live pricing page, fetched 2026-09-27):** Credit-based — Starter $25/mo (165 credits), Professional $45/mo (300 credits), Ultimate $80/mo (535 credits); annual 30% off; top-ups from $4.99 never expire. Voice character pools on top (ElevenLabs 250K/500K/1M chars/mo; their own "Stealth" model 750K/2M/4M chars/mo; voice clones 5/15/unlimited). No free plan visible publicly.

**Maturity impression:** High and actively developed — public changelog shows near-daily shipping through June 2026, full public API docs (60+ endpoint REST API), and a hosted MCP server used inside Claude/ChatGPT. A mature, API-first product, not an MVP.

### 4.2 Feature records

**AG-1 — Channel database search (Shorts + Longform) with similarity + advanced filters**
- SOURCE: Algrow — https://algrow.online/docs/api/channel-research
- FEATURE OBSERVED: Searchable YouTube channel databases (separate Shorts and Longform indexes) with embedding-based similarity search, keyword exclusion, language filter, subscriber/view/age/upload-count ranges, category tags, monetization yes/no filter, faceless yes/no classification, sorting by 24h/48h growth deltas.
- EVIDENCE: API docs document two search endpoints with the full filter parameter table; third-party write-ups place the database at 312,000+ channels and 18.7M+ indexed videos refreshed at least daily (figures conflict across sources — see unverified list).
- WHY USERS VALUE IT: Finds channels that look like a target niche without manually browsing YouTube; 24h/48h growth sorts surface breakouts before saturation.
- VIDORA VERSION OF THE IDEA: A "niche research" module backed by Vidora's own channel index, with growth-sorted discovery and similarity search feeding directly into script topics.
- HOW OUR IMPLEMENTATION WILL DIFFER: Different data model (Vidora-curated index vs their broad crawl); UX built around ideation cards pushing directly into Vidora's scripting pipeline rather than an API-first endpoint catalog.
- IMPLEMENTATION STATUS: NOT IMPLEMENTED
- TEST STATUS: NOT TESTED

**AG-2 — Channel Trends leaderboard (growth-ranked discovery)**
- SOURCE: Algrow — https://algrow.online/docs/api/channel-research
- FEATURE OBSERVED: Ranked leaderboard of top-growing channels by 24h/48h/7d view and subscriber deltas, filterable by niche keyword, age ("started in last 90 days"), low-quality exclusion, music-channel exclusion.
- EVIDENCE: Docs describe a trends endpoint; changelog notes folder-scoped trending and smarter default filters per tab.
- WHY USERS VALUE IT: One glance shows who's growing right now in a niche — the raw material for picking video topics.
- VIDORA VERSION OF THE IDEA: A "Trending in your niche" feed inside the ideation workspace, auto-scoped to the creator's saved competitor channels.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora ties trend rows directly to "turn this into a script" actions in its own studio UI rather than a standalone leaderboard.
- IMPLEMENTATION STATUS: NOT IMPLEMENTED
- TEST STATUS: NOT TESTED

**AG-3 — Viral video discovery with outlier scoring**
- SOURCE: Algrow — https://algrow.online/changelog + https://algrow.online/docs/api/channel-research
- FEATURE OBSERVED: Viral-video discovery where every video shows an outlier score (views vs the channel's median), sortable/filterable by outlier score alone; paste a video URL to see its channel and similar blowing-up videos.
- EVIDENCE: Changelog entries: "See outlier score on every viral video", "Search viral videos by outlier score alone", "Paste a YouTube video URL into viral discovery".
- WHY USERS VALUE IT: Surfaces proven concepts (videos beating their channel baseline) instead of raw view counts that just reflect big channels.
- VIDORA VERSION OF THE IDEA: Outlier-scored idea feed with one-click "draft script on this concept" handoff into Vidora's script studio.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora stores outlier histories per tracked niche and combines them with its own retention-pattern scoring.
- IMPLEMENTATION STATUS: NOT IMPLEMENTED
- TEST STATUS: NOT TESTED

**AG-4 — AI Screenshot Finder (reverse-image lookup for Shorts)**
- SOURCE: Algrow — https://www.algrow.online/ (pricing lists "Unlimited screenshot finder" on all plans) + third-party review (reverse-image lookup for Shorts to discover hidden niches)
- FEATURE OBSERVED: Upload a screenshot and find similar Shorts/channels — reverse-image discovery into niches.
- EVIDENCE: Listed as unlimited on every pricing tier; reviews describe it as a reverse-image niche discovery tool.
- WHY USERS VALUE IT: Starts research from a visual reference instead of keywords — useful when a creator saw a style they want to replicate.
- VIDORA VERSION OF THE IDEA: Image-based niche discovery feeding into script briefs with visual references attached.
- HOW OUR IMPLEMENTATION WILL DIFFER: Tied to Vidora's own visual-style library rather than generic Shorts lookup.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**AG-5 — Channel alerts (breakout-video, title-pattern, multi-condition)**
- SOURCE: Algrow — https://algrow.online/changelog (Apr 8–12, 2026 entries)
- FEATURE OBSERVED: Rule-based alerts: ping when a saved channel posts an outlier video, when a channel publishes a title matching a pattern, and multi-condition compound alerts (subscribers AND avg views thresholds).
- EVIDENCE: Three separate changelog entries describing each alert type plus one-shot overnight-outlier tooling via MCP.
- WHY USERS VALUE IT: Passive monitoring — creators learn about competitor moves without checking dashboards daily.
- VIDORA VERSION OF THE IDEA: Competitor-watch alerts in Vidora that auto-create draft idea cards when a tracked channel ships a breakout.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora's alerts write directly into the idea backlog as actionable drafts rather than just notifications.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**AG-6 — Channel folders (saved watchlists)**
- SOURCE: Algrow — https://algrow.online/changelog (Apr 9, 2026) + docs
- FEATURE OBSERVED: Save channels into named folders (up to 100 per folder) for niche tracking; folders power filtered trending and alert scanning; MCP tool for saving channels to folders from inside Claude.
- EVIDENCE: Changelog entries plus MCP tooling.
- WHY USERS VALUE IT: Organizes competitor research by niche; watchlists become the input to trends and alerts.
- VIDORA VERSION OF THE IDEA: Competitor sets attached to each creator workspace, doubling as the input scope for niche intelligence.
- HOW OUR IMPLEMENTATION WILL DIFFER: Native to Vidora's workspace model with idea-generation directly from folder contents.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**AG-7 — Transcript reader / video analysis (incl. via MCP)**
- SOURCE: Algrow — https://algrow.online/changelog (Apr 1 + Apr 25, 2026) + https://algrow.online/docs/mcp
- FEATURE OBSERVED: Paste a video URL to get a full transcript and structured breakdown (hook, pacing, why it works) — usable inside Claude via MCP; works from TikTok/Instagram links too.
- EVIDENCE: Changelog entries plus MCP setup docs describing transcript retrieval and analyze_video tools.
- WHY USERS VALUE IT: Reverse-engineers competitor scripts without watching the video.
- VIDORA VERSION OF THE IDEA: Competitor-video breakdowns feeding winning structures into Vidora's script writer.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora breaks transcripts into its own scene/hook/beat schema and reuses the structures as script templates.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**AG-8 — CMS/MCN network data**
- SOURCE: Algrow — https://www.algrow.online/ (pricing: Professional/Ultimate include "CMS/MCN network data")
- FEATURE OBSERVED: Identifies which MCN/CMS network operates a given channel.
- EVIDENCE: Listed on the live pricing page under Professional and Ultimate tiers.
- WHY USERS VALUE IT: Shows who's professionally managed vs independent in a niche, and who's monetized.
- VIDORA VERSION OF THE IDEA: Ownership/network metadata on tracked channels in the research module.
- HOW OUR IMPLEMENTATION WILL DIFFER: Displayed contextually in channel cards rather than as a data-table feature.
- IMPLEMENTATION STATUS: NOT IMPLEMENTED
- TEST STATUS: NOT TESTED

**AG-9 — TTS Studio (multi-provider, voice cloning, free SRT)**
- SOURCE: Algrow — https://algrow.online/docs/api/text-to-speech
- FEATURE OBSERVED: TTS across three engines (ElevenLabs, their own "Stealth" model, MiniMax) with voice search by gender/age/language/accent, voice cloning, adjustable stability/style/speed/pitch, async jobs, and free word-level SRT subtitles.
- EVIDENCE: Full parameter table in the docs; changelog confirms voice cloning (30s upload) and auto-generated SRT captions.
- WHY USERS VALUE IT: Narration for faceless videos with per-plan character pools, plus timed captions bundled free.
- VIDORA VERSION OF THE IDEA: Vidora already has multi-voice narration and burned-in captions; the distinct ideas are voice cloning from a short sample and free bundled word-timed SRT.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora keeps its director-style voice casting UX; add cloning as an opt-in "your voice" feature with its own consent flow.
- IMPLEMENTATION STATUS: PARTIAL (Vidora has 16 voices + burned captions; voice cloning not visible — UNKNOWN — confirm in Phase 0a audit)
- TEST STATUS: NOT TESTED

**AG-10 — AI video generation across many models**
- SOURCE: Algrow — https://algrow.online/docs/api/media-generation
- FEATURE OBSERVED: Text-to-video and image-to-video through Sora 2/Pro, Veo 3.1, Kling 2.6, Seedance 2/2.5, Grok — one credit pool, per-model credit pricing, async job pattern, "bring your own key" option making renders free on the user's own provider key.
- EVIDENCE: Full model/credit table in the docs; landing page confirms every plan gets every model with no model paywalls.
- WHY USERS VALUE IT: One subscription reaches every major video model; BYOK avoids markup for users who already pay providers.
- VIDORA VERSION OF THE IDEA: Multi-model video generation behind Vidora's credit system as an alternative to its stills-based quick path.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora routes generation through its scene-plan abstraction (script → scenes → motion) rather than exposing raw model endpoints.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit (Vidora landing shows stills-based renders; Sora/Veo not mentioned)
- TEST STATUS: NOT TESTED

**AG-11 — AI image generation across models + BYOK**
- SOURCE: Algrow — https://algrow.online/docs/api/media-generation
- FEATURE OBSERVED: Text-to-image with GPT Image 2.5, Nano Banana 2/Pro, Seedream variants, reference-image guidance, fast mode, and bring-your-own-key rendering at 0 credits.
- EVIDENCE: Model/credit table in the docs; BYOK described with automatic zero-credit billing.
- WHY USERS VALUE IT: Flexible image sourcing for thumbnails and video assets; BYOK removes double-paying.
- VIDORA VERSION OF THE IDEA: Same scene-still/thumbnail generation Vidora has, plus an optional BYOK cost path.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora's stills are generated from its scene-plan pipeline; BYOK would slot in as a billing mode only.
- IMPLEMENTATION STATUS: PARTIAL (Vidora generates scene stills; model choice and BYOK UNKNOWN — confirm in Phase 0a audit)
- TEST STATUS: NOT TESTED

**AG-12 — Thumbnail studio (channel-style mimicry, edit, face swap)**
- SOURCE: Algrow — https://algrow.online/docs/api/thumbnails (~760 lines, ~20 endpoints)
- FEATURE OBSERVED: Generate a thumbnail from a title plus reference thumbnails (vision-analyzed design grammar folded into the prompt); compose in a specific channel's design language (subjects never carry over, only the style); plain-English edits; face swap with a real face; person detection; face search/import; thumbnail analysis (composition/palette/text/focal points); saved channel styles; reusable instruction presets; full generation history; thumbs up/down feedback.
- EVIDENCE: The docs page covers ~20 endpoints for these workflows.
- WHY USERS VALUE IT: Covers the entire thumbnail workflow — style-mimicry of competitors, iteration, brand consistency — in one place.
- VIDORA VERSION OF THE IDEA: A Vidora thumbnail studio reusing its visual-style library, with competitor-style mimicry feeding title+thumbnail "packages".
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora packages thumbnail generation together with its title scoring and A/B scheduling rather than as a standalone studio.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit (no thumbnails visible on Vidora landing)
- TEST STATUS: NOT TESTED

**AG-13 — Caption/watermark remover**
- SOURCE: Algrow — https://algrow.online/docs/api/media-generation
- FEATURE OBSERVED: Paste a direct video URL, TikTok link, or Instagram Reel link; the service downloads, AI-removes captions/watermarks, and returns a clean video (12 credits/min, max 90s).
- EVIDENCE: Full endpoint docs with TikTok/Reel examples.
- WHY USERS VALUE IT: Repurposes viral short-form content for cross-platform posting without burned-in watermarks.
- VIDORA VERSION OF THE IDEA: Possible ingest utility for creators importing reference clips into Vidora's editor.
- HOW OUR IMPLEMENTATION WILL DIFFER: Positioned as an ingest/cleanup utility inside Vidora's media library, not a standalone remover.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**AG-14 — MCP server + 60+ endpoint REST API**
- SOURCE: Algrow — https://algrow.online/docs (Overview) + https://mcp.algrow.online/mcp setup docs
- FEATURE OBSERVED: Every capability exposed as REST endpoints (60+) and as an MCP server so AI assistants (Claude, ChatGPT, Cursor, VS Code, Windsurf, OpenClaw) can drive research, TTS, media generation, alerts, and folder management from chat.
- EVIDENCE: Docs overview frames the product as "available two ways"; setup pages exist per MCP client; changelog shows MCP features shipping continuously.
- WHY USERS VALUE IT: Lets creators run the whole workflow inside their AI assistant instead of a dashboard; MCP makes the data programmable for agents.
- VIDORA VERSION OF THE IDEA: Vidora's own MCP surface for agents (ideation, script, voice, render) — a strategic capability, not just an integration.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora's MCP tools would be organized around the creator-OS workflow (idea → script → voice → film → publish) rather than Algrow's research-first taxonomy.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

### 4.3 UNVERIFIED — NEEDS MANUAL REVIEW

1. Exact database scale today — third-party sources cite 312,000+ channels / 18.7M+ videos (Apr 2026) while one review cites "160,000+ Shorts channels"; figures conflict and may be dated.
2. "AI Screenshot Finder" in-app UX — confirmed as a feature on the pricing page, but the workflow is behind login.
3. Dashboard UI beyond docs — docs describe endpoints, not the web Studio UX (scriptwriting tool, video prompt builder, folder UI).

---

## 5. TubeAI

### 5.1 Product summary

TubeAI (tubeai.app) is an "AI agent for YouTube creators" called **Hugo** — a chat-style strategist that takes a creator from finding an outlier idea through titles, thumbnails, scripts, scheduling, and post-publish audits. Positioning is agent-first: "Ask anything about your channel and it'll show you how to go viral."

**Who it's for:** Individual/small YouTube creators (especially longform, commentary/education/storytelling) who want an always-on strategist rather than dashboards — and, separately, creators who want a local AI-assisted video editor via their Claude Code plugin.

**Pricing (evidence: live landing page, fetched 2026-09-27):** Freemium. A **Free** tier: Hugo plus the full database and every generator free every month, Google or email-code signup, no card, no trial clock. The page says users upgrade "when you need more credits, more data on every run, longer scripts and the deeper agents" — but paid tier names and prices are **not visible** on the public landing page.

**Maturity impression:** Newer-looking product, currently in beta (app at beta.tubeai.app; Claude connector at beta.tubeai.app/api/mcp). Public GitHub org (tubeai-app) with an MIT-licensed Claude Code plugin (created 2026-09-24) and a learn.tubeai.app content blog. Marketing is polished but the product surface is less publicly documented than Algrow — many capabilities are only verifiable inside the app or on login.

### 5.2 Feature records

**TI-1 — Hugo: conversational YouTube strategist agent**
- SOURCE: TubeAI — https://tubeai.app/ (landing page)
- FEATURE OBSERVED: Chat-style AI agent ("Hugo") as the primary interface: "find my next outlier," "make a title and thumbnail for it," "write the script in my voice," "schedule and share the plan," "why did my last upload underperform?" Reads the creator's analytics and audience and dispatches research agents across its database, YouTube, X, Reddit, and the web simultaneously.
- EVIDENCE: Landing page built around five Hugo prompt scenarios; states the agent reads analytics/audience, sends agents to multiple sources at once, and files one idea with its proof.
- WHY USERS VALUE IT: One conversational entry point replaces learning multiple dashboards; answers arrive as complete next steps.
- VIDORA VERSION OF THE IDEA: A creator-copilot chat layer over Vidora's studio, with the same five jobs (ideate → package → script → plan → audit) as first-class intents.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora's copilot is grounded in its own render pipeline (every suggestion is renderable), whereas Hugo is research/advisory-first.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**TI-2 — Hot Topics (live "what creators are posting now" feed)**
- SOURCE: TubeAI — https://tubeai.app/ (landing page)
- FEATURE OBSERVED: Live feed of trending topics across YouTube with category, video count, channel count, aggregate views, plus "fastest-growing micro-niches vs the median channel" (e.g. AI Video Generation +650%).
- EVIDENCE: Landing page shows concrete example rows with numeric signals and a "Free to browse yourself" label.
- WHY USERS VALUE IT: Timely, proven topics with volume signals — a direct answer to "what should I make this week."
- VIDORA VERSION OF THE IDEA: A trending-topics panel in the ideation workspace with the same volume signals, one click from topic to script draft.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora ranks topics by fit to the creator's channel (niche + formats) rather than raw platform volume.
- IMPLEMENTATION STATUS: NOT IMPLEMENTED
- TEST STATUS: NOT TESTED

**TI-3 — Trending Formats (title templates ranked by outperformance)**
- SOURCE: TubeAI — https://tubeai.app/ (landing page)
- FEATURE OBSERVED: Title templates ranked by how hard they beat the channel average (e.g. a "How to [action] [thing] Without [action]" template at 6.8x median), each tagged with its psychological lever (Utility Promise, Curiosity Gap), with top examples.
- EVIDENCE: Landing page section with template strings, video counts, median multipliers, and lever labels; "Free to browse".
- WHY USERS VALUE IT: Turns packaging from gut feel into pattern-matching — creators borrow structures that statistically outperform.
- VIDORA VERSION OF THE IDEA: Format/template library inside Vidora's title generator, scored against Vidora's own tracked data.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora generates the title in the creator's voice from the template rather than presenting templates to fill in manually.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**TI-4 — Smart Folders (rule-based auto-updating video collections with insights)**
- SOURCE: TubeAI — https://tubeai.app/ (landing page)
- FEATURE OBSERVED: Set a rule; the platform saves every matching video automatically, refreshes continuously, extracts the formats/vectors/phrases those videos share, and lets you share the folder with one link.
- EVIDENCE: Landing page describes rule-based automatic refresh, folder insights, and public links.
- WHY USERS VALUE IT: Persistent research views that maintain themselves; insights reveal the common DNA of a saved set; shareable links make collaboration trivial.
- VIDORA VERSION OF THE IDEA: Smart collections in Vidora's research space that auto-update and produce "what these videos have in common" briefs for scripting.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora's folders push their insights directly into script templates instead of stopping at analysis.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**TI-5 — Ideation Boards (canvas for concept + pattern labeling)**
- SOURCE: TubeAI — https://tubeai.app/ (landing page)
- FEATURE OBSERVED: Drop reference videos onto a canvas; the agent labels their concepts, formats, and thumbnail patterns, pulls in Google Trends and X signals, and turns the board into viral ideas with one-click auto-ideate, saved to My Ideas.
- EVIDENCE: Landing page describes auto-analyze concepts, Google Trends + X signals, one-click auto-ideate, save-to-ideas.
- WHY USERS VALUE IT: Visual, tactile ideation grounded in real references and external trend signals — faster than a blank doc.
- VIDORA VERSION OF THE IDEA: A moodboard-style ideation canvas whose labeled concepts seed Vidora's script generator.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora's board output goes straight to renderable scene plans, not just idea cards.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**TI-6 — Viral Vectors (word/phrase scoring for titles)**
- SOURCE: TubeAI — https://tubeai.app/ (landing page) + GitHub tubeai-skills README
- FEATURE OBSERVED: Every word and phrase scored across outlier videos it appears in — finds the median outlier, suggests word pairings to lift a title, surfaces the better-performing synonym; ranked across 150+ niches, each word scored against its channel baseline. Also available via the Claude connector.
- EVIDENCE: Landing page section with "Free preview" label; tubeai-skills repo describes viral vectors as part of packaging research.
- WHY USERS VALUE IT: Data-backed micro-optimization of titles — which exact words earn clicks in a niche.
- VIDORA VERSION OF THE IDEA: Title word-scoring built into Vidora's script/title step, trained on Vidora's tracked outlier set.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora applies the scoring inline while generating titles, rather than as a separate analyzer tool.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**TI-7 — A/B Strategies (package performance decisioning)**
- SOURCE: TubeAI — https://tubeai.app/ (landing page)
- FEATURE OBSERVED: The agent checks the creator's title/thumbnail package against every new upload and every recorded title/thumbnail swap, then decides which variant won.
- EVIDENCE: Landing page section describing continuous package checks and win decisions; "Free to browse".
- WHY USERS VALUE IT: Removes guesswork from A/B testing titles/thumbnails — a definitive read on what won.
- VIDORA VERSION OF THE IDEA: Post-publish package testing in Vidora's analytics, with swap recommendations pushed back into the studio.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora closes the loop into regeneration (auto-produce the winning variant) rather than only reporting.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**TI-8 — Thumbnail Inspiration (concept-based semantic search across thumbnails)**
- SOURCE: TubeAI — https://tubeai.app/ (landing page)
- FEATURE OBSERVED: Search by concept across embedded thumbnails in the database to find ones that look like yours.
- EVIDENCE: Landing page section, "Free to browse".
- WHY USERS VALUE IT: Finds visual references by look/feel rather than keywords — essential for packaging research.
- VIDORA VERSION OF THE IDEA: Semantic thumbnail search feeding references into Vidora's thumbnail generation.
- HOW OUR IMPLEMENTATION WILL DIFFER: Search results attach directly to Vidora's style-mimicry renderer.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**TI-9 — Thumbnail Studio with 5-surface preview**
- SOURCE: TubeAI — https://learn.tubeai.app/blog/youtube-thumbnail-design-higher-ctr/youtube-thumbnail-size-specs-dimensions
- FEATURE OBSERVED: A Thumbnail Studio including a free Preview tool rendering a thumbnail inside faithful recreations of five real YouTube surfaces (home feed, search, suggested sidebar, channel page, mobile feed) surrounded by actual competitor videos.
- EVIDENCE: The TubeAI Learn blog article describes the Preview tool's five surfaces and competitor-context display in detail.
- WHY USERS VALUE IT: Catches designs that fail at small sizes or next to real competitors before publishing — the exact gap where CTR is lost.
- VIDORA VERSION OF THE IDEA: A packaging preview step in Vidora showing title+thumbnail at real YouTube sizes against competitor context.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora previews the full package (title + thumbnail + hook frame) as one unit in its pipeline.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**TI-10 — Script writing "in my voice" (learns from your videos, cited research, retention-structured)**
- SOURCE: TubeAI — https://tubeai.app/ (landing page)
- FEATURE OBSERVED: The agent watches the creator's YouTube videos to learn how they talk, researches with citations, and writes scripts line by line for retention.
- EVIDENCE: Landing page: "Hugo watches your YouTube videos to learn how they talk, researches with citations, writes it line by line for retention."
- WHY USERS VALUE IT: Scripts that sound like the creator and hold attention — the two hardest parts of scripting, automated.
- VIDORA VERSION OF THE IDEA: Vidora already structures scripts with hooks/beats/payoff; add voice-style learning from the creator's past videos plus cited research.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora's output is a renderable scene plan, not just a script document.
- IMPLEMENTATION STATUS: PARTIAL (script structuring exists per Vidora landing; voice-learning and cited research not visible — UNKNOWN — confirm in Phase 0a audit)
- TEST STATUS: NOT TESTED

**TI-11 — Scheduling + shareable plan links**
- SOURCE: TubeAI — https://tubeai.app/ (landing page)
- FEATURE OBSERVED: Turn an idea into a full brief (titles, thumbnails, script), place the proof videos on a calendar, and share the plan with an editor or client via one link.
- EVIDENCE: Landing page section "Schedule and share the plan".
- WHY USERS VALUE IT: Moves from planning to production handoff — editors/clients see the whole plan without meetings.
- VIDORA VERSION OF THE IDEA: Shareable production briefs from Vidora projects with calendar placement.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora's briefs include render status and assets, closing the loop to the finished video.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**TI-12 — Channel audit ("why did my last upload underperform?")**
- SOURCE: TubeAI — https://tubeai.app/ (landing page)
- FEATURE OBSERVED: The agent reads the creator's retention data and content-bucket momentum, audits the channel, and reports what the audience keeps asking for so the next idea is made for them.
- EVIDENCE: Landing page section describing retention + bucket-momentum reading and audience-demand surfacing.
- WHY USERS VALUE IT: Turns analytics from charts into a diagnosis and a next-video recommendation.
- VIDORA VERSION OF THE IDEA: Post-publish performance reviews in Vidora that recommend the next video concept from retention signals.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora pairs the diagnosis with one-click regeneration of the underperforming video.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**TI-13 — MCP connector + database scale (400M+ videos / 4M+ channels)**
- SOURCE: TubeAI — https://github.com/tubeai-app/tubeai-skills (README)
- FEATURE OBSERVED: A Claude connector at https://beta.tubeai.app/api/mcp exposing the research database (400M+ videos, 4M+ channels claimed) for outliers, viral vectors, channels, transcripts, thumbnail generation, and workspace (My Ideas, folders) operations; free account required, daily exploration limits.
- EVIDENCE: GitHub README documents the connector capabilities and setup.
- WHY USERS VALUE IT: The research engine becomes usable inside the AI tools creators already use.
- VIDORA VERSION OF THE IDEA: Same strategic play as AG-14 — Vidora's own MCP surface.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora's connector spans the full OS (research → render → publish), not research alone.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**TI-14 — Claude Code video-editor plugin (local Remotion editor)**
- SOURCE: TubeAI — https://github.com/tubeai-app/tubeai-skills (README)
- FEATURE OBSERVED: Open-source Claude Code plugin (MIT): builds Remotion projects locally; per-channel brand kits (colors/fonts/logo/animations) matched from a YouTube link or file; animated scenes (title cards, lower thirds, charts, montages); media gathering from YouTube/web/X/Reddit/news; local Qwen3-TTS voiceovers and CrisperWhisper transcripts; raw-recording editing (cuts false starts/flubs, keeps natural pauses); timeline export for Premiere Pro / Final Cut Pro / DaVinci Resolve (.xml/.fcpxml/.otio).
- EVIDENCE: Full tutorial in the repo README (setup → scenes → preview in Remotion Studio → plain-words changes → render).
- WHY USERS VALUE IT: Non-technical creators get a real editing pipeline driven by plain-language requests, with output that hands off cleanly to pro editors.
- VIDORA VERSION OF THE IDEA: Vidora is cloud-render rather than local-edit; the transferable ideas are per-channel brand kits and pro-editor timeline export.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora keeps rendering server-side; brand kits and timeline handoff would be features of its studio, not a local install.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

**TI-15 — Multi-channel availability (web app, Telegram, Chrome extension)**
- SOURCE: TubeAI — https://tubeai.app/ (landing page: "Available on Web App, Telegram, Chrome Extension")
- FEATURE OBSERVED: The agent is reachable on web, Telegram, and a Chrome extension.
- EVIDENCE: Landing page availability line.
- WHY USERS VALUE IT: Creators interact where they already work — including inside YouTube pages via the extension.
- VIDORA VERSION OF THE IDEA: Vidora on additional surfaces (an extension for in-YouTube research would be the highest-value one).
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora's extension would focus on competitor-data capture on YouTube pages feeding its research index.
- IMPLEMENTATION STATUS: UNKNOWN — confirm in Phase 0a audit
- TEST STATUS: NOT TESTED

### 5.3 UNVERIFIED — NEEDS MANUAL REVIEW

1. Paid plan names and prices — landing page confirms paid tiers exist but shows only the Free tier publicly.
2. Hugo's actual in-app behavior — all claims come from the marketing landing page; the app is behind signup at beta.tubeai.app.
3. Chrome extension capabilities — listed on the landing page but the store listing was not fetched (an unrelated "TubeAI" comment-reply extension exists — do not conflate).
4. No public dashboard screenshots; no public traffic/revenue/user-count figures. Treat market-position claims as unknown.

---

## 6. ShortForge

### 6.1 Product summary

ShortForge (shortforge.netlify.app) is an AI content-repurposing product whose site presents a "one input → full campaign" concept: feed it a source (video link, transcript, article, or a raw idea) and it produces a bundle of platform-native derivatives — short-form scripts, viral hooks, social posts, threads, a carousel, a newsletter, and a blog article — all in one brand voice.

**Who it's for:** Solo creators first, with explicit tiers for small teams and agencies (multi-client workspaces, approvals, usage visibility).

**Pricing (evidence: pricing section on the fetched page):** Creator $19/mo (150 AI generations, 1 brand profile, basic templates, content library); Pro $49/mo (750 generations, 5 brand profiles, advanced templates, campaign generator, content calendar); Agency $99/mo (2,500 generations, 20 brand profiles, team members, client workspaces, approval workflows, advanced analytics). Annual at 20% discount; trial requires no credit card.

**Maturity impression:** Reference/demo-stage. Only the marketing landing page was fetchable; the "Live workspace preview" is a static mock panel, not an interactive demo. Treat all feature claims as *claimed on the landing page*, not as verified-working software.

### 6.2 Feature records

**SF-1 — Multi-source input ingestion**
- SOURCE: ShortForge — https://shortforge.netlify.app/ (homepage, Workflow section)
- FEATURE OBSERVED: Campaign generation starts from any of four source types: a YouTube transcript, an article, a video link, or a free-text idea.
- EVIDENCE: The three-step workflow lists transcript upload, article paste, video link, or simple idea; the hero preview shows a sample transcript turned into derivative assets.
- WHY USERS VALUE IT: Removes the "blank page" problem — existing material or one rough thought becomes feedstock.
- VIDORA VERSION OF THE IDEA: A "start from" step accepting a pasted transcript, article text, or URL alongside the current topic/draft entry.
- HOW OUR IMPLEMENTATION WILL DIFFER: Ours will parse inputs into scene plans (narrative structure) rather than text-only derivatives, running inside Vidora's five-stage render pipeline.
- IMPLEMENTATION STATUS: PARTIAL — Vidora accepts a topic or rough draft; transcript/article/URL ingestion not evident. Confirm in Phase 0a.
- TEST STATUS: NOT TESTED

**SF-2 — One-source campaign generator**
- SOURCE: ShortForge — https://shortforge.netlify.app/ (homepage, hero preview + Features)
- FEATURE OBSERVED: One source produces a connected campaign bundle — five short-form scripts, ten hooks, plus a LinkedIn post, X thread, Instagram carousel, newsletter, and blog article.
- EVIDENCE: The preview panel lists these asset types generated "with platform-specific structure, brand voice and a clear campaign goal."
- WHY USERS VALUE IT: One piece of research or one idea covers every distribution channel, multiplying output without multiplying effort.
- VIDORA VERSION OF THE IDEA: "Repurpose" that turns a finished Vidora render into a Shorts cut, a script-length variant, and platform-native packaging (title, description, tags, hook variants).
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora will repurpose actual produced video assets (scenes, narration, captions), not just generate more text; packaging targets YouTube-first analytics rather than generic social channels.
- IMPLEMENTATION STATUS: NOT IMPLEMENTED — no repurposing concept visible on Vidora's homepage. Confirm in Phase 0a.
- TEST STATUS: NOT TESTED

**SF-3 — Brand Voice Engine (brand profiles)**
- SOURCE: ShortForge — https://shortforge.netlify.app/ (homepage, Features; pricing tiers reference brand-profile counts)
- FEATURE OBSERVED: Users define how each brand communicates; all generated content follows it consistently; plans scale by brand-profile count (1 / 5 / 20).
- EVIDENCE: A Features entry describes teaching the product each brand's communication style; pricing tiers list brand-profile quotas.
- WHY USERS VALUE IT: Output stops sounding generic and stays on-brand across every asset — the main failure mode of AI content tools.
- VIDORA VERSION OF THE IDEA: Channel/niche profiles persisting tone, vocabulary, pacing, and visual style preferences, applied automatically to scripts and stills.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora's profiles will bind to the render pipeline (script + narration voice + visual style + caption styling) as a single preset, rather than text-only tone control.
- IMPLEMENTATION STATUS: NOT IMPLEMENTED — Vidora offers per-project voice/style choice, not persistent brand profiles. Confirm in Phase 0a.
- TEST STATUS: NOT TESTED

**SF-4 — AI content editor (guided rewrite actions)**
- SOURCE: ShortForge — https://shortforge.netlify.app/ (homepage, Features)
- FEATURE OBSERVED: One-click editing operations on generated text — rewrite, expand, shorten, improve hooks, change tone.
- EVIDENCE: A Features entry lists rewriting, expanding, shortening, hook improvement, and tone changes as single actions.
- WHY USERS VALUE IT: Refinement happens in seconds inside the tool; the operator stays in flow.
- VIDORA VERSION OF THE IDEA: Scene-level rewrite actions in the script stage (rewrite scene, tighten hook, simplify language) plus regenerate-still and regenerate-narration at the asset level.
- HOW OUR IMPLEMENTATION WILL DIFFER: Ours edits structured production assets (scenes with tied narration/visuals/timing) with regeneration scoped to the edited scene, not plain text fields.
- IMPLEMENTATION STATUS: UNKNOWN — Vidora's homepage shows script structuring but no editing UI. Confirm in Phase 0a.
- TEST STATUS: NOT TESTED

**SF-5 — Reusable templates**
- SOURCE: ShortForge — https://shortforge.netlify.app/ (homepage, Features; pricing: basic vs advanced templates)
- FEATURE OBSERVED: Users save their best prompts, structures, and campaign formats for reuse.
- EVIDENCE: A Features entry describes saving prompts, structures, and campaign formats; pricing differentiates basic vs advanced templates.
- WHY USERS VALUE IT: Successful formats become repeatable systems — the channel's style compounds instead of being reinvented weekly.
- VIDORA VERSION OF THE IDEA: Saved project templates (voice + visual style + caption format + scene structure) and script-structure templates (listicle, documentary, countdown).
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora templates will be render-pipeline presets (including visual style and caption styling), not just text prompts.
- IMPLEMENTATION STATUS: NOT IMPLEMENTED — no template concept visible on Vidora's homepage. Confirm in Phase 0a.
- TEST STATUS: NOT TESTED

**SF-6 — Content calendar**
- SOURCE: ShortForge — https://shortforge.netlify.app/ (homepage, Features; Pro tier and up)
- FEATURE OBSERVED: Plan, organize, and manage campaigns inside the platform.
- EVIDENCE: A Features entry describes in-platform campaign planning; the Pro tier includes the calendar.
- WHY USERS VALUE IT: Planning and production live in one place, so the schedule reflects actual capacity rather than a separate spreadsheet.
- VIDORA VERSION OF THE IDEA: A publishing cadence planner tied to render credits and scheduled uploads.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora's calendar will be render-and-publish-centric (credits consumed, queue position, scheduled publish time) rather than text-campaign-centric.
- IMPLEMENTATION STATUS: NOT IMPLEMENTED — no calendar visible on Vidora's homepage. Confirm in Phase 0a.
- TEST STATUS: NOT TESTED

**SF-7 — Content library (search, filters, folders)**
- SOURCE: ShortForge — https://shortforge.netlify.app/ (homepage, Features; Creator tier and up)
- FEATURE OBSERVED: All generated assets retrievable via search, filters, and organized folders.
- EVIDENCE: A Features entry describes finding every generated asset using search, filters, and folders.
- WHY USERS VALUE IT: Past work stays findable and reusable — compounding returns on every generation.
- VIDORA VERSION OF THE IDEA: A render history library with per-scene asset reuse (stills, narration clips) searchable by topic, style, and voice.
- HOW OUR IMPLEMENTATION WILL DIFFER: Ours will index production artifacts (MP4s, scenes, captions, thumbnails) with re-render lineage, not just text documents.
- IMPLEMENTATION STATUS: UNKNOWN — Vidora's site shows no library view; account-based render history may exist. Confirm in Phase 0a.
- TEST STATUS: NOT TESTED

**SF-8 — Agency layer (client workspaces, team permissions, approvals, usage reports)**
- SOURCE: ShortForge — https://shortforge.netlify.app/ (homepage, Agencies section + Agency tier)
- FEATURE OBSERVED: Multiple client workspaces, brand profiles per client, team permissions, content approval workflows, usage visibility/reports, stated white-label architecture.
- EVIDENCE: A dedicated Agencies section lists managing clients, brands, and approvals in one workspace; the Agency tier includes team members, client workspaces, approval workflows, advanced analytics.
- WHY USERS VALUE IT: Agencies serve many clients from one seat without content leaking across brands and can show clients what their money produced.
- VIDORA VERSION OF THE IDEA: Team/channel workspaces with role-based approvals before a render or publish, plus per-channel credit usage reports.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora's approvals will gate renders and YouTube publishes (production assets) rather than text drafts; data model will be channel-centric (one workspace per YouTube channel).
- IMPLEMENTATION STATUS: NOT IMPLEMENTED — Vidora reads as single-creator (agency scaffolding exists in migrations but no surfaced feature confirmed). Confirm in Phase 0a.
- TEST STATUS: NOT TESTED

**SF-9 — Credit-quota pricing tiers**
- SOURCE: ShortForge — https://shortforge.netlify.app/ (homepage, Pricing section)
- FEATURE OBSERVED: Generation-based quotas (150 / 750 / 2,500 per month) with annual discount and no-card trial.
- EVIDENCE: The Pricing section lists the three tiers with exact generation counts, 20% annual discount, "no credit card required for trial."
- WHY USERS VALUE IT: Predictable spend scaling with usage; low-friction trial.
- VIDORA VERSION OF THE IDEA: Already exists in concept — Vidora prices 1 credit per finished minute with 10 free starter credits.
- HOW OUR IMPLEMENTATION WILL DIFFER: Not applicable — Vidora's per-minute credit model already answers this; the comparable lesson is per-generation counting (one generation = one asset), coarser than per-minute metering.
- IMPLEMENTATION STATUS: EXISTING — credit pricing and free starter credits are on Vidora's homepage. Confirm details in Phase 0a.
- TEST STATUS: NOT TESTED

### 6.3 UNVERIFIED — NEEDS MANUAL REVIEW

1. ShortForge live workspace behavior — only the marketing page was fetchable; the "Live workspace preview" is a static panel. Needs a real browser pass: brand profile creation, generation run, calendar/library/approval UIs.
2. Feature completeness vs. claims — templates, calendar, approval workflows, usage reports, white-labeling are landing-page claims only.
3. Pricing "AI generations" definition — the page doesn't define what counts as one generation (per asset? per campaign?).

---

## 7. youtube-automation-agent ("AgentTube") — open-source architecture reference

### 7.1 Product summary

An open-source, self-hosted Node.js system (MIT license, ~3,872 stars, ~1,170 forks, v2.10.0, reliability hotfixes dated September 2026, CI with lint + tests) that runs a YouTube channel end-to-end as a pipeline of specialized agents: topic research and editorial planning → script writing → thumbnail design → SEO metadata → production (TTS narration + visuals assembled into a real MP4) → human review gates → scheduled publishing → post-publish analytics feeding learnings back into the next planning cycle. **Nothing publishes until review gates pass ("approval-first");** placeholder/simulated output is hard-blocked from the publishing path.

**Who it's for:** Technical operators of automated/faceless YouTube channels comfortable self-hosting, bringing their own API keys, and granting a human (themselves) final approval.

**Cost model:** Free to self-host (MIT). Monetization is via the user's own provider spend (YouTube Data API free; text via Gemini free tier or OpenAI/OpenRouter/Kimi/MiMo/GLM; ElevenLabs TTS optional; AI video clips via Seedance/MiniMax/Kling/Wan with a configurable paid-seconds cap). No SaaS pricing exists.

**Architecture overview (paraphrased):** One agent file per pipeline stage under `agents/` (strategy, script, thumbnail, SEO, production, publishing, analytics). An "Autonomous Channel Operator" turns a declared strategy (objective, audience, pillars, cadence, KPI, budget) into an editorial plan, then runs each video through the stage agents. Job state, checkpoints, evidence, and analytics persist in local SQLite, so interrupted runs resume from the first incomplete stage. A small Express server (port 3456) exposes a local dashboard and REST API. Text, TTS, image, and video providers are swappable adapters with a "simulation" fallback tier — if a paid key is missing, the pipeline runs with marked placeholders, and real-vs-simulated output is tracked so simulated content can never enter approval or publishing. Cron-style schedules (generation 06:00, queue every 15 min, analytics 09:00, optimization 22:00, weekly strategy Sundays) drive the daily loop. Evidence-backed learnings (24h/7d performance vs. the channel's own history) are proposed to the operator and only become future planning constraints after explicit human approval.

### 7.2 Feature records

**AT-1 — Autonomous Channel Operator (strategy-driven automation)**
- SOURCE: youtube-automation-agent — README "Run the Autonomous Channel Operator" section
- FEATURE OBSERVED: The operator takes a declared outcome (objective, audience, content pillars, cadence, success metric, boundaries) and turns it into researched editorial plans and production runs; scheduled runs recur at the configured weekly cadence.
- EVIDENCE: README documents setting objective/audience/pillars/cadence/metric, then activating the run; the operator refreshes trend and competitor signals, builds an evidence-labeled editorial plan, and routes each video through strategy, script, thumbnail, SEO, and production.
- WHY USERS VALUE IT: The channel keeps producing on-strategy content without hand-picking topics — the system becomes a junior strategist, not just a renderer.
- VIDORA VERSION OF THE IDEA: An "Autopilot channel plan": user declares niche, audience, cadence, KPI; Vidora drafts the editorial calendar and renders scheduled videos pending approval.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora will pair this with its server render worker and cloud state (not local SQLite), and approval-first human gates stay mandatory — autonomy never publishes directly.
- IMPLEMENTATION STATUS: NOT IMPLEMENTED — Vidora renders on-demand from user-supplied topics; no autonomous strategy/planning layer visible. Confirm in Phase 0a.
- TEST STATUS: NOT TESTED

**AT-2 — Stage-agent pipeline with clear handoffs**
- SOURCE: youtube-automation-agent — README "Architecture" and "How It Works" sections
- FEATURE OBSERVED: Dedicated agents for Content Strategy, Script Writer, Thumbnail Designer, SEO Optimizer, Production, Discoverability, Publishing, Analytics, chained Research → Script → Production → Review → Publish → Learn with a documented flow diagram.
- EVIDENCE: README's architecture diagram chains the operator through editorial plan, strategy, script, thumbnail/SEO, production, discoverability preflight, review gates, publishing, and analytics with a feedback loop; each agent is one file in `agents/`.
- WHY USERS VALUE IT: Each stage is independently improvable, inspectable, and resumable; failures localize to one stage instead of killing the whole run.
- VIDORA VERSION OF THE IDEA: Vidora's five-stage pipeline (script → voice → stills → captions → film) already resembles this; the gap is the missing strategy/SEO/analytics stages.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora's stages run on the server render worker with credit metering per stage; stage outputs will be user-visible and editable in the studio, whereas AgentTube's are largely agent-internal files.
- IMPLEMENTATION STATUS: PARTIAL — Vidora has a render pipeline but no strategy/SEO/analytics/publishing stages. Confirm in Phase 0a.
- TEST STATUS: NOT TESTED

**AT-3 — Provider-flexible AI with graceful simulation fallbacks**
- SOURCE: youtube-automation-agent — README "AI Providers" and "Production Pipeline" sections
- FEATURE OBSERVED: Any OpenAI-compatible text endpoint works (OpenAI, Gemini, OpenRouter, Kimi, MiMo, GLM, Ollama); TTS falls back ElevenLabs → OpenAI TTS → simulation; images and video assembly degrade to simulation; simulated output is tracked and permanently blocked from approval/publishing.
- EVIDENCE: README lists supported providers with base URLs, documents per-stage fallback chains ending in "Simulation", and states simulated output cannot enter approval or publishing.
- WHY USERS VALUE IT: The pipeline never hard-fails on a missing key — develop end-to-end for free and only pay for the stages you care about, with a hard safety boundary around real publishing.
- VIDORA VERSION OF THE IDEA: Provider adapters with explicit "preview/simulated" watermarking — free-tier users could assemble full storyboards with placeholder media that can never be published or counted as billable renders.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora will implement this as a first-class "preview mode" in the studio UI with clear simulated badges, plus credit-cost estimates before switching to paid providers — a UX-level treatment rather than a console-log distinction.
- IMPLEMENTATION STATUS: PARTIAL — Vidora already has multiple voices/styles and shows cost before render, but no documented free-simulation tier or provider swapping. Confirm in Phase 0a.
- TEST STATUS: NOT TESTED

**AT-4 — Hybrid AI video assembly (bounded paid clips + local fill)**
- SOURCE: youtube-automation-agent — README "AI video providers" section
- FEATURE OBSERVED: Long-form videos use generated clips only for the hook and key sections (with a paid-seconds cap), while the rest of the timeline is filled locally; narration is mixed in and captions kept alongside; provider task IDs persist so interrupted jobs resume the known task instead of resubmitting.
- EVIDENCE: README documents hybrid assembly with bounded provider clips, local fill, a configurable max-generated-seconds cap, and persisted provider task IDs.
- WHY USERS VALUE IT: Caps the most expensive generation while keeping the highest-impact moments cinematic — cost control without visible quality loss.
- VIDORA VERSION OF THE IDEA: "Cinematic hook" mode — generate AI video only for scene 1 (and user-selected hero scenes), stills elsewhere, with a per-project spend cap shown before rendering.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora will expose this as a per-scene toggle in the scene plan with a live cost estimate, integrated into its existing stills-first pipeline rather than a headless config flag.
- IMPLEMENTATION STATUS: NOT IMPLEMENTED — Vidora's pipeline is stills-based. Confirm in Phase 0a.
- TEST STATUS: NOT TESTED

**AT-5 — Scene manifest + Scene Repair Studio (per-scene repair)**
- SOURCE: youtube-automation-agent — README "Repair one scene without starting over" section
- FEATURE OBSERVED: Every production keeps a durable scene manifest (narration, visual prompt, timing, provider/task identity, asset origin, rights state, evidence links, revision history); the operator can edit, reorder, lock, or regenerate a single scene, or regenerate narration only without spending video credits.
- EVIDENCE: README documents the manifest fields and repair operations — edit/reorder/lock scenes, upload a licensed replacement asset, regenerate only one scene, "regenerate narration only"; narration edits invalidate that scene's audio and trigger factual re-review; approved/scheduled productions lock against repair.
- WHY USERS VALUE IT: Fixes cost one scene instead of a full re-render — dramatically cheaper iteration and faster turnaround on review notes.
- VIDORA VERSION OF THE IDEA: Per-scene repair in Vidora's studio: regenerate a single still, re-narrate one scene, or reorder scenes, then rebuild the MP4 without re-spending on unchanged scenes.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora will credit scenes individually and rebuild server-side with a visual diff preview; AgentTube's model is file/manifest-based on a local machine.
- IMPLEMENTATION STATUS: UNKNOWN — Vidora's homepage doesn't show a studio repair UI. Confirm in Phase 0a.
- TEST STATUS: NOT TESTED

**AT-6 — Checkpoint/resume for interrupted productions**
- SOURCE: youtube-automation-agent — README "Resume an interrupted production" section
- FEATURE OBSERVED: Every generation stage writes a checkpoint; after a timeout or restart the dashboard shows the saved-stage count and first incomplete stage; resume continues from there, or from an earlier stage to regenerate from that point on. Fail-closed publishing: an upload that may have reached YouTube requires channel reconciliation before retry.
- EVIDENCE: README documents per-stage checkpoints, the dashboard's saved-stage display, selective regeneration from a chosen stage, and the fail-closed reconciliation rule.
- WHY USERS VALUE IT: Long, expensive pipelines survive crashes — no paying twice for completed stages.
- VIDORA VERSION OF THE IDEA: Render-job checkpoints per stage with a "resume" button in the render history; interrupted jobs continue rather than restarting.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora's checkpoints will live in cloud state with status visible in the UI (progress bar per stage), rather than local SQLite plus a localhost dashboard.
- IMPLEMENTATION STATUS: UNKNOWN — Vidora's homepage mentions keeping the tab open for in-browser muxing, implying resumability is limited. Confirm in Phase 0a.
- TEST STATUS: NOT TESTED

**AT-7 — Safety gates: fail-closed narration, factual review, media rights**
- SOURCE: youtube-automation-agent — README reliability hotfixes + repair/studio sections
- FEATURE OBSERVED: Publishing blocked by gates: missing/simulated/stale/failed narration, unresolved factual claims, unconfirmed media rights; narration edits invalidate audio and require regeneration plus re-review; even intentional silence needs explicit confirmation and a stored reason.
- EVIDENCE: README's hotfix notes state safety gates block simulated video, missing narration, unresolved factual claims, and unconfirmed media rights from publishing; narration is "fail-closed" with per-scene provenance records.
- WHY USERS VALUE IT: Trust — the operator can leave it running because the system refuses to ship broken or legally risky content.
- VIDORA VERSION OF THE IDEA: Pre-render/pre-publish checklist in the studio (narration present, rights declared, factual review for documentary niches) — a gate, not just a warning.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora's FAQ already requires declaring rights before rendering; the upgrade is enforcing structured gates (checkboxes with reviewer identity) in the publish flow rather than an honor-system prompt.
- IMPLEMENTATION STATUS: PARTIAL — Vidora requires rights declaration but no documented multi-gate review flow. Confirm in Phase 0a.
- TEST STATUS: NOT TESTED

**AT-8 — Evidence desk / provenance review (claim-level fact checking)**
- SOURCE: youtube-automation-agent — README "Review research and provenance" section
- FEATURE OBSERVED: Scripts list their factual claims; each claim must link to a verified source (or a reviewer waiver) before approval; productions with no verifiable claims are marked as not needing review; media-rights and factual attestations are separate; a synthetic-media control captures YouTube's altered-content disclosure and carries it into the upload request.
- EVIDENCE: README describes the Evidence desk: claims approved only when linked to verified sources, unsupported claims remain blocking, waivers require a reviewer note, plus the altered/synthetic media control preserved into the publishing queue and upload.
- WHY USERS VALUE IT: For documentary/educational niches, fact-checking is the product's trust moat — and the disclosure control prevents policy strikes.
- VIDORA VERSION OF THE IDEA: A claim-review panel for fact-first niches plus a synthetic-media disclosure toggle that flows into YouTube upload metadata.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora will make this niche-aware (only surfaced for documentary/history/news projects) and studio-integrated, rather than a separate desk.
- IMPLEMENTATION STATUS: NOT IMPLEMENTED — no claim-review concept on Vidora's homepage. Confirm in Phase 0a.
- TEST STATUS: NOT TESTED

**AT-9 — Shorts repurposing studio (local draft selection + 9:16 render)**
- SOURCE: youtube-automation-agent — README "Repurpose an approved video into Shorts" section
- FEATURE OBSERVED: From an approved video, draft three Shorts by selecting self-contained windows from the scene timeline (local, no AI cost), preserving source-scene IDs and review evidence; choose a layout (blurred canvas, center crop, stacked focus) and render a real 9:16 MP4 with mobile-safe burned captions plus SRT; each Short has its own approval and schedule, blocked until the source production is approved and rights confirmed.
- EVIDENCE: README documents local draft selection, the three layouts, real 9:16 rendering with burned captions and SRT, source-scene lineage, and per-Short approval/scheduling gates.
- WHY USERS VALUE IT: One long-form asset becomes three Shorts at near-zero marginal cost — the highest-ROI repurposing loop in the business.
- VIDORA VERSION OF THE IDEA: One-click "cut 3 Shorts" from any approved Vidora render: auto-select hook-dense windows, reframe to 9:16, burn captions, separate scheduling.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora will use its scene structure and caption timing (already word-level per homepage claim) to pick windows intelligently, and render server-side with the same credit model — a polished studio flow vs. AgentTube's local script flow.
- IMPLEMENTATION STATUS: NOT IMPLEMENTED — no Shorts repurposing visible on Vidora's homepage. Confirm in Phase 0a.
- TEST STATUS: NOT TESTED

**AT-10 — Discoverability preflight (bundled GEO/AIO/AEO audit)**
- SOURCE: youtube-automation-agent — README "Review discoverability guidance" + v2.10.0 notes
- FEATURE OBSERVED: After metadata and provenance are assembled, a bundled content auditor runs versioned GEO/AIO/AEO and web-search checks on a canonical content package, storing engine/schema versions, rule IDs, severity, and findings; findings are advisory — keep actionable or dismiss with a reason that carries to future audits.
- EVIDENCE: README documents the preflight, the stored audit fields, the advisory status, and dismissal reasons that persist across audits.
- WHY USERS VALUE IT: Catches packaging mistakes before publish, and the dismiss-with-reason history teaches the system the channel's conventions.
- VIDORA VERSION OF THE IDEA: A pre-publish "packaging score" for title/description/tags/thumbnail — advisory checklist with dismiss reasons stored per channel.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora's version will be YouTube-SEO-first (titles, tags, thumbnails, chapters) rather than GEO/AIO/AEO-oriented, surfaced in the publish sheet rather than a separate studio.
- IMPLEMENTATION STATUS: NOT IMPLEMENTED — no SEO/packaging review visible on Vidora's homepage. Confirm in Phase 0a.
- TEST STATUS: NOT TESTED

**AT-11 — Analytics learning loop (channel-history-relative, human-approved)**
- SOURCE: youtube-automation-agent — README "Close the performance loop" section
- FEATURE OBSERVED: Post-publish 24h and 7d snapshots evaluate CTR, retention, engagement, watch time, format, length, hook/title style against the channel's own history; learnings are proposed with evidence and confidence; pending or rejected recommendations never influence generation; approving one makes it a planning constraint for the next operator run; simulated data is never eligible for baselines.
- EVIDENCE: README documents the snapshot windows, the metrics evaluated, the "What the agent learned" view, and the rule that only approved learnings constrain future planning.
- WHY USERS VALUE IT: Strategy improves from the channel's own data instead of generic best practices — and the human-approval step prevents learning the wrong lessons.
- VIDORA VERSION OF THE IDEA: Post-publish analytics import (YouTube Analytics API) feeding per-channel learnings — e.g. "documentary hooks under 8 words outperform" — offered as opt-in planning constraints.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora will present learnings as studio insights cards with one-click adoption, tied to its scene/niche structure; AgentTube's is a headless operator loop.
- IMPLEMENTATION STATUS: NOT IMPLEMENTED — no analytics product visible on Vidora's homepage. Confirm in Phase 0a.
- TEST STATUS: NOT TESTED

**AT-12 — Controlled growth experiments (title/thumbnail A/B with stats discipline)**
- SOURCE: youtube-automation-agent — README "Prove a growth recommendation" section
- FEATURE OBSERVED: Draft experiment plans rotating approved title/thumbnail arms over 24–168h windows with minimum-impression floors; evaluates interval deltas only, requires a 95% evidence threshold with no retention regression; restores the control afterward; adopting the winner is a separate confirmation that then becomes an approved learning.
- EVIDENCE: README documents the arm windows, impression/click floors, the 95% threshold, inconclusive outcomes, control restoration, and separate winner-adoption confirmation.
- WHY USERS VALUE IT: Turns "which title is better" from gut feel into measured evidence, without risking the channel on unproven packaging.
- VIDORA VERSION OF THE IDEA: Built-in title/thumbnail test plans for published videos with automatic control restoration and results imported into channel learnings.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora will integrate experiments with its thumbnail generation (auto-creating variant arms) rather than requiring pre-made variants.
- IMPLEMENTATION STATUS: NOT IMPLEMENTED. Confirm in Phase 0a.
- TEST STATUS: NOT TESTED

**AT-13 — Outcome & ROI studio (KPI + budget + economics alignment)**
- SOURCE: youtube-automation-agent — README "Align the channel with outcomes and ROI" section
- FEATURE OBSERVED: Strategy carries a measurable primary outcome (views, watch hours, subscribers, engagement, estimated revenue) with target, window, monthly budget, and currency; the studio shows progress, net subscribers, known production costs, and ROI; missing data shows as "unavailable" rather than zero; reallocation proposals (toward better-performing pillars/formats) stay pending until approved.
- EVIDENCE: README documents the KPI/budget configuration, the ROI view with revenue/cost evidence, the explicit-unavailable treatment of missing data, and the pending-approval reallocation proposals.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora's version will be credit-spend-native (its own billing data) and visual-first, rather than a headless economics ledger.
- WHY USERS VALUE IT: Connects creative output to business outcomes and spend — the view a serious operator needs to decide where the next dollar goes.
- VIDORA VERSION OF THE IDEA: A channel dashboard showing render spend vs. YouTube performance per niche/format, with budget-aware suggestions.
- IMPLEMENTATION STATUS: NOT IMPLEMENTED. Confirm in Phase 0a.
- TEST STATUS: NOT TESTED

**AT-14 — Scene-aware retention analysis**
- SOURCE: youtube-automation-agent — README "Find the exact scene that lost viewers" section
- FEATURE OBSERVED: YouTube's 100-point audience-retention curve is mapped onto stored scene durations, showing per-scene drop-off, rewatch, strong-hold, and steady signals; snapshots stored separately for long-form and Shorts; scene findings become pending learning recommendations only after operator approval.
- EVIDENCE: README documents the retention-curve-to-scene mapping, the per-scene signal types, the read-only refresh from YouTube Analytics, and the API endpoint for stored evidence.
- WHY USERS VALUE IT: Pinpoints exactly which scene lost viewers — the most actionable diagnostic in video, directly informing the next script.
- VIDORA VERSION OF THE IDEA: Retention overlay on Vidora's scene plan — "scene 3 lost 40%," feeding the learning loop.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora owns the scene structure natively, so mapping is exact by construction rather than post-hoc alignment; presentation will be a scene timeline with retention coloring.
- IMPLEMENTATION STATUS: NOT IMPLEMENTED. Confirm in Phase 0a.
- TEST STATUS: NOT TESTED

**AT-15 — Audience engagement studio (comment intelligence + drafted replies)**
- SOURCE: youtube-automation-agent — README "Engage with your audience" section
- FEATURE OBSERVED: Comment sync every 4 hours (more often for fresh videos) with theme/sentiment/question classification; spam/scam/toxic comments quarantined (never auto-deleted); draft replies generated in the channel's voice wait in a queue for edit/approve (daily cap, default 50); recurring audience requests are mined into video ideas with comment permalinks as evidence (3+ commenters threshold).
- EVIDENCE: README documents the sync cadence, classification, quarantine policy, draft-reply queue with explicit confirmation, the posting cap, and audience-requested idea mining.
- WHY USERS VALUE IT: Turns the comment section into a content-research feed and a manageable engagement workflow instead of a chore.
- VIDORA VERSION OF THE IDEA: A comment-inbox view for connected channels: theme clusters, draft replies in the channel voice, and "audience requests" surfaced as video ideas.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora will tie requested ideas directly into its script pipeline (one click → draft script) rather than a separate operator planning step.
- IMPLEMENTATION STATUS: NOT IMPLEMENTED. Confirm in Phase 0a.
- TEST STATUS: NOT TESTED

**AT-16 — Publishing queue with schedule controls and fail-closed reconciliation**
- SOURCE: youtube-automation-agent — README reliability hotfixes + troubleshooting + automation schedule
- FEATURE OBSERVED: A publishing queue processed every 15 minutes (content publishes at its scheduled time, default next day 2 PM); Review Studio can reschedule, publish now, or delete a schedule without deleting content; if an upload may have reached YouTube without returning a video ID, the system requires channel reconciliation before another attempt.
- EVIDENCE: README documents the queue cadence, the reschedule/publish-now/delete-schedule controls, and the fail-closed reconciliation rule.
- WHY USERS VALUE IT: Reliable hands-off publishing with human override — and no duplicate uploads from ambiguous failures.
- VIDORA VERSION OF THE IDEA: Scheduled publishing queue for approved renders with publish-now/reschedule controls and duplicate-upload protection.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora will run this server-side against its credit/state system with a calendar view, rather than a localhost cron.
- IMPLEMENTATION STATUS: PARTIAL — Vidora advertises "publish straight to YouTube"; queue/scheduling controls not visible. Confirm in Phase 0a.
- TEST STATUS: NOT TESTED

**AT-17 — Production-readiness verified check**
- SOURCE: youtube-automation-agent — README "Verify production readiness" section
- FEATURE OBSERVED: A one-click check making small live text/narration requests, verifying YouTube channel access, creating and decoding a temporary MP4, validating queued uploads' metadata — never creating a real video; paid probes (image, video) are separate opt-ins; results persist with remediation steps; a blocking failure halts autonomous generation/publishing until a later run passes.
- EVIDENCE: README documents the probe steps, the opt-in paid checkboxes, the local persistence of results with remediation, and the blocking-failure behavior.
- WHY USERS VALUE IT: Catches broken keys, quota, and format problems before they burn money or stall a scheduled run — the "pre-flight" for automation.
- VIDORA VERSION OF THE IDEA: A "studio health check" verifying voice provider, image provider, stock keys, and YouTube connection with a test render, run automatically when keys change.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora will make this a visible settings-page widget with pass/fail per integration and one-click retest, integrated with its existing per-render cost preview.
- IMPLEMENTATION STATUS: UNKNOWN — Vidora shows cost before render but no readiness-check concept visible. Confirm in Phase 0a.
- TEST STATUS: NOT TESTED

**AT-18 — Local REST API with key-protected mutations**
- SOURCE: youtube-automation-agent — README "API" section
- FEATURE OBSERVED: Endpoints for health, job queueing/inspection/resume, readiness, operator strategy, experiments, outcomes, and content approval; mutating routes optionally protected by an API key header.
- EVIDENCE: README documents curl examples for `/generate`, `/api/jobs/:id/resume`, `/api/readiness/run`, `/api/operator/strategy`, `/api/experiments`, `/api/outcomes`, and content approve endpoints.
- WHY USERS VALUE IT: Enables programmatic and third-party integration — the product becomes a platform, not just a dashboard.
- VIDORA VERSION OF THE IDEA: A public Vidora API (queue render, check status, approve, publish) for power users and agency integrations.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora's API will be cloud-hosted with proper auth/scopes and webhook callbacks, rather than a localhost server with a shared key.
- IMPLEMENTATION STATUS: UNKNOWN — Vidora is a cloud app; API surface not publicly documented. Confirm in Phase 0a.
- TEST STATUS: NOT TESTED

**AT-19 — Extensibility: custom AI provider + custom content types**
- SOURCE: youtube-automation-agent — README "Extending" section
- FEATURE OBSERVED: Documented pattern for adding a custom text provider (any OpenAI-compatible endpoint, with an Anthropic example) and custom content types (duration/style/thumbnail config objects).
- EVIDENCE: README includes sketches for a custom provider class and for registering new content types in the strategy agent.
- WHY USERS VALUE IT: The tool adapts to new models and formats without waiting for the maintainer — important in a fast-moving model landscape.
- VIDORA VERSION OF THE IDEA: Provider/model selection per project stage (already partially there with voices/styles) plus custom format templates.
- HOW OUR IMPLEMENTATION WILL DIFFER: Vidora will expose this as user-facing settings (pick models per stage) rather than code-level extension, since it's a SaaS product for creators, not developers.
- IMPLEMENTATION STATUS: PARTIAL — Vidora has voice/style choice but not model/provider choice visible. Confirm in Phase 0a.
- TEST STATUS: NOT TESTED

### 7.3 UNVERIFIED — NEEDS MANUAL REVIEW

1. AgentTube runtime behavior — all findings come from the README and repo structure (text), not from running the code. Needs: clone, configure keys, run the walkthrough, exercise a full pipeline cycle plus the Review Studio UI.
2. AgentTube dashboard UI quality — the dashboard directory exists but its UI was not viewable via text fetch. Needs screenshots from a running instance.
3. The bundled audit's rule coverage and usefulness — described as advisory; needs a live run against sample content.
4. Experiment statistics validity — the 95% evidence threshold and interval-delta methodology are described but not validated; needs stats-expert review plus live experiment data.
5. All Vidora IMPLEMENTATION STATUS labels in this section — best-guess from the public homepage text fetch only; confirm in the Phase 0a audit.

---

## 8. Cross-product capability comparison

Legend: ✅ present/verified · ◐ partial or claimed-but-unverified · — not observed. Vidora column reflects the repo-inspected worker-1 findings (most reliable); competitor columns reflect public evidence gathered 2026-09-27.

| Capability | Vidora | TubeAccel. (+ecosystem) | TubeGen | Algrow | TubeAI | ShortForge | AgentTube |
|---|---|---|---|---|---|---|---|
| Niche / channel research DB | ◐ (outlier import only) | ◐ (TubeMagic niche explorer, Magic Score) | ✅ (Niche Finder → production) | ✅ (312k+ channels*, trends, folders) | ✅ (Hot Topics, 400M+ videos*) | — | ◐ (trend/competitor refresh in operator) |
| Outlier / viral-video discovery | ✅ (importOutliers, real YT API) | — | — | ✅ (outlier score per video) | ✅ (outlier-ranked ideas) | — | — |
| Trend discovery | — | — | — | ✅ (trends leaderboard, alerts) | ✅ (Hot Topics, micro-niche growth) | — | ◐ (operator refresh) |
| Smart folders / watchlists | — | — | — | ✅ (folders, folder-scoped trends) | ✅ (rule-based Smart Folders) | — | — |
| Script generation (retention-structured) | ✅ (scenes w/ hooks/beats/payoff) | ✅ (TubeMagic multi-LLM) | ✅ (3k–20k words, style-trained) | ◐ (scriptwriting tool, docs only) | ✅ ("in my voice", cited) | ◐ (text only) | ✅ (script agent) |
| Voiceover / TTS + cloning | ✅ (16 voices, no clone) | — | ✅ (8 langs + cloning) | ✅ (3 engines + cloning + free SRT) | — | — | ✅ (ElevenLabs→OAI→sim fallback) |
| AI visuals (image / video) | ✅ (10 styles, stills) | ✅ (VidAI: B-roll/AI images) | ✅ (Scene Builder + animation + avatars) | ✅ (Sora/Veo/Kling/Seedance + BYOK) | — | — | ✅ (hybrid: bounded clips + local fill) |
| Thumbnail studio | — (table exists, no UI confirmed) | ◐ (VidAI/TubeMagic generators) | ✅ (gen + A/B + presets) | ✅ (style mimicry + face swap) | ✅ (5-surface preview) | — | ✅ (thumbnail agent) |
| Video assembly / editor | ✅ (FFmpeg.wasm mux) | ✅ (VidAI timeline editor) | ✅ (pre-assembled timeline, ≤30 min) | — | ◐ (Remotion plugin, local) | — | ✅ (local assembly) |
| Shorts repurposing | — | ✅ (VidAI 60/90s) | — | ◐ (caption/watermark remover) | — | ✅ (campaign incl. short scripts) | ✅ (3-Short studio, 9:16) |
| YouTube publishing | ◐ (code, never live-tested) | — | — | — | — | — | ✅ (queue + fail-closed) |
| Scheduling / calendar | — | — | — | — | ✅ (calendar + share links) | ◐ (claimed, unverified) | ✅ (cron schedules) |
| Analytics / learning loop | ◐ (analytics page, YouTube sync) | — | — | — | ✅ (channel audit) | — | ✅ (24h/7d vs own history, approved learnings) |
| Scene-aware retention | — | — | — | — | ◐ (reads retention data) | — | ✅ (curve→scene mapping) |
| Title/thumbnail experimentation | — | ◐ (thumbnail testers, claimed) | ✅ (A/B testing) | — | ✅ (A/B decisioning) | — | ✅ (stats-disciplined experiments) |
| Comment intelligence | — | — | — | — | — | — | ✅ (sync, classify, draft replies, idea mining) |
| Monetization planning | — | ✅ (monetization-first curriculum) | ◐ (RPM signals in Niche Finder) | ◐ (CMS/MCN data) | — | — | ✅ (KPI/budget/ROI studio) |
| Brand voice / style profiles | — | — | ✅ (saved styles) | — | — | ✅ (brand profiles 1/5/20) | — |
| Approval / safety gates | ◐ (rights declaration, publish gates) | — | — | — | — | ◐ (agency approvals, claimed) | ✅ (fail-closed multi-gate) |
| Claim-level fact checking | — | — | — | — | ◐ (cited research) | — | ✅ (Evidence desk) |
| Checkpoint / resume | — | — | — | — | — | — | ✅ (per-stage checkpoints) |
| Per-scene repair | ◐ (regenerate/remove stills in editor) | — | ◐ (editable timeline) | — | — | — | ✅ (Scene Repair Studio) |
| MCP / API access | — | ✅ (VidAI MCP) | — | ✅ (MCP + 60+ REST) | ✅ (MCP connector) | — | ✅ (local REST API) |
| Chrome extension | — | ✅ (TubeMagic ext.) | — | — | ◐ (claimed, unverified) | — | — |
| Team / agency workspaces | ◐ (scaffolding in migrations) | — (course community) | ◐ (seats on upper tiers) | — | — | ◐ (claimed, unverified) | — |
| Credit billing w/ ledger | ✅ (per-minute ledger + auto-refund) | — (course: one-time $797) | ✅ (credit tiers, rollover) | ✅ (credits + top-ups) | ◐ (freemium, paid hidden) | ✅ (generation quotas) | N/A (self-host, own spend) |
| Cost transparency | ◐ (cost shown pre-render) | — | ✅ (typical $/min per plan) | ✅ (per-model credit table) | — | — | ✅ (paid-seconds caps) |
| Production-readiness check | — | — | — | — | — | — | ✅ (probe suite, blocking) |

\* Database-scale figures are vendor/third-party claims — see UNVERIFIED list.

**Coordinator reconciliation (worker-1 repo evidence vs. other workers' guesses):** Workers 2–4 assessed Vidora's IMPLEMENTATION STATUS from the public homepage only. Worker 1 (repo-inspected) confirms: research/outlier import is EXISTING (real YouTube API calls, not mocked); billing ledger is PARTIAL (wired, checkout gated); YouTube/Meta publishing is PARTIAL (code-complete, never live-tested); the render pipeline is PARTIAL (browser path coded, server worker undeployed); the caption "word-level" claim conflicts with the features page. All UNKNOWN statuses still require Phase 0a confirmation against the running app.

---

## 9. The 5 most valuable capability patterns worth reimplementing

Ranked by leverage for the creator-OS vision (independent implementations — patterns only, never copied code/copy/layouts):

**1. Outlier-scored research with a one-click handoff into scripting.**
Every mature competitor treats "what to make" as the highest-leverage decision: Algrow's per-video outlier scores and growth-sorted channel database, TubeAI's Hot Topics and Trending Formats, TubeGen's Niche Finder feeding straight into production. Vidora already has outlier import (V-8) — the missing piece is the *decision surface*: outlier scores, growth velocity, and trend signals presented as ideation cards with a one-click "draft script on this concept" action. This is the DISCOVER→VALIDATE→IDEATE third of the core loop and the single biggest gap between Vidora's render pipeline and a creator OS.

**2. Scene manifest + per-scene repair + checkpoint/resume.**
AgentTube's Scene Repair Studio (edit/reorder/lock/regenerate one scene, narration-only regeneration) and per-stage checkpoints, plus TubeGen's editable pre-assembled timeline. For Vidora this is a direct extension of the existing five-stage pipeline: every render keeps a durable scene manifest (script, voice, visual, timing, cost, rights, revision history); a failed or unsatisfying scene costs one scene's credits, not a full re-render; interrupted jobs resume from the first incomplete stage instead of restarting. This is also the strongest cost-control story for the credit model (Features 20–21 in the build brief).

**3. Approval-first safety gates + claim-level provenance (Evidence desk).**
AgentTube's fail-closed gates (no publish with missing/simulated/stale narration, unresolved factual claims, or unconfirmed media rights) plus its Evidence desk (every factual claim linked to a verified source or a reviewer waiver; synthetic-media disclosure carried into the upload). For Vidora's documentary/history niches this is the trust moat: a pre-publish checklist that is a *gate*, not a warning, and niche-aware claim review. It turns Vidora's existing rights-declaration honor system into enforced, auditable review (Feature 11 + 29 in the build brief).

**4. MCP / API surface for agents (platform play).**
Algrow's hosted MCP server + 60-endpoint REST API, VidAI's MCP video generation inside Claude/ChatGPT, TubeAI's Claude connector over a 400M-video database. The pattern is clear: the winners are making themselves programmable from inside the AI assistants creators already use. Vidora's version should expose the full creator-OS graph as typed MCP tools — research, ideate, script, voice, render, project status, publish — with credit gating, scoped keys, and audit logs (Feature 41). This is strategic, not just an integration: it makes Vidora the backend for other agents' video workflows.

**5. A conversational strategist grounded in a renderable pipeline.**
TubeAI's Hugo (five jobs: ideate → package → script → plan → audit) and AgentTube's Autonomous Channel Operator (declared strategy → editorial plan → production → learn). The pattern to take: a single conversational entry point whose every recommendation is *renderable* — "find my next video" ends in a Vidora project, not a chat answer. Vidora's differentiator here is grounding: unlike Hugo (research/advisory-first) or the Operator (headless), every suggestion flows into Vidora's own studio with real assets, real costs, and approval-first gates (Feature 10).

**Runners-up (strong, just outside the top 5):** stats-disciplined title/thumbnail experimentation with control restoration (AT-12, TG-7, TI-7); scene-aware retention mapping (AT-14); brand voice/style profiles bound to the render pipeline (SF-3, TG-4); comment intelligence mining audience requests into video ideas (AT-15); per-plan "typical cost per finished minute" transparency (TG-10).

---

## 10. Consolidated UNVERIFIED list — NEEDS MANUAL REVIEW

**Existing Vidora:** end-to-end render producing a playable MP4 (standing pre-launch rule, never demonstrated); 16-voice catalog end-to-end; YouTube publish (no test channel); Meta publish (zero live evidence); checkout round-trip (gated); research outlier import with real data (never exercised); `/status` live health; pricing page rate-card content (text fetch returned FAQ only).

**Tube Accelerator:** the /secretoffer page itself (fetch timed out); "AI Coaching" and "AI Matt" behavior (no public demo); TubeMagic current pricing details.

**TubeGen:** dashboard UX and onboarding (no public screenshots/docs; signup minimum $27, no refunds); character-consistency / voice-clone / animation quality (vendor claims only); whether any public API exists; testimonial revenue claims ($100k, $37.69 RPM, "monetized in 15 days") — marketing, not evidence.

**Algrow:** exact database scale (sources conflict: 312k+ channels / 18.7M+ videos vs "160,000+ Shorts channels"); Screenshot Finder in-app UX (behind login); dashboard UI beyond API docs.

**TubeAI:** paid plan names/prices (only Free tier public); Hugo's in-app behavior (behind signup); Chrome extension capabilities (store listing not fetched; an unrelated "TubeAI" extension exists — do not conflate); no public traffic/revenue/user figures.

**ShortForge:** live workspace behavior (only marketing page fetchable; preview is a static mock); feature completeness vs claims (templates, calendar, approvals, white-label); definition of one "AI generation" for billing.

**AgentTube:** runtime behavior (README-only research; needs clone + keyed run); dashboard UI quality (not viewable via text fetch); bundled audit rule coverage; experiment statistics validity (needs stats-expert review).

**Global:** all competitor IMPLEMENTATION STATUS values marked UNKNOWN or "best guess" must be confirmed in the Phase 0a audit against the running Vidora app. No revenue, traffic, or user-count figures were verifiable for any third-party product — treat all market-position claims as unknown.
