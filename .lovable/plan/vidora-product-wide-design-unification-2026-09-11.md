# Vidora product-wide design unification

A presentation-led refinement that keeps every route, server function, form payload, upload, render pipeline, authentication action, database query, and integration unchanged. The result will make the marketing site and logged-in studio feel related but deliberately separate, in both light and dark themes.

## 1. Lock the design system

- Keep Manrope for UI/body, Sora for display, tight heading tracking, the film-grain overlay, border-led depth, compact control radii, tabular numerals, and the single sea-green accent.
- Translate the supplied dark and light palettes into the existing semantic theme tokens so shadcn controls, dialogs, menus, inputs, toasts, cards, and custom studio surfaces inherit them consistently.
- Keep dark as the default; update the existing theme initializer/provider to honor saved preference first, then system preference, and set the document theme before paint.
- Standardize the requested type scale, 8px spacing rhythm, 22px card padding, 14px form gaps, and the existing easing curve. No page-load animation or additional accent color.
- Verify muted text contrast on base, panel, and raised surfaces in both themes; keep the sea-colored global focus ring and 44px mobile targets.

## 2. Split marketing chrome from app chrome

- Keep the marketing header and footer on Home, Features, Pricing, Contact, Privacy, Terms, Auth, and password reset.
- Add one shared authenticated header for Studio, Projects, project detail, Script, Voiceover, Auto-edit, and Admin: `◎ Vidora`, Studio, Projects, actual credit count, theme toggle, and sign out. Preserve the existing admin entry for admins.
- Remove marketing Product/Pricing/Contact links and the marketing footer from authenticated screens.
- Replace Auto-edit’s independent `►` header with the shared app header while preserving its file-drop, reset, close, and generate handlers.
- Make active navigation explicit, add the requested compact mobile navigation, and add a restrained scrolled state that remains legible in light mode.
- Normalize route wrappers so each page has one `<main>` landmark without changing route nesting or destinations.

## 3. Remove the two generic visual tells

- Remove subsection eyebrows immediately above page-level H1s on Home, Features, Pricing, Contact, and Studio.
- Keep informative subsection labels such as “Inside a render” and “Questions.”
- Remove the accent-colored “on autopilot” span so the complete homepage headline uses one weight and color.
- Preserve the product demo, facts strip, creation-mode list, anatomy sequence, honest limitations, and restrained pricing highlight.

## 4. Strengthen public-page states

- **Home:** retain the current product demo as proof, facts, modes, and capability-led narrative; refine the header’s scrolled treatment in both themes.
- **Features:** preserve the numbered, sequential anatomy and its candid capability limits; avoid generic feature-card rewrites.
- **Pricing:** retain “Checkout is not live” and the border-only featured plan treatment.
- **FAQ:** keep the accessible accordion primitive, verify keyboard focus, and ensure only its intentional chevron is shown.
- **Contact:** preserve field names and `submitContactMessage` payload; add inline validation, persistent submitted state, visible request error with retry, and pending button feedback instead of relying only on a toast.
- **Auth/reset:** preserve `?next=`, sign-in, sign-up, reset email, and redirects; add per-field inline errors, `aria-invalid`/descriptions, and explicit pending labels while the existing requests run.
- **Privacy/Terms:** retain the plain-language text and apply only shared theme/spacing corrections.

## 5. Bring all creation modes to one studio standard

- Refine Script and Voiceover pages to match Auto-edit’s clear selection, selected-file, readiness, disabled, recovery, and cancel patterns without changing field values, validation, request bodies, callbacks, or upload behavior.
- Keep Auto-edit’s drop-zone interaction and disabled-until-ready behavior, but restyle it through the shared tokens and app chrome.
- Show queued, rendering, failed, and ready feedback from real mutation/job state only—no timers or fake successful renders.
- Preserve the browser-compose warning, final MP4 behavior, storage path, retry controls, CapCut export, download, preview, and YouTube publish actions.

## 6. Complete Studio and Projects states

- Keep Studio’s credit/render/plan summary and make its numbers tabular.
- Preserve the existing real video grid and project grid, improving poster framing, title, mode/format, duration/date, status text plus icon, and safe secondary actions.
- Keep loading skeletons, empty calls to action, failure messages, retry handlers, stalled-compose recovery, and destructive actions connected to their current handlers.
- Add reusable card/state fixtures for visual regression coverage so empty and populated layouts can both be reviewed without inserting fake database records or showing fabricated user data in production.
- On project detail, prioritize the actual media preview and group secondary settings while preserving autosave, generation, captions, voiceover, and publish behavior.

## 7. Accessibility and verification

- Audit images, icon-only controls, labels, dialog titles, keyboard access, focus visibility, status text, live updates, and mobile target sizes.
- Ensure color is never the only status signal and dynamic submission/render updates have appropriate live announcements.
- Capture before/after screenshots for public, auth, Studio, Projects, project detail, and all three creation modes at desktop and mobile widths, in both themes where practical.
- Run lint, typecheck, unit tests, production build, and focused interaction checks for navigation, theme persistence, auth validation, contact states, form submission, upload readiness, job states, preview/download/CapCut/publish, and sign out.
- Update `REDESIGN_CHANGELOG.md` with changed files, preserved contracts, baseline issues, verification results, and any intentionally unchanged behavior.

## Technical boundaries

- No new dependency is planned; the existing TanStack Start, Tailwind v4, shadcn/Radix, Lucide, and current theme provider cover the work.
- Preserve route strings, search parameters, exported names, component props, field names, server-function inputs, query keys, storage paths, and all integration behavior.
- Do not change backend schema, auth policy, billing, AI providers, rendering logic, or generated output behavior.
- Use semantic CSS tokens rather than hardcoded component colors, and retain the global reduced-motion handling.
