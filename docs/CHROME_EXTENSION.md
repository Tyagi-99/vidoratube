# F42 Chrome Extension — design (PROPOSED, not built)

Phase 5, Stream C. **DOCS ONLY — no extension code was written, built, or
published in this program.** Every claim below is a design proposal except
where it references existing, already-built server behavior (MCP tools,
API keys), which is marked REAL (code).

Design principle (pinned): **"AI prepares, human approves."** The extension
is a *companion surface* — it can surface status and prepare drafts; it can
never move anything forward in the pipeline by itself.

## 1. Architecture

```
┌──────────────────────────┐
│  Chrome extension         │
│  (Manifest V3, popup +    │
│   service worker)         │
│                          │
│  key lives ONLY in        │
│  chrome.storage.local    │ ── HTTPS POST ──► POST /api/mcp
│  (background/service      │    Authorization: Bearer vdsk_…
│   worker context)         │    Content-Type: application/json
└──────────────────────────┘
        │                       │ JSON-RPC 2.0
        │ never                 │ tools/list, tools/call
        │ touches               ▼
        │ page JS           ┌──────────────────────────┐
        └─(no content       │ Vidora server             │
           script access)   │ · authenticateApiKey      │
                           │ · per-tool scope re-check │
                           │ · draft-only guarantees   │
                           │ · audit via auditApiCall  │
                           └──────────────────────────┘
```

### 1.1 Call flow (proposed)

1. User installs the extension and pastes a **dedicated extension API key**
   (`vdsk_` + 32 chars) into the extension's options page. The raw key is
   written to `chrome.storage.local` and never to any page.
2. The extension's service worker builds a JSON-RPC 2.0 envelope
   (`{"jsonrpc":"2.0","method":"tools/call","params":{"name":…,"arguments":…},"id":…}`)
   and POSTs it to `https://<app>/api/mcp` with
   `Authorization: Bearer <vdsk_ key>`. (Transport and route are REAL (code):
   `src/routes/api/mcp.ts`.)
3. The server authenticates the key (`authenticateApiKey` — REAL (code),
   `src/lib/api-keys/keys.server.ts`), re-checks the tool's required scopes
   against the key's granted scopes, enforces the per-key 60 req/min rate
   limit, and dispatches the tool. Every call is audit-logged (REAL (code)).
4. The response carries the pinned `provenance` block
   (`real | estimate | ai_analysis | fixture`) — the extension MUST render it
   alongside any AI-generated content, per the cross-stream labeling rule.

### 1.2 Key storage — hard rules (proposed)

- The raw `vdsk_` key is stored **only** in `chrome.storage.local`,
  accessible to the extension's service worker/background context.
- The key is **never** placed in:
  - page JavaScript / content scripts / `localStorage` / `sessionStorage`
    of any web page,
  - the web app's client-side JS bundle,
  - URLs, query strings, referrers, or logs.
- Display: masked after entry (e.g. `vdsk_••••…ab3f`, last 4 chars only).
  The full key is shown **once** at creation in the web app (REAL (code) —
  existing behavior) and must be re-pasted, never re-read from storage, if lost.
- The key shown in the options page is only ever used for
  `Authorization: Bearer` on direct HTTPS calls to `/api/mcp`; it is never
  shared with any third party.

## 2. Token model — minimal scopes (proposed)

Two key profiles are proposed, selectable at key creation in the web app.
The scopes vocab is the pinned REAL (code) set:
`read:projects`, `write:projects`, `read:analytics`, `publish:request`,
`admin:keys` (`src/lib/api-keys/keys.ts`, `API_KEY_SCOPES`).

| Profile | Scopes | Purpose |
|---|---|---|
| **Status** (default) | `read:projects`, `read:analytics` | Read-only companion: project status, analytics snapshots, learnings. |
| **Status + Drafts** (opt-in) | `read:projects`, `read:analytics`, `write:projects` | Adds draft creation (`vidora.draft_script`) behind an explicit user toggle. |

- `publish:request` is **deliberately not granted** to any extension key —
  even `vidora.request_publish` (which itself only creates draft publish
  jobs) is out of the extension's reach. The extension cannot put anything
  into the publish pipeline.
- `admin:keys` is **never** granted to an extension key (keys cannot manage
  keys).
- `write:projects` is **off by default** and must be enabled by a conscious
  choice in the web app when the key is created ("Allow this extension to
  create draft scripts"), per minimal-scope discipline.

### Tool-to-scope map for the extension (scopes are REAL (code),
`src/lib/mcp/server.ts` `requiredScopes`)

