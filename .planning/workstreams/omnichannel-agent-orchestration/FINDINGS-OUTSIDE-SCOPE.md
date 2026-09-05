---
type: findings
created: 2026-09-03
workstream: omnichannel-agent-orchestration
---

# Findings Outside This Workstream's Scope

Three defects surfaced while building the Phase 135 release gate and applying its
migrations. None is caused by this workstream, and none is covered by its 32 requirements.
All are recorded here rather than fixed silently or dropped.

---

## 1. Cross-organization leak in `get_org_member_profiles` — FIXED AND APPLIED (2026-09-04)

**Severity: high.** Any authenticated user could read any organization's full member list,
including each member's email and phone.

`public.get_org_member_profiles(p_org_id, p_page, p_per_page)` is `SECURITY DEFINER` so it
can join `auth.users`, which authenticated users cannot query directly. Its only predicate
was `om.organization_id = p_org_id`. It never checked whether the caller belongs to that
organization, and `SECURITY DEFINER` bypasses RLS — so passing an arbitrary organization id
returned that organization's members.

This breaks the platform's core multi-tenant invariant, and it is the exact property the
`agent-partner-edge-authz` work in Phase 132 was hardening at the agent layer.

**How it surfaced.** `tests/security-secdef-isolation.test.ts` has been failing
deterministically on the case `get_org_member_profiles refuses to enumerate members of a
foreign org` — it sat inside the 30-file "pre-existing baseline" this workstream had been
carrying since Phase 132, treated as environmental noise. It was not noise. The test was
correct and the function was wrong. The three sibling SECDEF functions in the same suite
(`get_current_org_id`, `get_user_org_ids`, `get_tag_usage`) all isolate correctly; this one
was the outlier.

**Fix.** `supabase/migrations/1295_fix_member_profiles_cross_org_leak.sql` adds a caller
membership check. A non-member receives an empty result rather than an error, which the
existing UI already handles and which avoids leaking whether an organization id exists.

**Status: applied 2026-09-04**, on the user's explicit instruction, via `npx supabase db push`
together with 1290-1294. `tests/security-secdef-isolation.test.ts` is green (4/4) and has been
returned to `GATE_MEMBERS` in `scripts/release-gate.ts`.

**The first attempt failed, and the failure was load-bearing.** Postgres rejected it with
42P13, "cannot change return type of existing function". The deployed function returns an
`avatar_url` column and resolves `phone` as
`NULLIF(TRIM(COALESCE(raw_user_meta_data->>'phone', au.phone)), '')`; migration 1037 in this
repository has neither. Production had drifted from the repo — see finding 3 below. Because
the first version of 1295 was transcribed from 1037, it would have dropped `avatar_url`, and
`src/app/(dashboard)/members/actions.ts` consumes that field. Postgres caught what review did
not. The applied version is the live definition with the membership predicate added and
nothing else changed.

**Lesson for this workstream:** the "pre-existing baseline" framing was load-bearing and
partly wrong. A stable set of failing tests is a place real defects hide. The suite is now a
gate member precisely so this cannot regress unnoticed a second time.

---

## 2. Twenty-four write actions are not classified as side-effecting — NOT FIXED

`requiresIdempotency()` decides whether the guard runs by asking whether an action type is
in `SIDE_EFFECTING_ACTIONS`. Deriving the Action Engine's action types from source found 48
of them. Eleven are classified side-effecting, thirteen are deliberate reads, and **twenty-four
are writes that are in neither bucket**:

`google_contacts_create`, `google_contacts_update`, `google_contacts_delete`,
`manychat_set_field`, `manychat_add_tag`, `manychat_trigger_flow`, `manychat_send_message`,
`send_whatsapp_message`, `send_whatsapp_template`, `send_whatsapp_mention_all`,
`send_telegram_notification`, `pipeline_move_opportunity`, `pipeline_update_opportunity`,
`pipeline_mark_won`, `pipeline_mark_lost`, `pipeline_add_note`, `pipeline_assign_user`,
`pipeline_create_opportunity`, `create_task`, `create_note`, `send_email`,
`send_tenant_email`, `send_platform_email`, `send_zernio_dm`.

Every one is structurally exposed to the same double-execution-on-retry bug the Xkedule
booking mutations had (`d0a162bf`). `send_sms` is classified; `send_whatsapp_message` is
not, which is hard to read as anything but an oversight.

