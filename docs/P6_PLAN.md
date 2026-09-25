# P6 Plan: Monetization Safety Score

## Goal
A versioned, explainable score (0-100) that tells creators whether their video
is safe for YouTube monetization *before* they publish. This is the product's
core positioning: "the AI YouTube studio built to keep your channel monetized."

## Why
Demonetization (yellow dollar / limited ads) is the #1 fear of YouTube creators.
No competitor bakes a pre-publish monetization check into the creation flow.
This turns VidoraTube from a video tool into a channel-safety platform.

## Scoring dimensions (v1)

1. **Advertiser-friendliness** (30 pts): profanity, slurs, sexual content,
   violence/gore, drugs, tragedy keywords in script + title + description
2. **Copyright risk** (25 pts): music license verified (P4), image provenance
   (P4), no unattributed third-party content, character originality
3. **Originality** (20 pts): script not duplicated from outlier sources (P3),
   transformative commentary present, not pure reupload
4. **Metadata honesty** (15 pts): title matches content (no clickbait per P5
   scorer), thumbnail matches video, no misleading claims
5. **Policy compliance** (10 pts): madeForKids set correctly, no medical/
   financial advice without disclaimer, synthetic content disclosure

## Score bands
- 90-100: Safe to monetize (green)
- 70-89: Minor issues — fix suggestions (yellow)
- 50-69: At risk — limited ads likely (orange)
- 0-49: High demonetization risk (red)

## Implementation

### `src/lib/safety.ts` (pure, fully tested)
- `scoreScript(text)`: keyword/regex checks per dimension
- `scoreMetadata(title, description, thumbnail)`: honesty checks
- `scoreAssets(provenance[])`: license/copyright checks
- `computeSafetyScore(inputs) → { score, band, issues[], version }`
- Versioned: `SAFETY_SCORE_VERSION = "1.0"` stored with every score

### Server functions
- `scoreProject(projectId)`: gathers script + metadata + provenance, computes,
  stores in `safety_scores` (versioned history)
- `getSafetyScore(projectId)`: latest score
- Rate-limited, 1 credit per scoring (LLM-assisted deep check optional)

### LLM deep check (optional, credit-gated)
- For borderline scores (50-89), offer "AI deep review": LLM reads full script,
  flags subtle issues (implied claims, borderline content)
- Clearly labeled as AI opinion, not a guarantee

### UI
- Safety tab in studio: score dial, band color, issue list with fix suggestions
- "Fix" actions where possible (e.g. rewrite flagged sentence via LLM)
- Publish pipeline (P5): safety score shown at Review step; <50 blocks publish
  with override requiring explicit acknowledgment
- Score history per project

## Honesty rules (critical)
- NEVER claim "guaranteed monetization" — YouTube decides; we estimate risk
- Label: "estimate based on public policy signals, not a guarantee"
- No fake precision: round to whole numbers, show band not just number

## Data model (migration)
- `safety_scores` (id, project_id, version, score, band, dimensions JSONB,
  issues JSONB, created_at)

## Deliverables
1. Migration
2. `src/lib/safety.ts` (+ extensive tests with fixture scripts)
3. Server functions (zod, rate-limited)
4. Studio Safety tab + publish gate integration
5. i18n en/hi
6. Tests: scoring fixtures (clean script → 95+, profanity → drops, etc.)
7. CHANGELOG entry

## Verification
- tsc clean, vitest green, build clean
- Fixture scripts produce expected bands
- Publish blocked at <50 (test), override logged
