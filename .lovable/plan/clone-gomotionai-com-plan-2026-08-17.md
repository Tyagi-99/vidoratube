# Clone gomotionai.com — Plan

## Goal
Recreate the gomotionai.com landing page as a functional, interactive mockup that looks and behaves like the original, while keeping the scope realistic for a learning/demo project. The actual AI video-generation backend is not rebuilt; instead, the app simulates the user-facing flow (enter script, pick options, see a "generating" state, receive a sample video result).

## What the source site is
GoMotion is a single-page marketing site for an AI text-to-video service for YouTube creators. It uses a dark, premium design with sections: hero, 3-step process, virtual "editing crew" breakdown, feature cards, results gallery, pricing tiers, FAQ accordion, and a final CTA. The navigation is minimal and the page relies on large typography, gradient accents, and screenshots/video thumbnails for impact.

## Scope

### In scope
- Pixel-faithful clone of the landing page sections, layout, typography, and visual rhythm.
- Reuse of the original site's real assets (thumbnails, result cards, favicon) where URLs are available and publicly fetchable; generate or fall back to placeholders only if an asset is missing or protected.
- Interactive landing-page behaviors: sticky navigation, smooth scroll/section reveals, FAQ accordion, pricing hover states, and CTA buttons.
- A mock "generate video" flow: a script input form, voice/format selectors, a progress/queue animation, and a fake finished-video result card.
- Separate route-based pages for key sections (Home, Pricing, Features, Contact/Enterprise) to match TanStack Start routing best practices.

### Out of scope
- Real AI video generation, rendering, or file processing.
- Backend billing/subscription logic or payment integration.
- User authentication or a real dashboard.
- Full WebGL or advanced motion libraries (keep motion lightweight with CSS and simple Framer-style animations).

## Pages / routes

```text
/              -> Landing page (all hero + sections)
/pricing       -> Pricing cards + FAQ accordion
/features      -> Feature breakdown + how-it-works steps
/contact       -> Enterprise contact form
```

## Design approach
- Follow the source site's dark theme, high-contrast typography, and rounded cards.
- Extend the existing Tailwind theme in `src/styles.css` with the exact semantic tokens needed (deep background, accent colors, muted grays) rather than hardcoding hex values in components.
- Keep the navigation and footer in `src/routes/__root.tsx` so they wrap every route.
- Add route-specific `head()` metadata on every page.

## Mock generation flow
1. A prominent "Start creating" button opens a modal/drawer with a script textarea.
2. User can pick a voice and a format (documentary, listicle, sleep story, etc.).
3. On submit, show a progress UI with realistic steps: "Writing narration → Matching footage → Adding captions → Mixing audio → Final render".
4. After ~5–8 seconds, reveal a sample finished-video card with a thumbnail, duration, and download button.

## Implementation steps

1. **Audit and extract assets** — Fetch the original screenshot and inspect the main asset URLs (thumbnails, result cards, favicon). Verify they are publicly accessible and choose which ones to hotlink vs. generate as fallbacks.
2. **Theme setup** — Update `src/styles.css` with GoMotion's dark palette as semantic tokens (background, surface, primary accent, muted text, border). Add a custom font stack if needed.
3. **Layout shell** — Move the generic placeholder out of `src/routes/index.tsx`. Add a shared header, navigation, and footer to `src/routes/__root.tsx` around `<Outlet />`.
4. **Landing page** — Recreate the hero, 3-step process, crew cards, feature grid, results gallery, pricing, FAQ, and CTA in `src/routes/index.tsx`.
5. **Child routes** — Create `src/routes/pricing.tsx`, `src/routes/features.tsx`, and `src/routes/contact.tsx` with focused content and proper `head()` metadata.
6. **Interactivity** — Add FAQ accordion, pricing card interactions, mobile menu, and a "Generate video" modal with a simulated progress/result flow.
7. **Polish** — Add subtle scroll animations, hover transitions, and responsive breakpoints. Verify the page on mobile and desktop.
8. **Test** — Run the dev build, check for route errors, and ensure no placeholder content remains.

## Success criteria
- The app opens on `/` and visually resembles gomotionai.com without a generic placeholder.
- All navigation links work and route to distinct pages.
- The FAQ accordion expands/collapses, the generate-video flow runs, and the pricing cards render correctly.
- The build passes and the preview looks polished on desktop and mobile.
