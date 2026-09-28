# Enterprise readiness — design notes (PROPOSED, not built)

Phase 5, Stream C. **DOCS ONLY.** Everything below is a design proposal
for enterprise motion; none of it is implemented. Where existing platform
behavior is referenced (workspaces, roles, audit logs, Lovable Cloud /
Supabase), it is marked REAL (code); the enterprise features built on top
are marked PROPOSED.

Standing rule carried through: "AI prepares, human approves" — nothing in
the enterprise design grants any automated path past the existing
human-approval gates for publish/schedule/spend.

## 1. SSO / SAML — design notes (PROPOSED)

### 1.1 Architecture options

| Option | How it works | Fit |
|---|---|---|
| **A. Supabase Auth SAML 2.0** | Supabase Auth supports SAML as an enterprise SSO provider. The workspace's IdP (Okta, Entra ID, Google Workspace) is configured as a SAML provider; users sign in with `supabase.auth.signInWithSSO({ domain })` or an SSO button. Claims (email, groups) flow into Auth, and Vidora maps them to workspace roles. | Preferred — least new code; rides the existing Supabase Auth surface (Lovable Cloud). |
| **B. External IdP via OIDC** | IdP's OIDC provider connected to Supabase Auth; same role-mapping layer as A. | Fallback for IdPs that do SAML poorly but OIDC well. |
| **C. Custom SAML SP** | Vidora runs its own SAML service provider. | Rejected (proposed): duplicates Supabase's surface, high audit cost. |

### 1.2 Workspace-level enforcement (PROPOSED)

- SSO is a **workspace** setting, not a user setting. Workspace owners
  (REAL (code): `workspace_members` roles, `workspaces` table, F40) enable
  "Require SSO" for their workspace.
- Once enforced: email/password sign-in is disabled for members of that
  workspace; existing sessions are re-validated on next sensitive action
  (approve/publish/billing changes).
- Domain capture: one or more verified email domains bound to the
  workspace; users with those domains are routed to the workspace's SSO
  provider at sign-in.
- Role mapping: IdP groups → workspace roles (`owner | admin | member |
  viewer`, per existing role model). Default mapping proposed:
  IdP "admins" group → workspace `admin`; everyone else → `member`.
  Explicit overrides stay manual — no silent privilege grants from new
  IdP groups (fail closed).
- Break-glass: at least one non-SSO owner credential (or service access)
  is retained per workspace so a misconfigured IdP cannot permanently
  lock the workspace out. Documented in the runbook; tested quarterly.

### 1.3 Session & audit implications (PROPOSED)

- SSO sign-ins and role-mapping decisions are written to `audit_logs`
  (REAL (code) table) as `auth.sso_login` / `auth.role_mapped`.
- Session lifetime for SSO workspaces is set by policy (proposed default:
  12h idle, 7d absolute), re-prompting the IdP as needed.

### 1.4 Open items before build

- Confirm Supabase Auth's SAML provider limits on the Lovable Cloud plan
  (number of providers, custom certificates) — unverified.
- Decide JIT provisioning vs. invite-only membership for SSO users
  (proposed: invite-only by default, JIT as an opt-in per workspace).

## 2. DPA outline (PROPOSED)

A template Data Processing Agreement covering Vidora's role as **processor**
and the customer as **controller**. Draft outline — not legal advice; final
text needs counsel review.

### 2.1 Processor terms

1. **Subject matter & duration** — processing only to provide the Vidora
   service (video creation pipeline, analytics, storage of projects/renders),
   for the duration of the subscription plus the retention wind-down.
2. **Nature & purpose** — hosting user-provided scripts, media, renders;
   generating AI content from user inputs; serving analytics dashboards.
3. **Categories of data** — account identity (email, name), workspace
   content (scripts, drafts, uploaded media, renders), usage metadata
   (audit logs, API calls), billing contact details. **No special-category
   data is solicited**; customers must not upload it.
