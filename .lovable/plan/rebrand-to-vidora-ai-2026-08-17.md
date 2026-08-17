# Rebrand to Vidora AI

Turn the current GoMotion-styled clone into a distinct product identity: new name, new palette, new typography, and enough compositional variation that it no longer reads as a copy — while keeping the existing page structure and all working functionality.

## Brand

- Name: **Vidora AI** everywhere (header logo, footer, page titles, meta descriptions, copy, dialog, CTA buttons).
- Tagline shift: from "faceless YouTube automation" phrasing to Vidora's own voice — "Your AI video studio, on autopilot."
- Wordmark: text logo with a small geometric play/aperture glyph, not a copy of the original mark.

## Color direction

Chosen palette: **Deep teal + electric mint** on an off-white cool base — clearly distinct from the original violet/cream scheme.

- Background: near-white with a faint cool tint
- Foreground: deep ink teal
- Primary: teal-green (buttons, links, accents)
- Accent/glow: electric mint for gradients, hero glow, badges
- Dark surfaces (CTA band, footer) use deep teal-ink instead of black/violet

All values written as OKLCH tokens in `src/styles.css`; existing custom utilities (`text-gradient-blue`, `bg-hero-glow`, `bg-top-glow`) renamed/retuned to the new brand gradient.

## Typography

Swap Inter for a distinct pairing: **Sora** headings + **Manrope** body, loaded via a `<link>` in the root route head. Headings get tighter tracking and slightly larger display sizes.

## Format / layout differentiation (light-touch)

Section order and features stay the same; the styling and composition of each shifts:

- Header: pill-shaped floating nav instead of full-width sticky bar
- Hero: left-aligned headline with the demo mock offset to the right, instead of centered stack
- Cards: softer radius, thin ring border, lifted hover instead of heavy shadow blocks
- Section headings: small kicker label above each title, left-aligned on desktop
- Feature grid: mixed-size bento arrangement rather than uniform 3-up cards
- Pricing: horizontal-emphasis middle tier with a distinct highlighted frame
- FAQ: bordered stacked rows rather than boxed accordion
- Footer: three-column layout with brand blurb

## Copy

Rewrite headlines, subheads, feature blurbs, FAQ answers, plan names, and testimonial-style stats in Vidora's own wording. Plan names become Starter / Studio / Scale.

## Technical notes

- `src/styles.css`: replace the palette tokens and brand utilities with the teal/mint set; add `--font-display` / `--font-sans` theme tokens.
- `src/routes/__root.tsx`: font `<link>`, new Header/Footer markup, updated site metadata.
- `src/routes/index.tsx`, `pricing.tsx`, `features.tsx`, `contact.tsx`: brand copy + per-route `head()` titles/descriptions for Vidora AI.
- `src/components/gomotion/*`: rename directory to `src/components/vidora/` and update imports; adjust card/section styling per the format notes. Mock generation flow behavior is unchanged.
- Verify with a build and preview screenshots of all four routes.
