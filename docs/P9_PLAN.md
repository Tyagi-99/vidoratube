# P9 Plan: Growth, SEO & Full Hindi

## Goal
Make VidoraTube discoverable and fully usable in Hindi: complete i18n,
landing-page SEO, referral loop, and onboarding that converts.

## Why
P0–P8 built the product. P9 builds the top of the business funnel: people
finding the site, understanding it in their language, and inviting others.

## Scope

### 1. Full Hindi i18n
- Expand P3's minimal dictionary to full coverage: nav, studio, research,
  publish, billing, analytics, auth, errors
- Language toggle persisted (localStorage + profile)
- Hindi-first defaults where appropriate (voice picker already does this)
- `npm run i18n:check` — script that fails if any UI string lacks hi

### 2. Landing page SEO
- Meta tags, OG/Twitter cards, canonical URLs
- JSON-LD structured data (SoftwareApplication)
- Sitemap + robots.txt
- Semantic HTML audit of landing page (h1, headings)
- Performance: check bundle size, lazy-load heavy routes

### 3. Referral program
- Invite links: `https://vidoratube.lovable.app/r/{code}`
- Reward: 5 credits each when invitee verifies email (anti-abuse: reuse P1
  abuse signals — no self-referral farming)
- `referrals` table: code, referrer_id, invitee_id, status, rewarded_at
- Referral section in /billing or dashboard

### 4. Onboarding
- First-run checklist: connect YouTube → create research project → generate
  idea → studio tour
- Empty states link into the checklist
- Dismissible, resumable

### 5. Content foundation (light)
- `/guides` index page (skeleton for SEO content)
- 3 launch guides: "AI YouTube studio", "monetization safety", "Hindi AI voice"
  — honest, no fake claims

## Data model (migration)
- `referrals` (id, code, referrer_id, invitee_id, status, rewarded_at)
- `profiles`: preferred_language column

## Constraints
- No fake testimonials / user counts / income claims (standing rule)
- Referral anti-abuse: device/IP correlation, one reward per invitee
- i18n completeness enforced by script

## Deliverables
1. Migration
2. Full hi dictionary + i18n check script
3. SEO meta/OG/JSON-LD/sitemap/robots
4. Referral system (links, rewards, anti-abuse)
5. Onboarding checklist
6. /guides skeleton + 3 honest guides
7. Tests: referral reward logic, anti-abuse, i18n completeness
8. CHANGELOG entry

## Verification
- tsc clean, vitest green, build clean
- i18n:check passes
- Referral: invite → verify → both credited once (test); self-referral blocked