4. **Instructions** — process only on documented customer instructions;
   notify the customer if an instruction appears to breach data-protection
   law and suspend processing pending clarification.
5. **Confidentiality** — personnel bound by written confidentiality;
   access on least-privilege basis (ties to workspace roles, REAL (code)).

### 2.2 Sub-processors

- Maintain a public sub-processor list with: name, purpose, data handled,
  location. Proposed initial list (to verify before publishing):
  - Cloud/database hosting (Lovable Cloud / Supabase — region per §3)
  - AI generation providers (LLM gateway, TTS, image/video models)
  - Email delivery, payment processing (Dodo/Razorpay per brief)
- Change policy: 30-day advance notice of sub-processor additions;
  customer right to object with a termination-for-cause path.

### 2.3 Breach notification

- Notify the customer **without undue delay and within 72 hours** of
  becoming aware of a personal-data breach affecting their data.
- Notification includes: nature of the breach, categories/approximate
  volumes, likely consequences, measures taken/proposed.
- Internal runbook hook: breaches detected via audit-log monitoring
  (`audit_logs`, REAL (code)) feed the incident process.

### 2.4 Assistance & audit

- Assist with DPIAs and data-subject requests within the agreed SLA.
- Customer audit right: annual, with reasonable notice, via a mutually
  agreed auditor; findings remediated on a committed timeline.
- Deletion/return at termination per §4 flows below.

## 3. Data residency (PROPOSED)

### 3.1 Region pinning

- Vidora runs on Supabase (Lovable Cloud); the **Supabase project region
  is the residency anchor**. Proposed: new enterprise workspaces can be
  provisioned pinned to a chosen region (e.g. EU, US, APAC) at workspace
  creation; the choice is immutable after creation (data never migrates
  silently).
- Data classified by residency sensitivity:
  - **Pinned**: `projects`, drafts, scripts, uploaded media, renders,
    user PII (`auth.users` profile fields), `audit_logs`.
  - **May transit**: ephemeral LLM generation calls (documented in the
    DPA; provider regions disclosed as sub-processors).
- Backups stay in-region (verify with the hosting provider before
  promising this — unverified).

### 3.2 Export flow (PROPOSED)

- Workspace owner can request a full export: all projects, scripts,
  drafts, media, renders, analytics snapshots, and audit logs for the
  workspace, delivered as a structured archive (JSON + original media).
- Export is generated **server-side** (never via the client SDK bulk
  reads), rate-limited, and itself audit-logged as `data.export`.
- Proposed SLA: export completed within 7 days of request; large media
  libraries may be staged in parts.

### 3.3 Delete flow (PROPOSED)

- **Account deletion**: user requests deletion → 30-day soft-delete grace
  (reversible on sign-in) → hard delete of PII and workspace-owned content
  where the user is the sole owner.
- **Workspace deletion**: owner-initiated → confirms billing impact →
  soft-delete 30 days → cascade hard delete of projects, drafts, media,
  renders, analytics, and audit logs scoped to that workspace.
- **Retention exceptions** (documented in the DPA): billing records kept
  per tax-law minimums; anonymized/aggregated analytics may be retained
  where no longer personal data.
- Deletion jobs are idempotent and logged; a verification query confirms
  zero remaining rows for the workspace before the job is marked done.

### 3.4 Residency verification checklist (PROPOSED, pre-launch)

- [ ] Supabase project region documented per environment; enterprise
  workspaces created in the chosen region.
- [ ] Sub-processor list published with provider regions.
- [ ] Export/delete flows tested end-to-end on a staging workspace.
- [ ] 30-day notice + objection process for sub-processor changes live.
- [ ] Counsel sign-off on the DPA template.

## 4. What is NOT claimed

- SSO/SAML is not implemented; no SAML provider is configured.
- No DPA has been signed with any customer; the outline above is not a
  legal document.
- Region pinning, export, and delete flows are not built; current deletion
  behavior follows the existing schema, not the flows above.
- Nothing here changes the "AI prepares, human approves" gates.
