# Phase 5 — Platform contracts (pinned 2026-09-28)

Coordinator-owned. All three streams build against this; do not change the
contract without renumbering the affected section and notifying the other
streams. Contract lives on `phase5/contracts` (base `main@ef44555`).

## 1. Source-of-truth surfaces (do not duplicate)

| Surface | Module | What streams reuse |
|---|---|---|
| MCP tool definitions + dispatcher | `src/lib/mcp/server.ts` (`MCP_TOOLS`, `callMcpTool`, `handleJsonRpc`, `toolJsonSchema`) | Agent tool list (Stream A); E2E harness (Stream B) |
| MCP data port | `src/lib/mcp/port.supabase.ts` (`makeSupabaseMcpPort`) | Agent server calls port methods directly — same functions, no copied logic |
| JSON-RPC route | `src/routes/api/mcp.ts` (POST `tools/list`/`tools/call`, GET discovery) | E2E harness posts here (Stream B) |
| API key lifecycle | `src/lib/api-keys/keys.server.ts` (`createApiKey`, `rotateApiKey`, `revokeApiKey`, `verifyApiKey`, `authenticateApiKey`, `auditApiCall`) | Rotation UX + rate-limit headers (Stream B) |
| REST key routes | `src/routes/api/keys.ts`, `keys.$keyId.ts`, `keys.$keyId.rotate.ts` | Stream B extends, does not replace |
| Credit preflight | `src/lib/credits/preflight.server.ts` (`preflightCreditsCheck`) | Agent LLM turns + any new spend |
| LLM call pattern | Lovable AI gateway `https://ai.gateway.lovable.dev/v1/chat/completions`, `Authorization: Bearer ${process.env.LOVABLE_API_KEY}`, `jobType: "llm_chat"`, provider `"lovable-ai"`, preflight → debit-first (see `generateScriptDraft` in `src/lib/creation/scripts/scripts.functions.ts`) | Agent LLM calls (Stream A) |
| Scopes vocab | `src/lib/api-keys/keys.ts` `API_KEY_SCOPES = ["read:projects","write:projects","read:analytics","publish:request","admin:keys"]` | Extension token model (Stream C); E2E scope tests (Stream B) |

## 2. Stream A — F10 Vidora Agent

### Tool list (pinned; exactly these, no extras without a contract amendment)
The 8 MCP tools, by their canonical names:
`vidora.search_channels`, `vidora.get_channel`, `vidora.list_projects`,
`vidora.get_project`, `vidora.draft_script`, `vidora.request_publish`,
`vidora.get_analytics`, `vidora.list_learnings`.

The agent invokes them through the **Supabase MCP port directly**
(`makeSupabaseMcpPort(supabaseAdmin)` methods) — never by copying tool logic.
Every agent tool invocation is audit-logged with action
`agent.tool_call` (tool name, ok/error_code, conversation_id in metadata).

### Agent loop (server-only, `src/lib/agent/`)
- `sendAgentMessage(userId, workspaceId, conversationId, text)`:
  1. Load conversation history (last N=20 messages).
  2. Credit preflight for the LLM turn: `preflightCreditsCheck(admin,
     { userId, jobType: "llm_chat", provider: "lovable-ai",
       tokens: { input: estIn, output: estOut } })`. Denied → honest
     `INSUFFICIENT_CREDITS` / `BUDGET_EXCEEDED` envelope, no LLM call.
  3. Call the gateway with a system prompt that (a) lists the 8 tools and
     their JSON schemas (from `MCP_TOOLS`), (b) forbids inventing data —
     every factual claim must come from a tool result, (c) requires the
     final answer to end with a concrete next step that creates a DRAFT
     (draft script / draft publish job / new project row) with a real cost
     shown as ESTIMATE.
  4. Tool-calling loop, max 6 iterations. Each tool call runs through the
     port; `draft_script`/`request_publish` can only create drafts (port
     hardcodes status; the handler asserts).
  5. The agent **never** approves, publishes, schedules, or spends beyond
     the existing gates. `request_publish` creates a draft publish job;
     human approval happens in the existing publish pipeline.
  6. Every assistant message is persisted with `provenance: "ai_analysis"`;
     the UI renders an "AI analysis" label. Tool-result summaries derived
     from real rows carry `provenance: "real"`.
- Missing `LOVABLE_API_KEY` → honest `unconfigured` state, never a fake reply.
- No network calls in tests: the LLM call and the port are both injected
  fakes; tests cover the loop, the draft-only invariant, preflight denial,
  and the 6-iteration cap.

