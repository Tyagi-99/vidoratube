# VidoraTube — Security Model

Phase 0a audit, 2026-09-27. Findings are severity-rated with file/line
evidence and remediation. Secrets encountered during the audit were redacted,
not reproduced.

## 1. Findings

| # | Severity | Finding | Evidence | Remediation |
|---|---|---|---|---|
| S1 | **Medium** | Dead `src/lib/meta.functions.ts` uses the weaker `requireSupabaseAuth` middleware (permits anonymous-guest JWTs) instead of `requireAppUser`. Harmless while the module has zero consumers, but if anyone wires it up, guests could invoke Meta connect/publish. | `src/lib/meta.functions.ts:4,21` vs `src/lib/server-auth.ts` | Delete the file (it's dead code), or switch its middleware to `requireAppUser` before any reactivation |
| S2 | Low | Admin route gate is a client-side redirect (`navigate` to `/studio` when `!isAdmin`). UI-only — but every admin server function enforces `assertAdmin`, so the defense holds server-side. | `src/routes/_authenticated/admin.tsx:51-55`; `admin.server.ts` (`has_role` SECURITY DEFINER pinned to `auth.uid()`, migration `20260818052111`) | No change required; optionally render a 403 instead of redirecting for clarity |
| S3 | Low | Razorpay webhook dedupe key is derived from the payload (`${event}:${entityId}`) rather than a stable provider event id — weaker dedupe than Dodo's `webhook-id`. Signature verification still prevents forgery. | `src/routes/api/webhooks/razorpay.ts:36-41` | Prefer the provider's event id if available; note-only otherwise |
| S4 | Low | CSP allows `img-src https:` (broad) and `script-src 'unsafe-inline'` (required for SSR hydration). Both are documented as deliberate. | `src/lib/security-headers.ts:36-45` | Keep; revisit if the image-CDN list stabilizes |

No Critical or High findings. Past sprints (D61–D69, D82, D36, D45) hardened
this surface thoroughly.

## 2. Verified clean (with evidence)

- **Secrets in code:** none hardcoded in `src/`. Every provider key is read
  from `process.env` and throws when missing (e.g. `dodo.ts:31`,
  `render.server.ts:49`, `notifications.server.ts:105`). Only
  `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` are client-bundled
  (public by design). No component/route imports the service-role client —
  it stays server-side. No `.env` file in the repo; `.env.example` (76 lines)
  contains only empty/placeholder values.
- **RLS:** enabled on all tables (69 statements). The old effectively-public
  `music_tracks` policy (`USING (auth.uid() IS NOT NULL)`) was replaced with
  an explicit documented public-read policy (migration `20260925234000`,
  D36). Remaining public-read tables (`music_tracks`, `languages`,
  `language_voices`, `language_quality_gates`, `safety_rules`, `plans`,
  `categories`, `site_content`) are catalog/reference data with writes
  restricted to service-role (D45). RESTRICTIVE "No guest sessions" policies
  exclude anonymous JWTs across tables. A static CI test
  (`src/lib/rls-policies.test.ts`) asserts RLS + owner policies per table.
- **Credential storage:** YouTube OAuth tokens encrypted at rest (AES-256-GCM,
  `youtube.server.ts:212-249`); token column revoked from `authenticated` via
  column-level GRANTs.
- **Storage:** `generated-videos` and `brand-logos` buckets forced private
  with owner-scoped object policies; renders served via 7-day signed URLs.
- **OAuth:** YouTube + Meta callbacks verify signed `state` before code
  exchange (`youtube-callback.ts:21`, `meta-callback.ts:39`) — no CSRF gap.
- **Webhooks:** Dodo/Stripe/Razorpay signatures verified before processing;
  events deduplicated via `billing_events` claim/mark; credit amounts resolved
  from the in-code plan catalog, never the provider payload.
- **SSRF:** no server-side fetch of arbitrary user URLs; `probeStorageHead`
  only fetches Supabase-signed URLs; URL inputs validated and stored, never
  fetched.
- **Injection:** parameterized RPC args throughout; no SQL string
  interpolation in `src/` or `worker/src/`; `dangerouslySetInnerHTML` only for
  static inline bootstrap scripts; guides render plain text; no `eval(`.
- **Headers:** HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`
  applied via `withSecurityHeaders` in `src/server.ts`.
- **Publish safety:** score<50 blocks public publishing with no override;
  approvals are server-only rows; scheduling never auto-publishes.

## 3. Trust boundaries

```text
Public internet
  ├─ Marketing pages, /status, SEO routes (no auth)
  ├─ OAuth callbacks + payment webhooks (signature/state-verified, no session auth)
  └─ _authenticated/* + all server functions (Supabase session + requireAppUser;
      anonymous JWTs rejected fail-closed at middleware AND RLS)
        ├─ Admin console (assertAdmin on every server fn; has_role SECURITY DEFINER)
        └─ Service-role operations (credit debit, storage, token decrypt) — server-only modules
```

## 4. Roadmap security requirements (new work needed)

1. **API keys + MCP (brief FEATURE 41):** scoped keys, key rotation,
   per-key rate limits, and an `audit_logs` table do not exist yet.
2. **Team workspaces (FEATURE 40):** role model exists in outline
   (`workspace_members`) but Owner/Admin/Strategist/… permission checks per
   operation are not implemented; audit logging for member actions is missing.
3. **Chrome extension (FEATURE 42):** needs a token model with minimal
   scopes — design before building.
4. **File upload validation:** uploads flow through Supabase Storage; add
   explicit MIME/size validation and malware-safe handling before the
   brief's broader upload surface (voice uploads, reference images) ships.
5. **Publish blast radius:** destructive/live YouTube mutations already
   require explicit confirmation and never silently overwrite metadata —
   preserve this invariant in every new publishing feature.
