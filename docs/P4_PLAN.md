# P4 Plan: Studio v2 — Creative Upgrades

## Goal
Upgrade the studio's creative capabilities: visual styles, character
consistency, expanded voices (English-first), background music, and full asset
provenance. The studio can already render; P4 makes what it renders *good*.

## Scope

### 1. Visual style system
- Named style presets: cinematic, anime, photoreal, watercolor, cyberpunk,
  documentary, minimalist, 3D-render, vintage-film, neon-noir
- Each preset = image-gen prompt modifier + color grade hint + caption style
- Stored on project; applied to every scene's image prompt
- UI: style picker with visual previews (CSS gradients as stand-ins, no fake thumbnails)

### 2. Character consistency
- Character definition: name, reference image upload, description
- Reference image passed to image gen as character ref (where provider supports it)
- Character appears in scene prompts automatically ("featuring {name}")
- Store character_id on scenes; show character badge in timeline

### 3. Voice expansion (25+ voices, English-first)
- Extend voice list: 25+ voices across en/hi + major languages
- Hindi voices prioritized in the picker (user is English-first)
- Voice preview (short sample via TTS, cached)
- Per-scene voice override (dialogue scenes)

### 4. Background music
- Music track picker: mood-based (uplifting, tense, calm, epic, playful)
- Royalty-free source: **Jamendo API** (verified real API; Pixabay's API has NO
  music endpoint — images/video only. Corrected 2026-09-25 after verification.)
  Needs `JAMENDO_CLIENT_ID` (free tier). Honest empty state until connected.
- Auto-ducking under voiceover (FFmpeg sidechaincompress in both render paths)
- Volume + fade controls; license stored in provenance

### 5. Asset provenance
- Every generated asset records: source, provider, model, prompt, seed,
  license, cost, created_at
- Provenance panel per scene: "made with X, licensed Y"
- Export: provenance JSON alongside video download

## Data model (migration)
- `styles` (id, name, prompt_modifier, caption_style, preview_gradient)
- `characters` (id, user_id, name, description, reference_image_url)
- `voices` — extend existing voice config (check current schema first)
- `music_tracks` (id, title, mood, provider, url, license, duration)
- `assets` (id, user_id, kind, provider, model, prompt, seed, license, cost, url)
  — or extend existing asset tables; check first

## Constraints
- No fake previews: style thumbnails are CSS, labeled as such
- Music must be royalty-free with stored licenses (no copyrighted tracks)
- Character reference images: user-uploaded or AI-generated, stored in bucket
- All generations debit credits via existing paths
- i18n en/hi for all new UI

## UI
- Studio sidebar: Style, Character, Voice, Music sections
- Timeline scene cards show style/character/voice/music badges
- Provenance drawer per scene

## Deliverables
1. Migration(s)
2. `src/lib/styles.ts`, `src/lib/music.ts`, character/voice libs
3. Server functions (zod-validated, rate-limited)
4. Studio UI sections + timeline badges + provenance drawer
5. FFmpeg audio ducking in both render paths (browser .wasm + worker)
6. Tests: style prompt building, ducking filter construction, provenance
7. CHANGELOG entry

## Verification
- tsc clean, vitest green, build clean
- Style preset changes image prompts (unit test)
- Ducking filter produces valid FFmpeg args (unit test)
- Provenance recorded for a real generation (integration)
