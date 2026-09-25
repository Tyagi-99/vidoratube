# P10 Plan: Launch Readiness

## Goal
Make VidoraTube production-launchable: legal pages, final security pass,
operational runbooks, and a single go-live checklist consolidating every
phase's external blockers.

## Why
P0–P9 built everything. P10 is the discipline to ship it: the legal pages
Google verification needs (P5), the runbooks an operator needs, and one
checklist so nothing falls through the cracks.

## Scope

### 1. Legal pages
- `/privacy`: honest privacy policy (what data we collect, Supabase, Stripe/
  Razorpay, YouTube API compliance, contact)
- `/terms`: terms of service (credits, refunds, acceptable use, no guarantees
  on monetization)
- Linked in footer; required for Google OAuth verification (P5 doc)

### 2. Final security review
- Re-run RLS audit across ALL tables (P0–P9)
- Dependency audit (`npm audit` / equivalent)
- Secrets scan: no keys in client bundle (re-verify after P3–P9 additions)
- CSP review after all new routes

### 3. Operational runbooks
- `docs/RUNBOOK.md`: deploy, migrate, rollback, worker ops, cron setup,
  webhook replays, incident response
- `docs/GO_LIVE.md`: THE checklist — every external action from P1–P9 in one
  place, ordered, with owners (user vs automated)

### 4. Launch polish
- 404 page, error boundaries on new routes
- Loading states audit for P3–P9 routes
- Final copy pass: no "coming soon" left, no fake claims

### 5. Launch verification
- Full test suite + build + i18n:check green
- E2E smoke: homepage → pricing → auth → studio (public paths)
- Document what was verified vs what needs production

## Deliverables
1. /privacy + /terms routes
2. Security review report (`docs/LAUNCH_SECURITY.md`)
3. docs/RUNBOOK.md + docs/GO_LIVE.md
4. Polish fixes
5. Tests for legal routes, RLS re-audit
6. CHANGELOG entry

## Verification
- Everything green; GO_LIVE.md reviewed for completeness
- Explicit "READY FOR STAGED LAUNCH" or "NOT READY" verdict with reasons