| Tool | Required scope | Status key | Status + Drafts key |
|---|---|---|---|
| `vidora.list_projects` | `read:projects` | ✅ | ✅ |
| `vidora.get_project` | `read:projects` | ✅ | ✅ |
| `vidora.search_channels` | `read:analytics` | ✅ | ✅ |
| `vidora.get_channel` | `read:analytics` | ✅ | ✅ |
| `vidora.get_analytics` | `read:analytics` | ✅ | ✅ |
| `vidora.list_learnings` | `read:analytics` | ✅ | ✅ |
| `vidora.draft_script` | `write:projects` | ❌ (403 scope) | ✅ (draft only, server-gated) |
| `vidora.request_publish` | `publish:request` | ❌ (403 scope) | ❌ (403 scope) |

The server re-checks scopes per tool (defense in depth — REAL (code)), so a
client bug or a tampered extension cannot escalate: a Status key calling
`tools/call` with `vidora.draft_script` receives 403.

## 3. Capability table

| CAN (within the token model) | CANNOT (gates stay server-side) |
|---|---|
| Read project status and details | **Approve** anything — no approval path exists in the tools |
| Read channel/analytics snapshots | **Publish** — no tool publishes; `draft_script`/`request_publish` hardcode `draft` and the handler asserts (REAL (code), D160) |
| Read learnings | **Schedule** — no scheduling tool |
| Trigger draft script creation (Status + Drafts profile only; draft rows only, no status field in the schema) | **Upload** videos or assets |
| | **Spend** credits beyond the existing preflight gate — `draft_script` verbatim mode stores as-is with no spend; `generate` mode goes through the real Phase 1 credit preflight (REAL (code)) |
| | Manage/rotate API keys (`admin:keys`) |
| | Bypass rate limits (per-key 60 req/min, REAL (code)) |

The extension UI must make the CAN/CANNOT boundary visible: drafts are
labeled **DRAFT — needs human approval**, and any spend is an **ESTIMATE**
until the real preflight runs server-side.

## 4. Threat model (proposed)

| Threat | Impact | Mitigation |
|---|---|---|
| Key stolen from the device (e.g. disk read, backup exfiltration) | Attacker can call MCP tools with the key's scopes | **Scope-limited blast radius**: a Status key can only read; a Drafts key can only create drafts (no approve/publish/spend). **Revoke/rotate** immediately via the existing API key routes (REAL (code): `src/routes/api/keys.ts`, `keys.$keyId.ts`, `keys.$keyId.rotate.ts`) — no client involvement needed. |
| Extension updates ship malicious code (supply-chain) | Exfiltration of the stored key or misuse of granted scopes | MV3 keeps keys in `chrome.storage.local` (not page-accessible); separate keys per install/user so one compromised key is revocable independently; audit log (`auditApiCall`, REAL (code)) shows exactly what the key did and when. |
| Man-in-the-middle on the wire | Key or data interception | HTTPS-only endpoint; key sent as Bearer, never in URLs; service-worker-only request path (no page context sees the header). |
| Key leaked via the web app client JS | Web-app compromise spreads to extension users | Key never enters the web app's client JS — REAL (code) raw key is returned once at creation and never stored; the extension key is pasted into the extension's own options page, not the app. |
| Malicious page reads the key | Page JS stealing credentials | Content scripts and page JS have **no access** to `chrome.storage.local` keys held by the background context; the key is never injected into the DOM. |
| Scope-creep requests from the extension UI | Social-engineering "allow drafts" nags | `write:projects` requires an explicit, separately-confirmed choice in the web app at key creation; the web app shows exactly what each scope enables. |

### Revocation/rotation runbook (uses existing, REAL (code) APIs)

1. In the web app: API Keys → select the extension key → **Rotate** (old key
   continues to work for a grace window while the user pastes the new one
   into the extension) or **Revoke** (immediately 401s every further call).
2. Check `audit_logs` for the key's recent tool calls to assess what a
   stolen key may have read/created.
3. Rotation keeps `last_used_at`/rate-limit state on the same key row where
   supported; revocation is permanent — a fresh key must be created.

## 5. Build boundary

Nothing in this document is built. The proposed extension would be a new
client of the already-built, already-audited MCP surface (`/api/mcp`,
REAL (code), F41) — it adds no server behavior, no new scopes, no new tools,
and no approval/publish path. Any future build starts from
`docs/PHASE5_CONTRACTS.md` §4 and this doc.
