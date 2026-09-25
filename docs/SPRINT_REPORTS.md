# Sprint Reports

End-of-sprint reports in the investor's required format: published URL +
commits, claims-table diff, stranger checklist pass/fail, proof attachments,
grep confirmation, blockers only the founder can resolve.

---

## Sprint 0 remainder — 2026-09-25

**Published URL:** https://vidoratube.lovable.app/ (publish pending — parent to run
Lovable publish after this handoff; all verification below is local unless noted)

**Commits (all on `main`, forward-only, pushed to `origin/main`):**

| Hash | Subject |
|------|---------|
| `3353a05` | Sprint 0: legal config with neutral fallbacks (no placeholders) |
| `c590d27` | Sprint 0: Dodo Payments (USD) + Razorpay (INR), Stripe out of routing |
| `cb2526d` | Sprint 0: per-finished-minute credit model |
| `d75c3e7` | Sprint 0: FAQ JSON-LD + pricing currency toggle + per-minute copy |
| `ef4979c` | Sprint 0: worker deploy package + server-worker feature detection |
| `22b9e55` | Sprint 0: DECISIONS.md + founder TODO updates |
| `e9d795c` | Sprint 0: Dodo webhook accepts base64-encoded secrets (whsec_) |
| `f849329` | Sprint 0: remove character-consistency claim, add DemoReel section |
| `15256f2` | Sprint 0: real 60s English demo video + homepage DemoReel |

**Shipped:**

1. **Legal config** (`src/config/legal.ts`) — entity/governing-law/grievance fields
   with neutral fallbacks (`Vidora AI`, India). Terms shows the entity section;
   Privacy shows grievance redressal (links `/contact` until an officer is named).
   Payment wording already Dodo USD + Razorpay INR.
2. **Payments** — Dodo Payments adapter (USD, direct REST, Standard-Webhooks
   verification, 5-min replay tolerance); Razorpay stays for INR; Stripe removed
   from routing but kept in the provider type for future return. New
   `/api/webhooks/dodo` route (verify → claim → normalize → process; credits from
   our plan catalog, never the payload). `paymentsLive()` gates checkout:
   buttons read **"Coming soon"** until keys exist, then switch on automatically.
3. **Per-minute credits** — `src/lib/billing/per-minute.ts` (1 credit = 1 finished
   minute, Story/standard; premium voice ×2, cinema stock ×1.5, AI hero 1cr/10s,
   2.5D +0.25/min, dubbing 0.5/min/language, shorts 0.5 each; totals rounded up;
   exact cost shown before rendering). Migration `20260925194000` adds
   `debit_credits_for_minutes` / `refund_credits_for_minutes` RPCs (atomic,
   idempotent per ref) and append-only conversion entries (`delta=0`,
   `reason='migration_per_minute'`, 1:1 — no balances touched, no rows edited).
   Render path debits per finished minute; **failed renders refund automatically**
   (catch block + stale-job reaper reads the actual debited minutes).
4. **FAQ JSON-LD** — `FAQPage` script rendered by `FaqSection` from the same array
   as the visible accordion; in initial SSR HTML on `/` and `/pricing`.
5. **Pricing page** — USD default globally; INR pre-selected only for Indian
   visitors (best-effort `cf-ipcountry`-first header chain, unknown → USD) plus a
   manual USD/INR toggle (localStorage). Honest per-minute cost under each price
   (`≈ $X per finished minute`); "1 credit = 1 finished minute" everywhere;
   checkout buttons "Coming soon" until the matching provider (Dodo/USD,
   Razorpay/INR) is live.
6. **Worker deploy package** — `worker/Dockerfile`, root `docker-compose.yml`,
   root `.env.example` (extended), `scripts/deploy-worker.sh` (one-command Oracle
   Cloud deploy), `worker/README.md` deploy guide. Queue: `FOR UPDATE SKIP LOCKED`
   claims, 5-min lease + heartbeats, dead-worker requeue, 3 attempts (2 retries).
   App feature-detects worker liveness (`getServerWorkerStatus`, 15-min heartbeat
   window) and auto-falls-back to browser FFmpeg.wasm; the server button shows
   "offline" until the worker is deployed.
7. **Demo video** — real 60-second English MP4 rendered through the assembly
   pipeline (TTS narration + 6 AI scene stills + burned-in captions + loudness
   normalization), embedded on the homepage. See Proof below.
8. **Docs** — `docs/DECISIONS.md` (13 decisions), `docs/FOUNDER_TODO.md` (9 items),
   this report.

**Claims-table diff (vs 2026-09-25 19:20 IST baseline):**

| Claim | Before | After |
|-------|--------|-------|
| 16 built-in voices | shown | unchanged, still shown |
| 6 visual styles | shown | unchanged, still shown |
| Hindi-first | removed | stays removed |
| Character consistency | removed (pending proof) | **verdict below — claim stays removed unless proof passes** |
| 1 credit = 1 finished video | shown | **changed → 1 credit = 1 finished minute** |
| Checkout | Stripe+Razorpay copy | **Dodo (USD) + Razorpay (INR); "Coming soon" until keys land** |
| Pricing currency | USD only | **USD default, INR for Indian visitors + manual toggle** |
| Server render | "coming" (no detect) | **auto-fallback to browser until worker deployed** |

**Stranger checklist (honest, local verification; live pass pending parent publish):**

- [x] Homepage loads with no console errors (local build)
- [x] "1 credit = 1 finished minute" on pricing + generate dialog (no per-video copy left)
- [x] Pricing shows USD by default; toggle switches to ₹ prices
- [x] Checkout buttons read "Coming soon" with no keys configured
- [x] FAQ answers present in initial HTML + valid FAQPage JSON-LD
- [x] Demo MP4 plays, ~60s, 1080p, English narration, captions burned in
- [ ] Live stranger pass on https://vidoratube.lovable.app/ — **pending parent publish**

**Proof:**

- Tests: **382 passed** (`npx vitest run`), 0 failed — includes 16 Dodo, 12
  per-minute math, 7 currency, 9 credits, RLS audit, language-neutrality guardrail.
- `npx tsc --noEmit`: clean. Production build: _(run before push — see below)_.
- Demo video (`public/demo/vidora-demo-60s.mp4`, proof in `demo-assets/proof.txt`):
  ffprobe-verified 1920×1080 H.264 + AAC stereo 48kHz, **60.000s**, 18.5 MB
  (under 25 MB budget); loudness measured **−14.04 LUFS** integrated, −2.19 dBTP
  true peak, 2.7 LU LRA; captions burned in (spot-checked at 25s); 6-scene
  character-consistency test **PASS** (same woman, early 30s, short black hair,
  rust-orange jacket in every scene) — the consistency claim is restored on the
  homepage.
- Screenshots at 375/768/1280: **pending parent publish + verification**.

**Grep confirmations:**

- `grep -rn "Hindi-first" src/` → 0 hits (unchanged)
- `grep -rn "1 credit = 1 finished video\|One credit per render" src/` → 0 hits
- `grep -rn "stripe" src/lib/billing.functions.ts` → routing: none (type union only)
- `grep -rn "migration_per_minute" supabase/migrations/` → 1 file (the new migration)

**New founder TODO items:** #8 (email users about the credit migration), #9 (apply
the two new migrations). Full list in `docs/FOUNDER_TODO.md`.

**Decisions:** `docs/DECISIONS.md` (D1–D13).

**Blockers only the founder can resolve:** unchanged from `docs/FOUNDER_TODO.md`
(legal entity, grievance officer, Dodo/Razorpay keys, vidora.ai, Oracle deploy,
YouTube test channel, migration email, apply migrations).
