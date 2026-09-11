# Redesign changelog

Presentation-only redesign toward a cinematic, editorial product surface.
No routes, server functions, queries, mutations, form field names, payloads,
auth gates, storage paths, or integrations were changed.

## Baseline

- `bunx vitest run` — 12 files, 70 tests passing
- `bunx tsgo --noEmit` — clean
- `bun run lint` — existing repository-wide formatting debt: 2,180 findings

## Changed

### `src/styles.css`
- Dark theme retuned to a deep graphite canvas (`oklch(0.135 0.004 265)`) with warm
  off-white ink and higher-contrast muted text (AA-compliant secondary copy).
- Added elevation tokens `--elev-1` / `--elev-2` for both themes; depth now comes
  from contrast and shadow rather than gradients.
- Global `:focus-visible` ring, `::selection` tint, `text-wrap: pretty` on body copy,
  tightened display letter-spacing.
- New utilities: `elevate-1`, `elevate-2`, `rule-label` (editorial eyebrow).
- `surface-card` now transitions border, shadow and transform over 200ms ease-out.
- `prefers-reduced-motion` handling retained.

### `src/routes/__root.tsx`
- Header: full-width sticky bar with backdrop blur, underline active states,
  and a persistent primary creation action (`New video`) for signed-in users.
- Mobile navigation uses 48px touch targets and closes on navigation.
- Footer restructured into a brand column plus labelled link groups.
- Route destinations, theme toggle, and session behavior unchanged.

### Product-wide unification — September 11, 2026
- Added a dedicated authenticated header with Studio, Projects, live credits,
  theme controls, sign out, admin access, and persistent New video access.
- Kept marketing navigation and footer on public pages only.
- Unified Auto-edit with the authenticated product shell while preserving file
  selection and generation callbacks.
- Preserved Manrope/Sora, film grain, border-led hierarchy, tabular numerals,
  and the single sea accent in both themes.
- Removed page-level kickers and the split-color homepage headline.
- Added inline accessible validation and visible request recovery to sign-in,
  password reset, contact, script, and voiceover creation surfaces.
- Added an explicit Projects failure state with a working retry action.
- Focused changed-file lint passed with one existing Fast Refresh warning.
- Unit tests passed: 12 files and 70 tests. Production build passed.

### `src/routes/_authenticated/studio.tsx`
- Split into a page header band (identity, actions, credit/plan/render stats)
  and a library section.
- Library cards now lead with a 16:9 poster, status chip, title, format/voice
  metadata and created date; all existing actions (Play, Download/Audio, CapCut,
  Publish, Delete, Resume compose) keep the same handlers and order of intent.
- Loading uses card-shaped skeletons; error state exposes the real message with a
  retry wired to `jobs.refetch()`; empty state offers the three real creation modes.
- All server functions, query keys and mutations untouched.

### `src/routes/index.tsx`
- Hero reworked with a tighter measure, restrained headline, rule under the proof
  points, and stats presented as a bordered `dl` strip instead of a card grid.

## Deliberately unchanged

Creation dialogs' input names and submit handlers, compose pipeline
(`useComposeJobMp4`), YouTube publish flow, admin role gate, pricing data,
Supabase clients and policies.
