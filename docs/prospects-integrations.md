# Prospects — integration & operator guide

The Prospects module is a prospecting CRM inside Xphere built on a **unified
lifecycle model**: a prospect is a `contacts` or `accounts` row with
`lifecycle_stage = 'prospect'`, not a separate table. Xphere is the **hub** —
external products push records and events *into* Xphere, and Xphere calls *out*
to trigger actions. Nothing auto-promotes a prospect; conversion is always
deliberate.

```
 Xcraper ──push leads──▶ ┌─────────────────────────┐ ──outreach──▶ Xmail
                         │  Xphere  (Prospects hub) │ ◀──events────
 (scraped businesses)    │  /api/v1/prospects       │ ──visits────▶ Xpot
                         │  /api/integrations/*     │ ◀──outcomes──
                         └─────────────────────────┘
                                AI qualification (internal)
```

## Data model (migration 1158)

- `contacts` / `accounts` gain `lifecycle_stage`, `engagement_status`,
  `intent_level`, `qualification_status`, `score`, `recommended_channel`,
  `last_contacted_at`, `last_replied_at`, `last_visit_at`, plus `source_*`.
- `prospect_lists` + `prospect_list_members` — named lists (Lists module).
- `prospect_sources` — import/scrape runs (Sources module).
- `prospect_audiences` — saved segments (Audiences module).
- `prospect_conversions` — conversion history (Conversions module).
- `prospect_engagement_events` — the timeline fed by every integration.
- `contacts` / `accounts` also gain `email_status`, `email_verified_at`,
  `email_verification_provider`, `email_risk` (migration 1264) — email
  verification lives ON the prospect, not per-campaign, so it's checked once
  and every channel benefits. See "Email verification" below.

## Email verification (`src/lib/email-verification/`)

Verification status is the prospect's source of truth: `email_status` /
`email_verified_at` / `email_verification_provider` / `email_risk` live on the
`contacts`/`accounts` row itself (companies still keep the raw address in
`custom_fields.email` — only the verification *status* got real columns).

**Provider chain** (`providers.ts`): MillionVerifier (primary) → NeverBounce
(fallback). Each call normalizes onto `EmailStatus = ok | catch_all | unknown
| disposable | invalid | bounced`, or degrades to a typed failure
(`no_credits | unauthorized | unreachable | rate_limited`) — **never throws**.
`verifyEmail()` (`verify.ts`) tries MillionVerifier, falls through to
NeverBounce on any provider failure, and if both are unavailable returns
`{ blocked: true, reason: 'no_verification_credits' }` rather than guessing a
status. Env: `MILLIONVERIFIER_API_KEY`, `NEVERBOUNCE_API_KEY`, optional
`EMAIL_VERIFICATION_LOW_CREDIT_THRESHOLD` (default 500).

**Cache-first** (mandatory — this costs real money per call):
`verifyProspectEmail(orgId, kind, id, email, { force })` returns the row's
existing `email_status` untouched if it was verified within the last 90 days
and isn't `unknown`, without calling any provider. Otherwise it verifies and
persists all four columns. `verifyProspectsBatch()` runs this over many
prospects with a small (~5) concurrency cap and returns an aggregate count by
status plus a `blocked` count.

**Risk / sendability policy** (`risk-policy.ts`, re-exported from
`verify.ts` — change it in exactly one place):
`riskForStatus`: ok→low, catch_all/unknown→medium, disposable/invalid/bounced→high.
`isSendable`: ok/catch_all/unknown→true (catch_all and unknown are
deliberately sendable), disposable/invalid/bounced→false.

**Wired into outreach**: `prospects_enroll_in_campaign` verifies every
candidate before importing to Xmail and filters out non-sendable ones; its
dry-run preview reports `{ verified_ok, catch_all, unknown, blocked_invalid,
blocked_no_credits }` so the human approves knowing exactly what will send.
`prospect_send_message` verifies the single prospect (cache-first) before
sending on `channel: 'email'`. In both tools, if verification is blocked for
lack of credits the response sets `verification_unavailable: true` with a
loud warning — nothing is sent unverified.

**`email_verification_status`** (MCP tool) returns
`getVerificationCreditStatus()` (per-provider configured/credits/ok, plus
`anyAvailable`/`lowCredit`) and a breakdown of the org's prospects by
`email_status`. Poll this on a schedule to alert on low credits.

**Bounce feedback loop**: `/api/integrations/xmail/events` already logs
`bounced` events to the timeline; it now also stamps the prospect's
`email_status='bounced'`, `email_risk='high'`, `email_verified_at=now()`,
`email_verification_provider='bounce'` — a real bounce permanently marks the
address non-sendable across every channel and campaign, not just Xmail.

## Inbound — how external systems reach Xphere

All inbound endpoints authenticate with an **Xphere API key** (`xph_…`, created
in **Settings → API Keys**) sent as `Authorization: Bearer …`. The key's org is
the target workspace.