**Why it was not fixed here.** Adding twenty-four action types to the guard changes
behavior across email, WhatsApp, ManyChat, Telegram, Google Contacts, tasks, notes and the
whole pipeline surface — well outside this workstream, and outside what a late autonomous
run should widen into unreviewed. The guard also fails closed on a lookup error, so
misclassifying an action that legitimately repeats would suppress real work.

**What protects against recurrence in the meantime.** `tests/coverage-pins.test.ts` derives
the action list from `execute-action.ts` and fails on any type that is in no bucket, so a
newly added action cannot slip in unclassified. The twenty-four sit in an explicit
`WRITES_PENDING_IDEMPOTENCY_REVIEW` bucket — visible, named, and pinned, rather than
invisible.

**Recommended next step:** classify them in a dedicated phase, one integration family at a
time, checking for each whether a repeat is a bug or a legitimate re-send.

---

## 3. The repository's migration history had drifted from production — NOT RECONCILED

`get_org_member_profiles` is defined in `supabase/migrations/091_member_profiles_fn.sql` and
`1037_member_profiles_fn.sql`, and in no other migration — a `grep` over the whole directory
confirms it. Yet the deployed function differs from 1037: it returns an extra `avatar_url`
column and resolves `phone` through the user's metadata before falling back to `auth.users`.

Someone changed that function in production without leaving a migration in this repository.
That is precisely what `CLAUDE.md` warns the Supabase MCP `apply_migration` tool and the
dashboard SQL editor cause, and it means a fresh `supabase db reset` would not have
reproduced production.

Migration 1295 repairs this one function by transcribing the live body, so the repo and the
database now agree on it. **Nothing else was audited.** Other objects may have drifted the
same way and would only surface the way this one did — when a migration collides with them.

**Recommended:** a one-time reconciliation pass comparing the live schema against what the
migration directory reproduces, before the next schema change lands on a drifted object.

---

## 4. The Vapi webhook secret in Vapi is the PREVIEW value — NOT RECONCILED

Coolify holds two `VAPI_WEBHOOK_SECRET` entries for `xphere-zdt`: a production-scope value
(64-hex fingerprint `cce78c95c0d7`, 66 chars) and a preview-scope value (`0a3d5b262a02`,
64 chars). The secret attached to every tool in the Cuts & Culture Vapi assistant
fingerprints as `0a3d5b262a02` — the **preview** one.

Yet production accepted it: a probe against `https://xphere.app/api/vapi/tools` with that
secret returned real data, and a control with a wrong secret returned nothing. So either the
running container was started with the preview value (see the 2026-06-10 scope migration
note in the Coolify memory), or the 66-char production entry differs only by trailing
characters and is not what the process compares against. Not investigated further because
it was not the cause of the failed calls — the payload shape was (fixed in `src/types/vapi.ts`).

**Why it matters anyway:** the next deploy or env sync could rotate the container onto the
66-char value, at which point every Vapi tool call would be silently rejected with
`{results: []}` and zero logs — exactly the failure mode just diagnosed, with a different
root cause. Reconcile so Vapi and production hold one value, and add the rejection path to
observability: `obs.warn('vapi_secret_rejected')` did not surface in Sentry logs for the
window in which it must have fired.

## 5. Vapi's tool timeout is shorter than our booking write timeout — FIXED (2026-09-05)

Found 2026-09-05 while re-analysing the voice path. Neither the assistant
(`99518fa7-…`) nor the phone number (`+1 224 551 6131`) carries a `server` block; tool calls
route through the Vapi **organization-level** server URL, which the API does not expose, so
the effective per-tool timeout is Vapi's default of **20 seconds**. Our Xkedule client waits
up to **30 seconds** on a write (`WRITE_TIMEOUT_MS`, raised after the widget-side abort that
told a customer their booking failed while it succeeded).

**Why it matters:** a booking that takes 20–30s completes on our side while Vapi has already
spoken the `request-failed` line — the exact defect fixed on the widget, reproduced on the
phone. Measured writes today run well under 20s, so this is latent, not active.

