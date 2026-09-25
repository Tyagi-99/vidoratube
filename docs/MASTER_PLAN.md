# VidoraTube (Vidora AI) — A-to-Z Audit + Master Build Plan

> Source: audit + master build prompt provided 2026-09-25. This is the product/engineering
> roadmap. Phases are executed one at a time (P0 first). Positioning: "The AI YouTube
> studio built to keep your channel monetized."

## Audit findings (A1–A18)

| # | Area | Finding | Sev |
|---|------|---------|-----|
| A1 | Rendering | Final render runs in user's browser (FFmpeg.wasm), "keep the tab open". Long videos/phones/low-RAM/closed tabs fail. | 🔴 |
| A2 | Unit economics | 1 credit per video regardless of length. 10 free credits = ten 30-min ElevenLabs videos. Abuse/cost bomb. | 🔴 |
| A3 | Abuse | Free credits, no card, no disposable-email/IP/device limits → farms drain AI budget. | 🔴 |
| A4 | YouTube policy | Homepage pushes finance recaps / AI-narrated content. YouTube Jul 2026 YPP clarification won't monetize generic template content or AI personas on finance/legal/health. | 🔴 |
| A5 | Payments | Checkout not live. Founder in India, Stripe invite-only. | 🔴 |
| A6 | YouTube OAuth | youtube.upload scope needs Google verification; unverified apps capped; Data API quota small; publish E2E unverified. | 🔴 |
| A7 | Captions | Sentence-level, not word-sync karaoke. Table stakes for Shorts. | 🟠 |
| A8 | Formats | 16:9 1080p only. No 9:16 Shorts/Reels/TikTok. | 🟠 |
| A9 | Languages | EN/ES/FR only. Hindi missing (home market). ElevenLabs supports Hindi. | 🟠 |
| A10 | Top of funnel | No research tools (niche finder, outliers, titles, thumbnails). Starts at "paste a script". | 🟠 |
| A11 | Pricing page | To a crawler: no plan cards, no FAQ answers — client-side only or accordions don't SSR. Bad for SEO/AI-search. | 🟠 |
| A12 | Trust | No demo video, no sample outputs, no gallery. | 🟠 |
| A13 | Brand/domain | hello@vidora.ai but app on *.lovable.app. Confirm domain ownership + trademark. | 🟠 |
| A14 | Footage/music rights | FAQ "where do footage/music come from?" must name licensed sources; every asset needs licence record. | 🟠 |
| A15 | Observability | No error tracking, product analytics, render success metrics, cost-per-video. | 🟠 |
| A16 | Test coverage | 124 unit tests, no E2E (signup → render → download → publish), no test account. | 🟠 |
| A17 | Mobile | Never checked visually. | 🟡 |
| A18 | Security | Verify RLS on all tables, service-role never in client, bucket policies, tokens encrypted, host-guard allow-list check. | 🔴 until verified |

## Competitor takeaways

- **TubeGen.ai** ($149–849/mo): steal 7-step flow, style replication, character consistency, custom style training, art presets, auto chapters/hashtags. Skip $149 entry + income claims.
- **Algrow** ($25–80/mo, credits never expire): steal outlier tracker, niche finder, similar-channel finder, multi-model hub, credits-never-expire, MCP/API. Skip watermark removal, cheapest-pitch.
- **TubeAI.app** (free tier): steal AI strategist chat, channel audit, outlier multiplier, ideation boards, free-forever tier. Skip building 212M-video DB day one.
- **AgentTube** (OSS): steal research→publish→learn loop, human approval gate, 24h/7d snapshots, resumable checkpoints. Skip unattended auto-publish (demonetization pattern).
- **ShortForge** (OSS): steal word-level subtitles, R128 loudness, hook scoring, pre-publish compliance gate, cost guards. Skip over-engineering.
- **Tube Accelerator**: steal education+community for retention. Skip hidden pricing.

**Wedge:** *"The only AI YouTube studio built to keep your channel monetized."* Hindi + INR first-class, start at $19 vs TubeGen $149+.

## Phase order (rough effort, 1 senior eng + AI tools ≈ 4–5 months)

P0 audit 1–2wk → P1 hardening 1–2wk → P2 server render worker 2wk → P3 research/idea engine 2–3wk → P4 studio v2 3wk → P5 thumbnails/SEO/publish 2wk (+Google verification, start week 1) → P6 safety score 1–2wk → P7 billing/payments 1–2wk → P8 analytics 2wk → P9 growth/SEO/Hindi 2–3wk → P10 launch 1–2wk.

Critical path: P2, P7, Google verification (P5).

## Non-negotiable rules (from master context)

1. Keep stack (React+TS strict+Tailwind+shadcn, Supabase/Lovable Cloud, Lovable AI gateway, ElevenLabs). Incremental, build stays green.
2. RLS everywhere, service-role server-only, signed URLs, zod on edge functions, rate limits, AES-256-GCM token encryption.
3. One metering function: check → reserve → call → record cost → commit/refund. Append-only ledger, idempotency keys.
4. >10s work = jobs table (queued|running|succeeded|failed|canceled), progress, retries ≤2, resumable, tab can close.
5. Provider abstractions with primary+fallback; provider+model stored per asset.
6. Asset provenance (source, licence, model, prompt, cost) on everything.
7. No fake features; label betas.
8. WCAG 2.2 AA, responsive 375/768/1280/1920.
9. LCP <2.5s marketing, code-split studio, lazy FFmpeg.wasm (preview only), AVIF/WebP.
10. Sentry + PostHog typed events + /status page.
11. i18n from day one (en, hi first).
12. YouTube API ToS, Google OAuth verification, GDPR + DPDP Act 2023, synthetic disclosure.
13. Plan before each phase, tests after, CHANGELOG.md, never mark unverified work done.