| Endpoint | Scope | Purpose |
|----------|-------|---------|
| `POST /api/v1/prospects` | `prospects:write` | Ingest prospects (single or batch). Dedup by `source_id` → email/phone (person) / domain/name (company). |
| `POST /api/integrations/xmail/events` | any valid key | Xmail engagement events → timeline + `engagement_status`. |
| `POST /api/integrations/xpot/visits` | any valid key | Xpot visit outcomes → timeline + `last_visit_at`. |

## Outbound — how Xphere reaches the services (env-gated)

A bulk action only appears when its service is configured.

| Service | Env (on Xphere) | What Xphere calls |
|---------|-----------------|-------------------|
| Xmail | `XMAIL_API_URL`, `XMAIL_USER_ID`, `XMAIL_ORG_ID`, `XMAIL_SERVICE_KEY` | `POST {XMAIL_API_URL}/api/outreach/leads/bulk-import` (`x-user-id`, `x-service-key`) |
| Xmail (1:1 send) | same as above, plus optional `XMAIL_ESTIMATE_FROM` | `POST {XMAIL_API_URL}/api/outreach/send-message` (`x-user-id`, `x-service-key`) — used by the `prospect_send_message` MCP tool |
| Xpot | `XPOT_API_URL`, `XPOT_API_KEY` | `POST {XPOT_API_URL}/api/xpot/inbound/prospects` (Bearer) |

## The four integrations

### Xcraper (lead import) — repo `xcraper`
Scraped businesses → company prospects. On the search-results view, **Push to
Xphere** calls `pushRunToXphere`, which posts the run's contacts to
`/api/v1/prospects` (`source.type=xcraper`, `external_run_id`). Dedup key is the
Google Place ID. Env: `XPHERE_API_URL`, `XPHERE_API_KEY`.

### Xmail (email outreach) — repo `skaleclub-mail` (config only)
The **Start outreach** bulk action resolves each prospect's email and bulk-imports
them as Xmail leads. Xmail runs the sending and POSTs engagement events back to
`/api/integrations/xmail/events`, which maps `sent/opened/clicked/replied/
bounced/unsubscribed` onto the timeline and `engagement_status`. **Replies update
engagement only — never lifecycle.** Xmail needs no code changes: point an Xmail
webhook at the Xphere endpoint (with the workspace API key) and set `x-user-id`.

**`prospect_send_message` (MCP tool)** is the reusable "door" for a single 1:1
message to one prospect — e.g. dropping an estimate link into their inbox —
as opposed to bulk campaign enrollment. Email sends through Xmail's native
info@ inbox (`POST /api/outreach/send-message`, defaulting `from` to
`XMAIL_ESTIMATE_FROM` or `info@skale.club`); SMS sends through the org's
connected Twilio number. Gated by `confirmed:true` — the agent must preview
(no `confirmed`) and get human approval before it actually sends. On success
it logs a `sent` row in `prospect_engagement_events` and sets
`engagement_status='contacted'` on the prospect, same as the bulk path.

### Xpot (field visits) — repo `xpot`
The **Send to Xpot** bulk action posts prospects to `/api/xpot/inbound/prospects`,
which creates prospect-stage `sales_leads` carrying `xphere_ref`
("contact:uuid" / "account:uuid", migration 0005). On visit check-out,
`syncVisitToXphere` posts the outcome back to `/api/integrations/xpot/visits`,
stamping `last_visit_at` and the timeline. Env on Xpot: `XPHERE_INBOUND_API_KEY`
(= Xphere's `XPOT_API_KEY`), `XPHERE_API_URL`, `XPHERE_API_KEY`.

### AI qualification (internal)
In the prospect detail sheet, **Suggest** proposes `intent_level`,
`qualification_status`, and `recommended_channel` from engagement signals with an
explainable rationale (deterministic today; an LLM scorer can slot into
`suggestQualification`). **Apply** writes it and logs a `status_changed` event. AI
never converts.

## Operator wiring checklist

1. **Xphere → Settings → API Keys**: create a key with the `prospects:write` scope.
   Copy the `xph_…` token.
2. **Xcraper** env: `XPHERE_API_KEY=<token>` (+ `XPHERE_API_URL` if not prod).
   → "Push to Xphere" appears on the search-results view.
3. **Xmail**: set `XMAIL_API_URL` + `XMAIL_USER_ID` + `XMAIL_ORG_ID` +
   `XMAIL_SERVICE_KEY` on Xphere; in Xmail, add a webhook to
   `https://xphere.app/api/integrations/xmail/events` authorized with the
   `xph_…` token, subscribed to the engagement events.
4. **Xpot**: apply migration `0005` (`drizzle push`); set `XPHERE_INBOUND_API_KEY`
   (any shared secret) + `XPHERE_API_KEY=<token>` on Xpot; set `XPOT_API_URL` +
   `XPOT_API_KEY=<same shared secret>` on Xphere. → "Send to Xpot" appears.
5. Promote the Xphere `dev` branch to `main` to deploy; merge the
   `feat/xphere-integration` branches in `xcraper` and `xpot`.

All connection config is environment-driven — no product domains are hardcoded.