**Fixed** while restoring per-tool routing (item 8): every tool now carries
`server: { url: 'https://xphere.app/api/vapi/tools', secret, timeoutSeconds: 30 }`, matching
`WRITE_TIMEOUT_MS`, and `pushAssistantConfig()` carries that block through every later push. Not done autonomously because the org-level URL (and any secret it carries) is
invisible through the API, and moving routing onto an assistant-level block is an
outward-facing change to a live line that should be made with the Vapi dashboard open.

## 6. The assistant still carries a hardcoded `firstMessage` — INERT, NOT FIXED

`firstMessage` on the live assistant is `"Cuts and Culture, this is the front desk - how can
I help?"` — tenant text, and the open question the prompt itself forbids. It is inert
because `firstMessageMode` is `assistant-speaks-first-with-model-generated-message`, so the
model generates the opening from the prompt and never reads this string. It becomes live the
moment someone switches the mode in the Vapi dashboard. `pushAssistantConfig()` does not
manage either field; it should own `firstMessageMode` and null the message, one line each.
Left as is to keep the push's blast radius to `model.messages` and `model.tools` until the
operator has seen the first pushes behave.

## 7. Transcriber and speaking plans are Vapi defaults — OBSERVATION

`transcriber: null`, `startSpeakingPlan: null`, `stopSpeakingPlan: null`. The voice path has
never been tuned at the Vapi layer; every latency measurement in this workstream is of our
side only. If the demo feels slow to respond after the caller stops talking, the first lever
is here, not in Xphere.

## 8. The first real push dropped every tool's routing — FIXED (2026-09-05), WITH A GUARD

The first `pushAssistantConfig()` run against the live assistant (2026-09-05 ~03:25Z) replaced
`model.tools` with functions carrying `type`, `function` and `messages` — and no `server`. Every
tool had carried `server: { url: 'https://xphere.app/api/vapi/tools', secret }`; the assistant
and its phone number carry no server block of their own. So for roughly ninety minutes the
phone robot answered, decided to look the caller up, and sent the lookup nowhere.

Found by re-analysis, not by a call: the Vapi call log for the window is empty, so no real
caller was affected. It was found because `tests/manual/vapi-secret-fp.test.ts` reads the secret
off `t.server.secret`, and a later probe printed `server: null` for all eight tools.

**Fixed:** routing restored on all eight tools (the secret was recovered from the account's
sibling assistants, which carry the same value — fingerprint `0a3d5b262a02`, the one production
accepts — at assistant level), with `timeoutSeconds: 30`. `pushAssistantConfig()` now carries
each tool's existing `server` block through a push, lets a new tool inherit the block its
siblings share, and **refuses** to push when any tool would end up with no routing and the
assistant has no server of its own. The refusal was proven live against the broken state
before the restore.

**Why it matters beyond this incident:** it is the seventh instance in this workstream of a
mechanism that was correct about what it rendered and silent about what it discarded. The push
was verified by reading back the prompt and the messages it had rendered — exactly the fields it
knew about — and not the field it had never modelled. A PATCH that replaces an array must be
verified against the array it replaced, not against its own output.

## 9. The widget mesh cannot answer a cold availability question inside its turn budget — MEASURED, NOT FIXED

Two widget turns through the real mesh, 2026-09-05 04:22Z, local runtime against the live
tenant (`tests/manual/e2e-widget-mesh.test.ts`, traces in `agent_invocations`):

| Turn | Result | Orchestrator total | First specialist starts at | Inside the specialist |
|---|---|---|---|---|
| "What haircuts do you offer and how much is a skin fade?" | success | 22.7s | +9.1s | Services 6.8s and Pricing 10.3s in parallel; `list_services` 2.2–2.5s, `get_quote` 2.6s |
| "Anything open on September 8th for a signature haircut?" | **aborted, `turn_timeout`** at 30.9s | — | +8.2s | Availability 22.5s: `list_services` 1.6s, then `check_availability` **13.9s** |

The turn budget with tools is `AGENT_TURN_TIMEOUT_MS_TOOLS` = 30s. A cold availability
question needs ~31s, so the customer is told “I cannot help with that right now” for the one
question the whole system exists to answer.

**Where the time is — and where it is not.** The raw orchestrator decision, measured
directly through OpenRouter with the real rendered prompt and five delegation tools
(`tests/manual/orchestrator-model-bench.test.ts`, three runs each):

