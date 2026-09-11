# Redesign changelog

Presentation-only redesign toward a cinematic, editorial product surface.
No routes, server functions, queries, mutations, form field names, payloads,
auth gates, storage paths, or integrations were changed.

## Baseline

- `bunx vitest run` — 12 files, 70 tests passing
- `bunx tsgo --noEmit` — clean

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
- Hero reworked with an editorial eyebrow, tighter measure, rule under the
  proof points, and stats presented as a bordered `dl` strip instead of a card grid.

## Deliberately unchanged

Creation dialogs' inputs and submit handlers, compose pipeline
(`useComposeJobMp4`), YouTube publish flow, admin role gate, pricing data,
Supabase clients and policies.
