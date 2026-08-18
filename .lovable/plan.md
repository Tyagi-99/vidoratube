# Vidora AI — Production Pipeline, Round 1 (Priorities 1–6)

## What exists today (audit)

- Landing, pricing, features, contact pages + dark/light theme — keep as-is.
- Auth: email/password, `_authenticated` gate, `/studio` dashboard, `/admin` panel (users, renders, content, pricing, integrations, inbox).
- Backend tables: `profiles`, `user_roles`, `video_jobs`, `credit_ledger`, `integrations`, `site_content`, `pricing_plans`, `contact_messages`, `youtube_connections`.
- Pipeline today: one `video_jobs` row per video, stages planning → voiceover → visuals → render. Script + scenes from Lovable AI, TTS from Lovable AI, scene stills from Gemini, MP4 via Shotstack (needs a paid key), CapCut zip export, YouTube publish.
- Gaps vs. the spec: no per-scene table, no stock providers, no image styles / prompt engine, no visual bible, no scene editor, no owner role, no provider settings with test buttons, no usage tracking or source tracking, single hard-coded provider per capability.

## This round delivers

Owner access, projects + categories, Stock Mode (Pexels + Pixabay), Image Mode with style system, ElevenLabs voice, synchronized captions. Editing/rendering (browser ffmpeg.wasm), scene editor polish, analytics and Complete Video Mode land in round 2 — the schema and provider interfaces below are built now so round 2 does not require a rewrite.

### 1. Owner access
- New `owner` value in the role enum; owner bypasses credit checks and paywall logic, sees Advanced Controls.
- "Access as Owner" button on `/auth` posts to a server function that signs in with credentials read from backend secrets (`OWNER_EMAIL`, `OWNER_PASSWORD`) — never in client code. The owner auth user is created by migration with a hashed password; a "Change password" prompt appears on first owner sign-in.

### 2. Projects, scenes, providers (new tables)
- `projects` — title, topic, mode (`stock` | `image` | `video`), category, style preset (sleep / documentary / war-history), visual_style, language, duration_target, aspect_ratio, status, stage, visual_bible (jsonb), settings (jsonb: caption + audio mix config), owner-scoped RLS + grants.
- `scenes` — project_id, scene_number, narration, duration, visual_type (`STOCK_VIDEO|STOCK_IMAGE|AI_IMAGE|MAP|GRAPHIC|TEXT_ONLY`), visual_prompt, negative_prompt, search_query, asset_url, asset_source (provider, asset_id, source_url, creator, license, fetched_at), transition, motion_type, status, error.
- `voiceovers` — per-scene audio url, duration, characters, voice_id, model, cached hash so unchanged narration is never re-billed.
- `captions` — per-scene cue list with timings.
- `api_usage` — provider, operation, units, estimated_cost, project_id.
- `categories` seeded with the History/War/Sleep/Mystery/Geography/Nature/Educational/Travel taxonomy.
- Existing `video_jobs` stays intact so current studio cards, CapCut export and YouTube publish keep working; a project links to its job row for the render/publish step.

### 3. Provider abstraction
`src/lib/providers/` with one interface per capability and concrete adapters:
- `StockProvider` → `pexels`, `pixabay` (search photos+videos, paginate, rank, download, store attribution).
- `VoiceProvider` → `elevenlabs` (voices list, model select, speed/stability/similarity, preview, generate).
- `ImageProvider` → `gemini` (existing), pluggable second slot.
- `VideoProvider` → registry only; returns "Coming Soon" with no key, makes zero API calls.
- Every call wrapped in a shared client with timeout, bounded retry with backoff, provider-specific error messages, and a usage-log write.

### 4. Scene Director
Script → scenes → for each scene the AI classifies `visual_type`, writes 3–7 stock search keywords **and** an image prompt with negative prompt, composition, lighting, era, location. Stock Mode searches Pexels then Pixabay, ranks by orientation/resolution/keyword overlap, picks the best, caches the file into storage and records the source. When no stock result clears the quality bar, the scene falls back to `AI_IMAGE`. Every decision is manually overridable.

### 5. Image Mode
18-style selector (cinematic realistic → chalkboard → storybook) as a global project style with per-scene override. Style descriptors live in a config map, not hard-coded prompts. A project-level Visual Bible (era, characters, clothing, architecture, colour mood, recurring locations) is generated once and injected into every scene prompt for consistency. Single-scene regeneration only re-bills that scene.

### 6. ElevenLabs voice + captions
- Settings → Providers → ElevenLabs: masked key, voice picker (live list), model (default Flash v2.5), speed/stability/similarity, Test Voice button.
- Narration is split at sentence boundaries, generated per scene, duration measured from the returned audio, and scene lengths derived from real narration duration plus preset minimums (Sleep preset: 15–30 s).
- Captions generated per scene from narration + measured duration, in Sleep / Documentary / Dynamic styles with font, size, position, background, opacity and max-words-per-line settings. Exported as SRT and stored as cues for the renderer.

### 7. UI (reusing current Vidora design language)
- `/studio` gains the quick-create card (topic, mode, duration, language, aspect ratio, style) and a Recent Projects grid with open / duplicate / delete / regenerate.
- `/studio/projects/$id` — real stage progress (no fake percentages) and a scene-by-scene editor: preview, narration, visual, duration, visual type, regenerate / replace / edit prompt / change style / reorder / delete.
- Owner-only "Advanced Controls" drawer showing prompts, scene JSON, search queries, chosen media source, voice params, provider responses and estimated cost.
- Settings → Providers page with per-provider key status and Test buttons; unconfigured providers render "Provider not configured" instead of breaking, and demo output is labelled DEMO DATA.

## Technical notes

- The server runs on an edge runtime with no FFmpeg, so final MP4 stitching runs in the browser with ffmpeg.wasm (round 2). Until then a completed project exports the CapCut zip and the existing Shotstack path stays available if a key is present.
- Long work never blocks a request: each pipeline stage is its own server function driven by a client poller writing progress to the project row, so a refresh resumes cleanly.
- Keys required as backend secrets: `ELEVENLABS_API_KEY`, `PEXELS_API_KEY`, `PIXABAY_API_KEY`, plus `OWNER_EMAIL` / `OWNER_PASSWORD`. I'll request these through the secure secrets form after you approve.
- Cost control: stock is preferred over generation, images and voice segments are cached by content hash, unchanged scenes are never regenerated, and Complete Video Mode makes no provider calls while disabled.

## Out of scope this round

Basic editing engine and browser rendering (P7–8), analytics dashboard (P10), batch generation, Complete Video Mode implementation, thumbnail generator.
