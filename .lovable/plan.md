# VidoraTube visual redesign — editorial, cinematic, product-led

A presentation-only upgrade. No pipeline, route, payload, auth, or data change. Every existing button keeps its handler; only its look, spacing, states and layout change.

## Working-pipeline inventory (must stay identical)

| Area | Files | Contract preserved |
| --- | --- | --- |
| Routes | `src/routes/**` | Same paths, same `createFileRoute` strings, same `search` params (`?create=script`, `/auth?next=`) |
| Auth gate | `_authenticated/route.tsx`, `auth.tsx`, `reset-password.tsx` | Sign in/up, guest access, reset email flow, redirect targets |
| Job pipeline | `jobs.functions.ts`, `studio.functions.ts`, `render.server.ts` | Plan → narrate → stills → compose, unchanged |
| Browser render | `render/useComposeJobMp4.ts`, `browser-render.ts`, `ffmpeg-worker.ts` | Compose, storage upload path, `finalizeVideoJob` |
| Projects/scenes | `projects.index.tsx`, `projects.$projectId.tsx`, `mode2/`, `mode3/` | Editors, autosave/save behaviour |
| Integrations | `youtube.functions.ts`, `YouTubePanel`, `CapCutExportButton`, providers | OAuth, upload, ZIP export |
| Admin | `_authenticated/admin.*` | All mutations and role gate |
| Public data | `public.functions.ts` | Pricing, content, contact form fields |

Baseline first: run lint, typecheck, `vitest run`, and a production build, and record failures in the changelog before any edit.

## Design direction

- **Canvas:** dark-first. Deep graphite near-black surfaces with warm off-white text; the existing light theme is retuned to a warm paper neutral, not removed. The theme toggle stays.
- **Accent:** keep the current teal/mint brand accent as the single controlled accent for focus, progress and primary actions. No violet, no rainbow gradients.
- **Type:** existing Sora display + Manrope UI, retuned scale — larger, tighter titles; 15–16px body with generous line height; no faint micro-copy.
- **Depth:** contrast, hairline borders and one soft shadow tier. No glassmorphism, no blobs, no pill overload.
- **Motion:** 150–250 ms ease-out on hover/focus/enter only; existing `prefers-reduced-motion` block already handles reduction.

## Screen-by-screen

1. **App shell** — replace the floating pill header with a calm, full-width bar: wordmark, nav with explicit active state, theme toggle, account menu, and a persistent primary "New video" action. Mobile becomes a proper sheet-style nav with 44px targets. Footer is trimmed and aligned to a real column grid.
2. **Studio (library)** — recent work becomes the hero: a responsive card grid with poster/first-still, title, status chip, updated time, duration, and a quiet overflow menu holding Play / Download / CapCut / Publish / Delete. Same click targets, same routes, same dialogs.
3. **Creation flow** — `GenerateVideoDialog`, `VoiceoverCreateDialog`, `AutoEditCreateDialog` get a staged, studio-like layout: clear section headers, visible selected options, progress feedback during submit, inline validation and an obvious cancel. Identical field names, validation and submit handlers.
4. **Project / editor pages** — media preview promoted to the top of the layout; scene list and settings grouped in a secondary column; save/publish state made visible. No change to autosave or mutations.
5. **States** — first-class empty, loading (skeletons), error and permission screens across studio, projects and admin, wired to the existing messages and retry handlers.
6. **Public pages** — home, features, pricing, contact rewritten around what the app actually does (script → narration → stills → captions → 1080p MP4 in the browser). One strong product demonstration instead of a headline-plus-three-cards block. No invented metrics, logos or testimonials.
7. **Admin** — denser table/list treatment, consistent headers, same actions.

## Engineering approach

- Tokens and shell first (`src/styles.css`, `__root.tsx`), then shared primitives (button/card/badge/dialog/input variants via existing `cva`), then page composition. Small, reviewable steps with typecheck plus targeted tests after each.
- Presentational-only edits; where logic and markup are entangled, wrap the unchanged logic in a presentational component rather than moving the logic.
- No new dependencies — Tailwind v4, shadcn, lucide and `tw-animate-css` cover everything.
- Accessibility: semantic landmarks, `:focus-visible` rings, labelled controls, accessible dialog titles, alt text, WCAG AA contrast in both themes.
- Add targeted regression tests for touched flows that lack them: route render, submit payload shape, primary mutation invocation, success/error/loading states, auth gate.
- Desktop and mobile screenshots before and after for `/`, `/pricing`, `/features`, `/contact`, `/auth`, `/studio`, `/projects`, a project detail page and `/admin`.
- `REDESIGN_CHANGELOG.md` records changed files, visual changes, unchanged contracts, tests run and baseline failures.

## Out of scope

Backend, schema, env vars, payment configuration, framework changes, and deleting existing code paths.