| Model | Decision latency | Picked |
|---|---|---|
| anthropic/claude-sonnet-4.6 (current) | 2.0 / 1.9 / 2.1s | handoff_to_availability |
| anthropic/claude-haiku-4.5 | 1.3 / 1.2 / 1.3s | handoff_to_availability |
| openai/gpt-4.1-mini | 0.9 / 0.9 / 1.3s | handoff_to_availability |
| google/gemini-2.5-flash | 0.7 / 0.5 / 0.5s | handoff_to_availability |

So the 8–9s between the orchestrator starting and the first specialist starting is **not the
model** (2s). Six to seven seconds are runtime overhead before and around that call:
sequential Supabase round trips in `runAgent` (resolve agent, load history, build tools,
resolve partner edges, insert the invocation row), plus the specialist's own resolution before
its row is inserted. From a Windows dev box each round trip is 100–300ms; the production
container should be faster, and this has not been measured there. **Measure the stages before
optimising them**: `runAgent` records no per-stage timings, only the total.

**The levers, in order of expected effect:**

1. **Cache availability across the price-confirmation turn.** The conversation design forces a
   `get_quote` and a wait for “yes” between choosing the service and asking the day. Prefetch
   `check_availability` for today + 2 days with the same service ids when `get_quote` runs,
   hold 60s in-process. The 13.9s becomes ~150ms on the turn that matters.
2. **Stage timings in `runAgent`** (one structured log with ms per stage), then collapse the
   sequential Supabase reads that the timings show. This is probably the larger fix and cannot
   be sized without the numbers.
3. **Orchestrator model.** The orchestrator routes; it never states a fact, so the reason to
   reject `gemini-2.5-flash-lite` for a *specialist* (it invented a slot) does not apply to it.
   Haiku saves ~0.8s per turn, gpt-4.1-mini ~1.1s, gemini-2.5-flash ~1.4s — real but the
   smallest lever of the three. Also cap `max_tokens` on the orchestrator (currently null).
4. **Raise `AGENT_TURN_TIMEOUT_MS_TOOLS` for the widget** as a stopgap only. It makes the
   customer wait 35s instead of being refused at 30s; it fixes nothing.

Voice is unaffected by this budget: it runs on legacy routing with Vapi calling
`/api/vapi/tools` directly, one tool per request, and `check_availability` at 8–14s cold sits
inside Vapi's 30s per-tool timeout (item 5). The widget is where the mesh's inference hops
stack up.

## 10. `captureOrgSnapshot()` through a service-role client captured every tenant — FIXED (2026-09-05)

Every query in `src/lib/org-templates/snapshot.ts` relied on RLS alone for its tenant scope.
Through the authenticated client the server action uses, that is exactly one organization.
Through a service-role client it is the whole platform: the first ops probe of the replication
path captured **325 agents, 364 pipelines and 245 workflows across all tenants** in one call,
and would have installed them into the target had it not been a dry run.

**Fixed:** `captureOrgSnapshot(supabase, groups, { organizationId })` applies the tenant filter on
every top-level query; the server action passes it as defence in depth; a service-role caller
must pass it. Pinned by a two-tenant fake in `tests/org-templates-agents-capture.test.ts`.

## 11. The replication proof ran on the real database — DONE (2026-09-05)

Through the product's own `captureOrgSnapshot()` → `installSnapshotIntoOrg()` (not a fixture),
Cuts & Culture was captured with every asset group and installed into a new organization
`ZZ Template Test (scratch)` (`fbead582-b6e1-467e-8b2b-dc3729733555`, slug
`zz-template-test-scratch`), created the way `createOrganization()` does it, with the same
owner. Result: 7 agents each with an active prompt version, 8 partner edges, 17 delegated
grants, 16 direct grants, 8 workflows (as drafts), 1 pipeline with 5 stages, both channel
defaults, and **no** `agent_channel_routing_modes` row — install never activates. Both the
orchestrator and the voice receptionist resolve through the real `resolveAgent()` to prompts
that open with “You are the front desk at ZZ Template Test (scratch)”.

What a second real tenant still needs after this, and what the runbook covers
(`docs/agents/tenant-replication-runbook.md`): connect Xkedule, activate the eight workflows,
set business type and modality in Company Info, create and map a Vapi assistant and push its
config, then flip routing per channel when ready. The scratch org can be deleted or reused as
the target for the UI walkthrough.
