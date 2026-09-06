# PHASE 0 AUDIT — Vidora (vidoratube)

**Date:** 2026-09-06 (Asia/Calcutta)
**Repo:** Tyagi-99/vidoratube
**Live:** https://vidoratube.lovable.app/ (not E2E-exercised)
**Scope:** Phase 0 only. No Mode 2/3. No redesign.
**HEAD:** 0a7c4f935d1ba83f50426467db31117d8b4cd9de
**Branch:** main
**Report:** uncommitted

---

## Command results
- git pull OK
- tsc PASS
- build PASS
- vitest 27 PASS
- lint FAIL prettier
- no local env
- E2E not run
- tsc PASS
- build PASS
- vitest 27 PASS
- lint FAIL prettier
- eslint src 1083 prettier errors
- no local env
- E2E not run

## Mode 1 quick path
- plan: Lovable gemini
- VO: gpt-4o-mini-tts via Lovable NOT ElevenLabs
- visuals: Gemini images NOT Pexels
- compose: client_render to ffmpeg.wasm when no Shotstack
- captions: burn default ON; one cue per scene; not word-synced
- finalize: upload video.mp4 then finalizeVideoJob ftyp check
- preview/download only when completed plus result_url; CapCut secondary

## Mode 1 studio path
- stock: Pexels/Pixabay with AI fallback
- VO: ElevenLabs eleven_flash_v2_5
- captions: buildCues; RenderPanel burn default on
- separate browser render via renders.functions

## workflow_jobs vs video_jobs
- PR2 migration creates workflow_jobs; does not modify video_jobs
- runtime Mode 1 still uses video_jobs only
- types.ts lacks workflow_jobs; no app inserts into workflow_jobs
- content/stages.ts helpers only; no runner

## Env secrets expected vs local
- no local .env; only .env.example
- need: SUPABASE_URL PUBLISHABLE SERVICE_ROLE PROJECT_ID VITE_* LOVABLE_API_KEY PEXELS PIXABAY ELEVENLABS; optional SHOTSTACK FAL GOOGLE_OAUTH
- E2E min: Supabase + LOVABLE_API_KEY

## Working and verified
- git main at 0a7c4f9; tsc PASS; build PASS; vitest 27/27
- final-video unit contracts: download never audio; ready needs result_url
- quick path code wiring traced end-to-end statically
- caption burn-in code present; CapCut secondary when MP4 ready

## Implemented but unverified
- E2E quick generate; real caption frames; studio full pipeline
- Shotstack; ResumeCompose; ffmpeg __l5e wasm off-Lovable; YouTube OAuth
- PR2 tables applied on production Supabase
## Broken
- lint fails
- no local env for E2E
## Incomplete
- workflow_jobs unused
- quick path no stock or ElevenLabs
- caption quality; types lag PR2
## Legacy
- renderPlaceholders BigBuckBunny
- Shotstack optional; CapCut secondary package
## Missing config
- entire local .env absent
## Risks
- long-lived signed URLs
- browser compose fragility
- Lovable wasm asset proxy dependency
## Phase 1 gaps priority
1. P0 E2E validate quick MP4 with burned captions
2. P0 ensure ffmpeg.wasm loads reliably
3. P0 document min secrets for smoke
4. P1 caption quality VO-aligned cues
5. P1 clarify quick VO vs ElevenLabs
6. P1 stock on quick generate if required
7. P1 lint hygiene ignore wasm
8. P2 sync Supabase types with PR2
9. P2 keep CapCut secondary
10. P2 remove BigBuckBunny placeholder
11. P3 workflow_jobs runner later
## AutoEditor note Phase 3 only
1. Local offline stills plus VO assembler Next.js plus Node backend
2. Dual engines browser ffmpeg or WebCodecs and native ffmpeg-static SSE
3. First-class burned captions shared preview and server styles
4. Timeline transitions match preview to export; sample-test assets
5. Termux Android distributable; not integrated into Vidora
## Non-actions
- No Mode 2/3; no redesign; report uncommitted; no secrets
