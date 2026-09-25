# P2 Plan: Server Render Worker

## Goal
Move video rendering from browser-only FFmpeg.wasm to a resumable server-side
job system with native FFmpeg, keeping the browser path as fallback.

## Why
Browser rendering fails on long videos, phones, low-RAM devices, and closed tabs.
Server rendering is on the critical path to production.

## Architecture

### Job table (extend `video_jobs` or new `render_jobs`)
- `id`, `user_id`, `project_id`, `status` (queued|running|succeeded|failed|canceled)
- `progress` (0-100), `current_stage`, `checkpoint` (JSONB, resumable state)
- `aspect` (16:9|9:16|1:1), `output_url`, `error`
- `attempts`, `max_attempts` (≤2 retries)
- `created_at`, `started_at`, `completed_at`

### Worker (`worker/`)
- Node.js process, polls `video_jobs` for `queued` jobs (or Supabase Realtime)
- Claims job atomically (UPDATE ... WHERE status='queued')
- Downloads inputs from `generated-videos` bucket
- Runs native FFmpeg with progress parsing
- Uploads output, updates job, emits Realtime events
- Handles cancellation (SIGTERM → mark canceled)
- Checkpoint: on crash, job returns to `queued` with attempt increment

### Multi-aspect
- 16:9: 1920x1080, 9:16: 1080x1920, 1:1: 1080x1080
- Smart crop: center-crop inputs, pad if needed

### Word captions
- ASS subtitles with per-word timing (karaoke-style)
- Generated from script segments + TTS timing

### Realtime progress
- Client subscribes to `video_jobs` changes for its user
- Progress bar, stage label, cancel button

### Browser fallback
- Keep existing FFmpeg.wasm path
- UI toggle: "Fast (browser)" vs "High quality (server)"

## Constraints
- No new paid services; worker runs locally or on user's future VPS
- RLS: users only see their own jobs
- Signed URLs for inputs/outputs
- zod validation on job creation
- Rate limit job creation (abuse control from P1)

## Deliverables
1. Migration for job schema changes
2. `worker/` directory with README (how to run locally + VPS deploy notes)
3. Server functions for enqueue/cancel/progress
4. UI: render queue page with progress + cancel
5. Multi-aspect + word captions in both paths
6. Tests: job state machine, worker logic (mocked FFmpeg), RLS
7. CHANGELOG entry

## Verification
- `npx tsc --noEmit`, vitest, build all green
- Worker processes a test job locally end-to-end (real FFmpeg)
- Realtime progress observed in browser
- Cancellation works mid-render
