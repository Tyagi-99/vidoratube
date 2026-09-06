# Vidora three creation modes

**Date:** 2026-09-06 (Asia/Calcutta)  
**Repo:** Tyagi-99/vidoratube  
**Entry points:** Studio **New video** and Projects **New project** → `ModeChooser` (all three modes).

---

## Modes

| Mode | `creation_mode` | UI | What it does |
|------|-----------------|----|----------------|
| **1 — Script to Video** | `script` (default) | `GenerateVideoDialog` / studio project + `RenderPanel` | Topic/script → plan → visuals → VO → captions → **muxed MP4** |
| **2 — Voiceover** | `voiceover` | `VoiceoverCreateDialog` + `VoiceoverEditorPanel` | Upload owned footage, declare rights, commentary + ElevenLabs VO, trim/mute, burn captions → **MP4** |
| **3 — Automatic Edit** | `auto_edit` | `AutoEditCreateDialog` + `AutoEditEditorPanel` | Upload video, target duration/aspect, heuristic keep-window trim + captions (optional VO) → **MP4** |

Mode 3 is a **heuristic MVP** inspired by AutoEditor ideas. **Do not vendor AutoEditor** into this repo.

---

## Output contract (all modes)

1. **Primary delivery:** validated **MP4** at `result_url` (storage signed URL).  
2. **Download helper:** `selectDownloadUrl` in `src/lib/jobs/final-video.ts` — returns `result_url` only; **never** falls back to `audio_url`.  
3. **Ready UI:** `FinalVideoPreview` (player + Download + CapCut package).  
4. **CapCut:** secondary export zip via `CapCutExportButton` when an MP4 (or assets) exist — not a substitute for MP4.

---

## Rights

Approved clearances (helpers in `src/lib/content/stages.ts`):

- `owned` · `licensed` · `permission_granted` · `public_domain`

Blocked: `do_not_use`, `permission_denied`. Unknown / requested statuses cannot render finals.

Mode 2/3 create dialogs default to **owned** for user uploads.

---

## Migrations to apply in Lovable / Supabase

Apply these SQL files in order (SQL editor or `supabase db push`) if not already applied on the project:

1. `supabase/migrations/20260906093000_content_workflow_foundation.sql` — PR2 spine: `niches`, `creators`, `creator_accounts`, `content_items`, `rights_decisions`, `content_assets`, `content_duplicate_flags`, `workflow_jobs`, `workflow_job_events`, `content_rights_approved()`.  
2. `supabase/migrations/20260906120000_mode2_voiceover_foundation.sql` — `projects.creation_mode` (`script` \| `voiceover` \| `auto_edit`) + **`owned`** on rights check constraints.  
3. `supabase/migrations/20260906140000_owned_rights_gate_fn.sql` — `content_rights_approved` includes **`owned`**.

Earlier foundation migrations under `supabase/migrations/202608*` should already be on production.

`src/integrations/supabase/types.ts` is synced for PR2 tables + `projects.creation_mode` + `content_rights_approved`.

---

## Env vars

See `.env.example`. Minimum for smoke:

| Var | Purpose |
|-----|---------|
| `SUPABASE_URL` / `VITE_SUPABASE_URL` | Project URL |
| `SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_*` | Client |
| `SUPABASE_SERVICE_ROLE_KEY` | Server fns |
| `LOVABLE_API_KEY` | Planning / Gemini images (Mode 1 quick) |
| `ELEVENLABS_API_KEY` | Mode 1 studio + Mode 2/3 VO |
| `PEXELS_API_KEY` / `PIXABAY_API_KEY` | Mode 1 stock visuals |
| `OPENAI_API_KEY` (optional) | Mode 2 commentary; falls back to Lovable/Gemini |

Optional: `SHOTSTACK_*`, `FAL_API_KEY`, `GOOGLE_OAUTH_*` (YouTube publish).

---

## Compose UX

Browser compose (ffmpeg.wasm) runs in the open tab. Copy should say the final **MP4** is being assembled locally — keep the tab open until Download appears. Resume via `ResumeComposeButton` when Mode 1 quick jobs stall on `client_render` / `preview`.

---

## Non-goals

- Vendoring AutoEditor source  
- YouTube download / DRM scrape  
- Treating CapCut zip or narration MP3 as the primary deliverable  
