# PHASE 3 — AutoEditor investigation & Vidora Mode 3 integration plan

**Date:** 2026-09-06 (Asia/Calcutta)  
**Repo:** Tyagi-99/vidoratube  
**Reference clone (read-only):** `/home/tyagi/projects/_refs/autoeditor`  
**Upstream:** https://github.com/codewithsiddique-04/autoeditor (shallow)  
**Scope:** Investigation + integration strategy. No AutoEditor source vendored into Vidora.

---

## 1. What AutoEditor is

AutoEditor is a **local, offline “story → video” assembler**:

- Drop **timestamped stills / video clips** + a **voiceover audio** file (+ optional transcript).
- Build a timeline that covers the audio duration from filename timestamps (`0-04.png` → clip at 4s).
- Preview on canvas; export MP4 with transitions, Ken Burns, fades, burned captions.
- Ship as a **Next.js 14 UI** plus a **Node/Express render backend** (also packaged for desktop / Termux).

It is **not** a cloud SaaS product and is **not** designed as an embeddable library for a multi-tenant web app like Vidora.

---

## 2. Architecture

| Layer | Stack | Role |
|--------|--------|------|
| UI | Next.js 14 App Router (`app/page.js`), React 18 | Dropzone, projects home, Editor + Timeline |
| Client helpers | `lib/*.js` | Timeline build, captions parse/draw, transitions, WebCodecs spike, IndexedDB project store |
| Client → server bridge | `lib/serverRender.js` | Multipart POST + SSE progress + blob download |
| Render backend | `server/` Express + multer + `ffmpeg-static` | Native ffmpeg filtergraph → `output.mp4` |
| Alt browser path | `lib/webcodecsRender.js` + `mp4-muxer` / `mp4box` | GPU WebCodecs encode (spike; captions/audio incomplete historically) |
| Packaging | `build-dist*.mjs`, GitHub Actions mac build | Static `out/` + bundled ffmpeg for Win/Mac/Termux |

**Data flow (server render):**

1. Browser builds `{ clips, width, height, fps, transitions, captions, … }` spec.
2. `POST /render` multipart: `spec` JSON + `audio` + one file per clip name.
3. Backend writes job dir under OS temp, runs `buildRenderPlan` → ffmpeg, streams progress via SSE.
4. Client fetches `/render/:id/file` as Blob; backend may also auto-save under `~/Downloads/AutoEditor`.

**Input model:** audio-driven timeline from **timestamped media filenames**, not “upload one long video and auto-cut silence.” Gap clips are first-class (lead-in / removed slots → black).

**Output:** H.264/AAC MP4 (`libx264` or hardware encoders when detected).

---

## 3. Dependencies & runtime

**Frontend (`package.json`):**

- `next`, `react`, `react-dom`
- `@ffmpeg/ffmpeg`, `@ffmpeg/core`, `@ffmpeg/util` (legacy / fallback path; primary export moved to native server)
- `mp4-muxer`, `mp4box` (WebCodecs path)

**Server (`server/package.json`):**

- `express`, `cors`, `multer`, `ffmpeg-static`
- Vitest for `buildRenderPlan` unit tests

**Runtime characteristics:**

| Concern | AutoEditor | Vidora today |
|---------|------------|--------------|
| Primary runtime | Local Node process + browser | TanStack Start / Vite on Lovable (server fns + browser ffmpeg.wasm) |
| FFmpeg | Native `ffmpeg-static` (preferred); wasm historically | Browser `@ffmpeg/ffmpeg` (+ optional Shotstack) |
| Persistence | IndexedDB projects + local Downloads | Supabase projects + storage |
| Multi-tenant | Single-user local app | Auth + credits + shared hosting |
| Deploy to Lovable | **Poor fit** — needs long-running native ffmpeg process, large binaries, temp disk, SSE jobs | Already constrained to serverless-ish + client compose |

---

## 4. FFmpeg needs

- Filtergraphs: scale/pad, `xfade` transitions, Ken Burns `zoompan`, caption `drawtext` (font file), audio `afade` / `atempo`.
- Graph often written to a **filter script file** (Windows cmdline length).
- Resource knobs: `RENDER_THREADS`, `RENDER_NICE`, `RENDER_ZOOM_SS`, `FORCE_ENCODER`.
- Single active job at a time (phone-friendly).

Vidora Mode 1/2 already compose in-browser with ffmpeg.wasm (`browser-render`, `voiceover-compose`). Mode 3 should **reuse that path**, not introduce a native ffmpeg sidecar on Lovable.

---

## 5. I/O contract (useful ideas, not copy)

**Render spec shape (conceptual):**

```json
{
  "clips": [{ "name": "s3", "start": 0, "duration": 5, "gap": false }],
  "width": 1920, "height": 1080, "fps": 30,
  "transitions": ["cut", "fade"],
  "transitionDuration": 0.4,
  "fadeIn": 0.5, "fadeOut": 0.6,
  "captions": [{ "start": 0, "end": 3, "text": "..." }],
  "captionStyle": "classic", "captionSize": "md"
}
```

**Endpoints:** `GET /health`, `POST /render`, `GET /render/:id/events` (SSE), `GET /render/:id/file`, `POST /render/:id/cancel`, `GET /status`.

For Vidora, map this to an **in-process provider plan** (`segments` + `cues` + trim) consumed by existing browser compose — not a separate Express service.

---

## 6. Licensing (blocker for option A)

LICENSE is **“AutoEditor — Non-Commercial License”** (TryAIToday / codewithsiddique-04, 2026):

