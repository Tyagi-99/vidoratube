# P5 Plan: Thumbnail/SEO Studio + YouTube Publishing

## Goal
Complete the publish pipeline: thumbnail generation, SEO metadata (titles,
descriptions, tags), scheduled publishing to YouTube with human approval,
and start Google OAuth verification paperwork.

## Scope

### 1. Thumbnail studio
- AI thumbnail generation: 3 variants per video (image gen, 16:9 and 9:16)
- Text overlay editor: headline text, font, color, position (burned into image)
- Face/object focus options where provider supports
- A/B note: store which variant was used; P8 analytics will compare CTR
- Upload thumbnail to YouTube on publish (thumbnails.set API)

### 2. SEO studio
- Title optimizer: 3 title variants scored (length, keyword, curiosity, clarity)
- Description builder: hook + chapters + links + hashtags, from script content
- Tag suggester: relevant tags from niche + outlier data (P3)
- All LLM-generated, editable, saved per project

### 3. YouTube publishing (incremental — P1 laid the groundwork)
- Publish flow: select approved video → thumbnail → metadata → schedule time
- Scheduling: publishAt via YouTube API (scheduled videos)
- Human approval gate: explicit "Approve & publish" button, no auto-publish
- Upload with resumable protocol (already built), progress display
- Post-publish: store youtube_video_id, URL, published_at

### 4. Google verification paperwork (start now — takes weeks)
- Document: OAuth verification requirements, scope justifications
- `docs/GOOGLE_VERIFICATION.md`: app description, scope rationale
  (youtube.readonly for analytics, youtube.upload for publishing),
  demo video script, privacy policy / terms links check
- Quota extension request draft (10k units/day → higher)

## Data model (migration)
- `thumbnails` (id, project_id, variant, url, text_overlay JSONB, selected)
- `seo_metadata` (id, project_id, titles JSONB, description, tags, selected_title)
- `publish_jobs` (id, project_id, youtube_video_id, scheduled_for, status, approved_by, approved_at)
  — or extend existing publish tables; check first

## Constraints
- NO unattended auto-publishing (demonetization pattern — human approval required)
- madeForKids choice already required (P1) — enforce in publish flow
- Thumbnail images: AI-generated or user-uploaded; no copyrighted material
- All YouTube API calls respect quota; cache where possible
- i18n en/hi

## UI
- Publish tab in studio: Thumbnail → SEO → Schedule → Review → Approve & Publish
- Calendar/time picker for scheduling
- Publish history list

## Deliverables
1. Migration(s)
2. `src/lib/thumbnails.ts`, `src/lib/seo.ts` (+ tests)
3. Server functions (zod, rate-limited)
4. Publish UI flow with approval gate
5. `docs/GOOGLE_VERIFICATION.md`
6. Tests: SEO scoring, thumbnail variant logic, publish state machine, RLS
7. CHANGELOG entry

## Verification
- tsc clean, vitest green, build clean
- Publish state machine tested (draft → approved → scheduled → published)
- Thumbnail upload API mocked in tests
- Verification doc reviewed for completeness