### Message persistence (migration `20260928050000_p5_agent.sql`)
```sql
-- agent_conversations: id uuid PK, user_id uuid NOT NULL (auth.users, cascade),
--   workspace_id uuid NULL (workspaces, set null), title text NOT NULL DEFAULT 'New conversation',
--   created_at / updated_at timestamptz NOT NULL DEFAULT now()
-- agent_messages: id uuid PK, conversation_id uuid NOT NULL (agent_conversations, cascade),
--   role text NOT NULL CHECK (role IN ('user','assistant','tool')),
--   content text NOT NULL, tool_calls jsonb NOT NULL DEFAULT '[]',
--   provenance text NOT NULL DEFAULT 'ai_analysis'
--     CHECK (provenance IN ('real','estimate','ai_analysis','fixture')),
--   created_at timestamptz NOT NULL DEFAULT now()
-- RLS: owner-only (auth.uid() = user_id; messages via parent conversation)
-- trigger: touch_updated_at on agent_conversations
```
Forward-only, `IF NOT EXISTS`, non-destructive. **Do NOT apply live** —
list it in the final report for dashboard apply.

### UI route
`/_authenticated/agent` (e.g. `/agent`): conversation list + thread,
honest states (unconfigured / insufficient credits / error), AI-analysis
labels, "creates drafts only — approvals happen in the pipeline" notice.
No fake-functional buttons: the "Create draft" action must call the real
server function and show the real result or the real error.

### Stream A acceptance
- Tool-calling loop green against fake port + fake LLM (unit).
- Draft-only invariant test: agent cannot produce approved/published rows.
- Preflight denial test: no LLM call, honest envelope.
- Migration file present, forward-only, unapplied.
- `/agent` route renders honest states.

## 3. Stream B — F41 gaps + MCP E2E harness

### Gaps to close
1. **Rate-limit response headers**: add standard `X-RateLimit-Limit`,
   `X-RateLimit-Remaining`, `X-RateLimit-Reset` (epoch seconds) on
   `/api/mcp` POST/GET responses and `/api/keys*` responses. Keep the
   existing `Retry-After` + `retry_after_ms` behavior on 429.
   (`SlidingWindowRateLimiter.check` returns allowance — expose remaining/reset.)
2. **Rotation UX audit**: the REST rotate endpoint exists
   (`POST /api/keys/:keyId/rotate`); verify the settings UI exposes
   create/revoke/rotate with the raw-key-once flow and `last_used_at`
   display. Add whatever UI/API is missing; document what you found.
3. **Credit gating audit**: verify every spend-incurring MCP tool path is
   gated. Known: `draft_script` generate → `generateScriptDraft` (real
   preflight + debit). Verbatim `sections` and all other tools spend
   nothing. Report the audit; gate anything newly found that spends.

### MCP E2E harness (permanent test)
- New test file (e.g. `src/lib/mcp/e2e.test.ts`) that drives **all 8 tools**
  through `handleJsonRpc` (the real JSON-RPC envelope) with the **fake port**
  and a real `authenticate` implementation against an in-memory key store
  (exercises auth, per-tool scopes, rate limits, and the audit hook).
- Exit criterion: "MCP tools E2E-tested against a sandbox workspace" —
  the fake port IS the sandbox workspace here; the test must cover
  tools/list, tools/call success per tool, unknown tool, insufficient
  scope, invalid arguments, 429 rate limit, and audit-log invocation.
- No network calls.

### Stream B acceptance
- Rate-limit headers present on /api/mcp and /api/keys* (unit-tested).
- Rotation UX verified or added.
- Credit-gating audit documented (in code comments or docs).
- E2E harness green: 8/8 tools through the real JSON-RPC handler.

## 4. Stream C — F42 Chrome extension + Enterprise (DOCS ONLY, no extension code)

- `docs/CHROME_EXTENSION.md`: architecture (extension → `vdsk_` API key →
  `/api/mcp`), token model with minimal scopes
  (`read:projects` + `read:analytics` for status reads;
  `write:projects` only when draft creation is enabled), key storage in
  `chrome.storage.local` (never in page JS), capability table:
  CAN read project status, trigger draft creation;
  CANNOT approve, publish, schedule, upload, spend — all gates stay
  server-side. Threat model: stolen key → revoke/rotate; scope-limited
  blast radius.
- `docs/ENTERPRISE.md`: SSO/SAML design notes (Supabase Auth SAML /
  external IdP, workspace-level enforcement), DPA outline (processor terms,
  sub-processors, breach notification), data residency notes (Supabase
  region pinning, export/delete flows).
- Mark F42 COMPLETE (design) in `docs/FEATURE_MATRIX.md`.
- No code changes outside docs (matrix row + docs). Tests: none required.

## 5. Cross-stream rules
- No shared worktree. Streams merge into `phase5/platform` (coordinator).
- TypeScript strict (`noUnusedLocals`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`); vitest; no network in tests.
- Labeling: DEMO DATA / ESTIMATE / AI analysis everywhere required.
- "AI prepares, human approves." No approve/publish/spend paths added.
- Never force-push/rebase/amend pushed history.
- New D-numbers continue from D178.