- Personal / educational / non-profit hobby use allowed.
- **Commercial use prohibited**, including paid products, subscriptions, or paid services built on or incorporating the software (original or modified).
- Redistribution must keep LICENSE and stay non-commercial.
- Commercial license: contact via Discord (see LICENSE).

**Implication for Vidora (commercial / paid plans):**

- **Do not vendor, copy, or ship AutoEditor source** (UI, server, filter builders, caption styles, WebCodecs renderer, etc.).
- **Do not** fork their Next app into Lovable.
- Safe: learn **high-level patterns** (adapter interface, SSE job UX, rights-gated upload-first intake) and implement **Vidora-native** code under Vidora’s own license.
- Future: if product wants their exact engines, negotiate a **commercial license** and still prefer an adapter boundary over a wholesale embed.

---

## 7. Security & product risks

| Risk | Detail | Mitigation |
|------|--------|------------|
| License infringement | Shipping their code in a paid SaaS | Strategy B only; no vendoring |
| Untrusted uploads | Local app trusts user’s files; cloud multi-tenant does not | Keep Vidora rights gate + user-scoped storage paths |
| Native ffmpeg on shared host | Process spawn, disk, DoS | Avoid on Lovable; client compose or future dedicated worker |
| CORS / open upload API | Their server is localhost-oriented | N/A if not deployed |
| Filename timestamp convention | Fragile for casual users | Mode 3 accepts a **single video upload**, not timestamped still packs |
| YouTube / DRM scrape | Not AutoEditor’s model; Vidora already forbids | Keep upload-first + metadata-only URL |

---

## 8. Deployment options for Lovable / Vidora

| Option | Feasible? | Notes |
|--------|-----------|-------|
| Embed Next AutoEditor app in Vidora | **No** | License + stack mismatch + local assumptions |
| Run their Express render as Lovable sidecar | **No** (v1) | Native binary, long jobs, not Lovable-friendly |
| Separate paid worker VM calling licensed AutoEditor | Future only | Needs commercial license + ops |
| **Vidora-native Mode 3** via `AutomaticEditingProvider` + existing browser compose | **Yes** | Chosen path |
| Optional later: Shotstack / cloud render for Mode 3 plans | Maybe | Same provider interface |

---

## 9. Recommended integration strategy

### Decision: **Strategy B — Vidora-native auto-edit MVP**

Implement Mode 3 behind an **`AutomaticEditingProvider`** interface. First implementation: **heuristic trim / keep window** toward target duration, optional captions + optional VO, compose through **existing** `voiceover-compose` / FinalVideoPreview pipeline.

**Do not** copy AutoEditor modules. Optionally later swap provider to a commercially licensed AutoEditor-backed worker without changing UI.

### Adapter sketch

```ts
interface AutomaticEditingProvider {
  id: string;
  label: string;
  plan(input: AutoEditPlanInput): Promise<AutoEditPlan>;
}

// AutoEditPlan → trim window + segment list + caption cues hints
// Compose: browser ffmpeg (today) using Mode 2 compose primitives
```

### Server vs client

| Step | Where |
|------|--------|
| Create project / rights / settings | Server fns (like Mode 2) |
| Plan edit (heuristic) | Pure TS (client or server) — provider |
| Optional AI script / ElevenLabs VO | Existing Mode 2 server helpers (optional toggle) |
| MP4 encode | **Client** ffmpeg.wasm (shared with Mode 2) |
| Finalize + signed URL | Server fn + FinalVideoPreview |

### Reuse vs not copy

| Reuse from Vidora | Do **not** copy from AutoEditor |
|-------------------|----------------------------------|
| ModeChooser / project `creation_mode` | `server/render.js` filter builders |
| Rights gate (`canRenderFinal`) | Caption style presets / drawtext chains |
| Upload → Supabase storage | Timeline-from-filename logic |
| `composeVoiceoverVideo` | WebCodecs spike / IndexedDB project store |
| FinalVideoPreview | Next UI, Express SSE server, packaging scripts |
| Mode 2 duration presets | Transition / zoompan implementations |

---

## 10. MVP Mode 3 scope (Phase 4)

**In scope:**

1. ModeChooser → **Automatic Edit**.
2. Create dialog: upload video, rights, target duration, aspect, toggles for **captions** and **optional VO**.
3. `AutomaticEditingProvider` + `HeuristicAutomaticEditingProvider` (center/start keep-window to hit target duration; stub hooks for future silence/scene detection).
4. Editor panel: review plan, optional script/VO when enabled, **Render** → upload MP4 → `FinalVideoPreview` + download.
5. Rights gating identical to Mode 2.
6. Provider contract tests + creation_mode `auto_edit` coverage.
7. **Do not break** Mode 1 (script) or Mode 2 (voiceover).

**Out of scope / stubs for later:**

- Real silence detection / scene-change ML.
- AutoEditor-backed provider (needs license).
- Native server ffmpeg worker.
- Timestamped still-pack workflows.
- Full WebCodecs export path.

---

## 11. Phase 4 implementation checklist

- [x] This investigation doc
- [x] `src/lib/mode3/` provider + heuristic plan + server fns
- [x] UI: ModeChooser, create dialog, editor panel, studio/project wiring
- [x] Tests; PR `feat/mode3-auto-edit`; merge

---

## 12. Summary recommendation

**Do not embed AutoEditor.** Treat it as an external reference whose **product ideas** (timeline plan → burn captions → MP4) inform Vidora Mode 3, while all shipped code remains Vidora-native and license-safe. Prefer one PR that lands this doc plus a usable Mode 3 MVP behind `AutomaticEditingProvider`.
