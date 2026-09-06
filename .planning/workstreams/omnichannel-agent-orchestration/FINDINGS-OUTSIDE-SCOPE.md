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

## 9. The widget mesh cannot answer a cold availability question inside its turn budget — MEASURED; LEVERS 1 AND 2 SHIPPED 2026-09-05

Shipped the same day, in `0025c5fe` and the xkedule changes carried in `c46a96c3`/`fc8efa26`:
`runAgent` now logs `agent_turn_timings` per turn (resolve_agent, cost_cap, knowledge,
invocation_insert, llm_provider, tool_build, model_first_call, total) on both paths, and the
four independent pre-model reads (LLM provider, agent_tools rows, workflow tools, partner
tools) run in parallel instead of in sequence; `check_availability` reads through a 60s cache
that `get_quote` pre-warms for today and the next two days in the tenant's timezone. The
production measurement of the effect is below the original analysis.

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

**Voice, measured in production (2026-09-05, after the route cache in `496dff9b`).** Each
tool through `https://xphere.app/api/vapi/tools` as Vapi calls it, two runs; `vapi_tool_timings`
from the container log for the last pair:

| Tool | Before cache (1st / 2nd) | After cache (1st / 2nd) | Stage split (after) |
|---|---|---|---|
| `lookup_customer` | 5.4 / 3.5s | 4.5 / 3.2s | provider ≈ all of it (two sequential Xkedule calls) |
| `business_info` | 2.2 / 1.8s | 2.0 / 1.4s | |
| `list_services` | 3.6 / 1.5s | 2.0 / 1.4s | |
| `get_quote` | 3.8 / 3.4s | 3.4 / 3.6s | provider |
| `check_availability` | 9.6 / 10.0s | 9.4 / **0.74s** | cold: resolve 687ms + provider 7938ms of 9188; warm: resolve 0 + provider 570 of 574 |

So our route now costs ~0.5s cold and ~0 warm; **the provider is the whole remaining cost**.
The second `check_availability` at 0.74s is the provider's own warm window, which is exactly
what the prefetch-at-quote lever exploits. `lookup_customer` at 3–4.5s now sits between the
caller's first sentence and the robot's first reply (the opening line is fixed and instant),
so warming it at call start is the next voice lever: Vapi's `status-update` at
`in-progress` carries the caller's number before anyone has spoken.

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

## 12. The production widget had no conversation memory — FIXED (2026-09-05)

Driving the production widget through service → price → day, the third turn answered
“what service are you looking to book?” to a customer who had named it one message earlier;
a direct test (“what is my name and which service did I ask for?”) got “this is the start of
our conversation”. Every turn came back with a **new** `sessionId`.

Cause: widget sessions were held in Redis only, `getSession()` returns null when Redis is not
ready, and the production container has **no `REDIS_URL`** at all. So every message minted a
new session and a new `conversations` row, and the agent saw an empty history — while the
messages were being faithfully persisted to `conversation_messages` the whole time, and
`loadSessionFromDb()` in `persist.ts` already knew how to rebuild the context from them.
Nothing called it. The eighth instance of a mechanism built and never reached.

**Fixed** in `9c7c1680`: the route resolves the organization first, tries Redis, then reloads
the session from the database (org-scoped, last 20 rows), and only then applies the session
rate limits — a resumed conversation counts as resumed (R3) instead of burning the per-IP
new-session budget (R4), which without Redis would have blocked the eleventh message of an
hour. A database error degrades to a fresh session, never a 500. Pinned in
`tests/chat-api.test.ts`.

**Also:** the entry orchestrator prompt (version 8, mirrored into `canary/cuts-and-culture.json`
and kept as `canary/entry-orchestrator-prompt.md`) now carries the same conversation design as
voice — service, price, day, name and phone only at booking — and states that a specialist
sees only the handoff, so the service the customer named must travel in `summary` /
`extracted_params`. Before this the orchestrator asked open questions and requested name and
phone up front.

Redis itself remains unprovisioned in production. With the database as the source of truth
it is now an optimisation, not a dependency; the rate limiters already run in-memory without it.

## 13. What the widget's day turn was really paying for — FIXED (2026-09-05)

After the prefetch shipped, the availability turn still took 35–40s in production and
timed out. `workflow_tool_logs` showed why: the Availability specialist called
`check_availability` **twice**, 12.8s and 13.0s, with `startDate`/`endDate` on the same day.
That is the range path of `check-availability.ts`, which is uncached by design — so the
date the quote had just pre-warmed sat unused while the provider was asked cold, twice.
A one-day range is now folded into the single-date, cached path.

Two more things the same measurement settled:

- The orchestrator on Sonnet used the `think` tool before every handoff — a full model
  round trip per turn. It now runs on Haiku, is told not to think, and answers a repeated
  price question from memory in 2.8s.
- Memo TTLs of 30s never hit: a widget turn through the mesh takes ~20s, so every
  resolution expired between one turn and the next. `resolveAgent` is now held two minutes;
  the services catalogue five, business info ten (per tenant).

Voice, final numbers through production as Vapi calls it (warm run): `lookup_customer`
0.17s (warmed at pickup), `business_info` 0.46s, `list_services` 0.86s, `get_quote` 2.3s,
`check_availability` 0.56s. The provider's quote endpoint is the one thing left that is slow.

## 14. No agent knew what day it was — FIXED (2026-09-05)

The availability turn kept timing out after items 9 and 13. `workflow_tool_logs` showed the
Availability specialist asking the provider for **2024**-09-08, then 09 and 10 — three cold
calls, ~21s, for a year nobody is in. The orchestrator on Haiku had skipped the `datetime`
tool and passed "September 8th" through the handoff; the specialist guessed the year.

`runAgent` now appends one line to every agent's system prompt on both paths — "Today is
Friday, 2026-09-05 (America/New_York). Resolve every relative day to a full YYYY-MM-DD date
in this year before using it." — from `organizations.timezone` (memoised 10 minutes, UTC when
absent). This replaces relying on the model to remember a tool call. Pinned by
`tests/agent-today-line.test.ts`.

## 15. End of day, measured in production (2026-09-05, after `52049a47`)

Widget, the demo's own three turns, same session, all answered correctly:

| Turn | Before (first measurement) | After |
|---|---|---|
| "Hi, I'd like to book a haircut." | 10–21s, open questions, asked for name and phone | 18.8s, one narrowing question |
| "Just the signature haircut, how much is it?" | 19–22s | 14.9s (2.8s when answered from memory) |
| "Ok. What do you have open on September 8th?" | **aborted at 30s**, or lost the service, or 2024 | 14.4s, three real times, right year |

What remains in a ~15s widget turn is structural: two model hops (orchestrator decide +
compose, specialist) on OpenRouter plus one provider call, with pre-model overhead now
~1s per hop. The next lever is architectural — let the orchestrator answer a plain price or
catalogue question itself from cached data rather than delegating — and is a design decision,
not a defect.

Voice, warm, through production as Vapi calls it: lookup 0.17s (warmed at pickup), business
info 0.46s, services 0.86s, quote 2.3s, availability 0.56s. The greeting is instant.

## 16. The first real call (booking #479) and what it changed — FIXED (2026-09-05), for both channels

The operator called +1 224 551 6131 and booked a buzz cut for Monday 09-07 16:00 in 3m24s.
The booking landed. The feedback, and where each fix lives (engine or shared config, never
one channel's prompt):

| Heard on the call | Cause | Fix |
|---|---|---|
| First second of the greeting lost | PSTN audio not yet up when Vapi starts speaking at 1.4s | Greeting now opens with "Hi there!" so the clipped second is not the business name |
| Cut off mid-sentence ("I wanna book a-") and had to repeat | Default endpointing (0.4s pause = end of turn) plus the lookup's spoken line interrupting | `startSpeakingPlan` 0.8s + smart endpointing provisioned by the push; lookup has no spoken line (it is warmed at pickup); prompt continues the caller's own sentence |
| "We have three options" | Prompt | Options named the way a person would; "which would you like?" |
| "What day would you like to come in?" | Prompt | "What's the best day for you?" |
| Sunday reported as "fully booked" | Provider returns an empty list for closed and for full | `check_availability` consults business hours (cached) and says "closed on Sunday", suggesting the next open day — proven in production |
| Never asked "anyone, or someone in particular?" though staff have their own calendars | Prompt | Asked before any availability check, staff id carried into every later call, on voice and widget |
| Redundant closing; no "anything else?" | Prompt | Read-back, then one "anything else you'd like to add?", then book |
| 25s of silence while booking | Provider write took 24.4s; only a request-start line | 60s timeout on the three writes, "still working on that" at 8s, widget tool-turn budget 45s, `WRITE_TIMEOUT_MS` 60s |
| Voice flat, slow, robotic; filler words | Stock `vapi/Elliot`; model openers | ElevenLabs "sarah" (turbo v2.5) provisioned by the push; prompt forbids "Perfect/Great/Sure thing" and self-narration |
| Availability cold twice (10.8s + 13.4s) despite the prefetch | Model sent `includeStaff: true` unasked, a different cache key | Field described as "only when the customer asks who" (workflow schema, so both channels) |
| Calls page shows the call as `ringing` | Raw `call.status` persisted from the report | `ended` |
| No booking confirmation to the caller | Xkedule's webhook is not configured for this tenant (0 mirrored bookings), the org has no SMS channel, and the platform only emitted meeting events from that webhook | Engine now emits the booking-created event from the Action Engine itself (see item 17); an SMS-capable number is still an operator step |

## 17. Booking confirmation: the event now comes from the engine — DONE (2026-09-05); two operator steps remain

`1145ef50`: when `book_appointment` succeeds, the Action Engine itself mirrors the booking
and emits `meeting.scheduled` (and `meeting.confirmed` when the provider returns it as
confirmed), with the same payload and the same dedupe key the Xkedule webhook uses — so the
platform's seeded workflows (confirmation email, reminders) fire on both channels the moment a
booking is made, without a round trip through the provider's webhook. If the webhook is
configured later, its delivery finds the mirror row and takes the update branch; nothing fires
twice.

What it does **not** do, deliberately: a booking the provider returns as **pending /
awaiting approval** emits nothing (MIR-07 — the provider can still reject it, and the mirror
table's status constraint has no honest value for it).

**Why the demo caller still gets no message, and what to do about it — both are settings,
not code:**

1. **The demo shop's bookings come back `pending`** (#471, #479). Until the Xkedule demo
   tenant is set to auto-confirm, no `meeting.confirmed` fires. Flip that in Xkedule.
2. **The org has no channel to send with.** No SMS-capable number (Twilio) and no WhatsApp
   connection; the seeded confirmation is an email, and a phone caller gives no email. Connect
   an SMS number to the organization and add a "booking confirmed → SMS to
   `{{meeting.booker_phone}}`" workflow (the builder has `send_sms`), or connect WhatsApp.

## 18. The synthetic event type could not be created for the demo org — FIXED (2026-09-05); notification proven end to end

`event_types` is unique on **(user_id, slug)**, not per organization. The demo org's owner
already held `xkedule` in Skale Club (created by the webhook mirror there), so every
`getOrCreateEventType()` in the demo org failed on a duplicate key, the emitter warned
"no org member to own the synthetic Xkedule event type" — the wrong cause — and bookings
#480 and #481 produced no `meeting.requested` and no SMS. New rows now use `xkedule-<org8>`
(`78f2c89e`); organizations already holding the plain slug keep matching on it.

**Proof, in production, on the phone robot's own path:** booking #482 through
`/api/vapi/tools` → `meeting.requested` dispatched at 19:15:23 to "Booking request received"
→ `send_sms` executed and completed at 19:15:25–26 from +1 866 724 0005 to the phone that
made the day's call. Bookings #480–#482 were then cancelled directly at the provider (no
events, no cancellation texts).

What a real customer now gets: "we received your request" the moment they book, on either
channel; "you're confirmed" when the shop confirms (or immediately, once the Xkedule demo
tenant is set to auto-confirm). Still an operator setting: that auto-confirm flag.

## 19. The second real call (21:00) and the model/transcriber decisions — FIXED (2026-09-05)

Two minutes, hung up. What the transcript showed:

- After the greeting, 11.5s of silence, then the bot: *"I need to look up your account first.
  What's your phone number?"* The number **was** in the prompt (`caller's number, +15088018190`
  verified in the call's own system message); the model (Haiku via Vapi) ignored it on a turn
  with no caller speech, misheard the dictated digits, found nobody, and re-asked the opening
  question. Prompt v7 now says the number is known, never to ask for it, and to ask only
  "which service?" when the caller has not spoken.
- The caller's speech arrived as fragments ("I either 4", "Who can", "Okay. JD?") and the bot
  was cut off by any sound. The model-based "smart endpointing" enabled that morning was the
  cause. Replaced by transcription-based endpointing (0.3s after punctuation, 1.5s without,
  0.6s wait) and a stop plan that needs two words before the bot yields. Transcriber set
  explicitly to OpenAI `gpt-4o-transcribe` (the operator asked for Whisper; this is its
  streaming successor — Whisper itself is batch-only).

**Model, measured for a voice decision (real prompt, the 8 functions, "a haircut please"):**

| Model | Minimal reasoning | Default reasoning (what Vapi sends) |
|---|---|---|
| openai/gpt-5-mini | 1.1s, correct call | 2.5–2.6s, **no tool call** |
| openai/gpt-5 | 1.0–1.8s, correct | 2.8–3.8s, **no tool call** |
| openai/gpt-5-nano | 0.9–1.1s, correct | 1.8–2.2s, **no tool call** |
| openai/gpt-5.1 | 1.6–2.0s, correct | **1.0–1.4s, correct** |
| openai/gpt-5.2 | 2.9s | — |

The operator asked for OpenAI, generation 5 or newer. Only `gpt-5.1` is fast and correct with
the reasoning setting Vapi can send, so both channels run `openai/gpt-5.1` now (Vapi assistant,
entry orchestrator, voice receptionist, five specialists), mirrored into the template.
Widget on it: 7.2s / 15.3s / 22.6s for the demo's three turns, all correct.

One thing it exposed: the prompts' example line named this shop's own services, and gpt-5.1
recited it without calling the catalogue. Example made generic; names come from the tool.

## 20. The desk rehearsal, and what it changed before the next call — 2026-09-05

`tests/manual/voice-call-simulation.test.ts` drives the live Vapi assistant's own prompt,
model and function schemas turn by turn through OpenRouter exactly as Vapi does, executing
every read tool against production and letting `book_appointment` through only until the
engine's two-phase gate answers; the confirmed call is intercepted. Script-independent gates:
booking only after "anything else?" was asked and answered, never in the read-back turn, only
at a slot the tool listed, never before the name is settled.

Found in the first rehearsals (all on gpt-5.1) and fixed:

| Seen | Fix |
|---|---|
| Booked on the answer to the NAME question, twice; once chose 9:00 itself | **Engine two-phase gate**: the first `book_appointment` never writes and returns the read-back; only `confirmed: true` books (`081b3c2c`). Holds on both channels and with any model |
| Offered "one", booked 13:20 | Prompt: exact listed slot |
| "the 8th" resolved to October | Voice prompt had no date; the push now appends a per-call `Today is …` via Vapi's Liquid date filter in the tenant's timezone |
| Invented `unknown@example.com` | Schema descriptions (never invent), prompt rule |
| Empty reply after an unneeded `business_info` call | Prompt: after availability, the next words are the times, no other tool, never an empty reply |
| Fetched the catalogue before the first words (4s of pickup silence) | Prompt: only the lookup before speaking |
| Stacked price + staff question; "you're all set" before booking; repeated a sentence; asked a known customer's last name | Prompt: one thing per turn, the last three turns spelled out, confirm the known name |
| Availability cold despite the quote prefetch | `staffId: 0` was in the cache key and the prefetch's key had none — a guaranteed miss (`324eaebd`). After: 252ms on the prefetched day |

Final rehearsals, known and unknown caller: every gate passes; model steps 0.8–1.7s; the
only residue is eagerness — the model sometimes checks availability for today/tomorrow before
the caller names a day (an extra 4–9s once per call). That is prompt-resistant on gpt-5.1
and harmless to correctness.

**Not exercised by the rehearsal, by construction:** audio, transcription, TTS and
endpointing. Those only a real call proves.

## 21. Consent is verified by the server, not trusted from the model — 2026-09-05, both channels

Item 20's two-phase gate trusted `confirmed: true`. The rehearsal matrix
(`tests/manual/voice-call-matrix.test.ts`, 13 scripted callers) showed the model
setting it before the read-back, moving a booking on the first mention, and choosing a
time nobody had said. Codex proposed the mechanism; this item integrates it.

**How a calendar write happens on a phone call now**

1. The model calls `book_appointment` (or `reschedule_appointment` / `cancel_appointment`)
   without `confirmed`. Nothing is written. The engine answers with the read-back to
   speak, the exact question to ask ("Anything else you'd like to add to that?") and a
   `confirmationToken` (`turn.time.mac`, ~40 chars; org, call id and a hash of the
   arguments live inside the MAC).
2. The model reads back and asks. It stops.
3. Only a later call with the same arguments, `confirmed: true`, the token, and a Vapi
   conversation artifact in which the customer answered that question with no / that's
   all (or "shall I book it?" with yes) writes. Same turn, changed arguments, another
   call, a token older than ten minutes, "yes" to "anything else?" (an addition), or a
   missing artifact: refused, with a fresh read-back. `src/lib/vapi/booking-confirmation.ts`,
   unit-tested in `tests/voice-booking-confirmation.test.ts`.
4. A time nobody said out loud — not offered by the assistant, not spoken by the caller,
   in digits or words ("nine forty-five", "quarter to ten", "one" for 13:00) — cannot even
   be prepared. The model is told to offer the listed times and let the caller pick.

Enabled per workflow by `require_voice_confirmation: true` on the action node
(`src/lib/action-engine/execute-action.ts`); set on the three Cuts & Culture write
workflows, whose input schemas gained `confirmed` and `confirmationToken`. The widget is
unaffected: no artifact, no gate beyond `confirmed`.

**What the matrix found on the way (all fixed, all now in the harness as gates or lints)**

| Seen | Fix |
|---|---|
| Consent token (~230 chars of base64 JSON) pushed the booking call past Vapi's 250-token output cap; the JSON was cut mid-argument, the model retried with `{}` and told the caller "you're booked" | Token shrunk to `turn.time.mac`; push sets a 600-token floor on `model.maxTokens`; prompt: the booking tool confirms only with "Appointment request received" / "Booking confirmed" |
| Prepared 09:00 straight after availability, before offering a time | "Time was spoken" guard (above) |
| Moved #471 by guessing service id 1: the customer lookup listed bookings without their services | `lookup_customer` reads each upcoming booking's detail: services with ids, staff with id |
| Availability failure ("Service unavailable") narrated as "booked up" | Prompt: a failure is never "booked", "full" or "closed"; say the calendar can't be checked right now, offer a message |
| Checked today, tomorrow and Monday on its own before asking the day; said "fully booked today" at 23:00 | Tool description: only for a date the caller named; `check_availability` says "no openings left today" for the current day |
| Rehearsal reused one tool-call id, so production's per-call dedupe rejected the second prepare as a conflict | Harness: unique ids; it also sends the artifact and runs the same consent check locally, so no rehearsal can write |

Scoreboard (13 scenarios, gpt-5.1, live prompt and schemas, read tools against production):
v25 8 pass · v27 (against the previous production) 3 · v31 10 · v32 12 · **v33 13 of 13**
(`b88e6aff` in production, prompt v33 on the assistant). In the last run the server refused
two writes the model attempted without the read-back (prepare + confirm in one turn; a
confirm after "give me a moment" instead of the question) and the model recovered on the
next turn each time - which is the point: the conversation can wobble, the calendar cannot.
Residue: an occasional "Sure"/"Got it" opener and a 47-51 word turn, lint-only.

**For the next real call** the things only a phone proves: the pause before the first
words, whether "nine forty-five" transcribes as a time the guard recognises, and whether
Vapi's artifact carries every turn (the gate fails closed without it: the model is told
to explain nothing was booked and offer a message).

Not exercised by construction: audio, transcription, TTS, endpointing. A real call proves
those; everything above holds regardless of what the model does.

## 22. Call 4 plan executed: identity from the line, greeting before pickup, one clock grammar — 2026-09-06

Everything in VOICE-CALL-4-PLAN.md except the Xkedule-side latency work (provider,
measured 7.5s cold with no provider-side warm; staffId cuts ~3s) shipped today, in
production (`62e8a203`) and on the assistant (prompt v41, voice flash, first message
spoken by Vapi, post-call analysis plan), with the demo number routed through the new
assistant-request endpoint.

**Guardrails that are server code, not prompt**
- The identity on a phone call is the number Vapi verified. `lookup_customer` ignores any
  phone the model passes ("look up my wife's number" reads nothing); cancel and reschedule
  load the booking and refuse unless its contact phone is the caller's, before consent is
  even asked; a call without a number cannot touch an existing booking; the lookup never
  puts the email in front of the model. Unit-tested (`tests/voice-caller-binding.test.ts`).
- Consent: token bound to operation, org, call, arguments and turn; the read-back is
  verified by facts (time through the clock grammar, weekday or date, every service, first
  name, price) in the model's own words; consent is a later no / that's all; a "yes" is an
  addition and needs a new read-back. A time nobody said - resolved against the slots the
  availability tool listed in the same call, "09:45", "nine forty-five", "quarter to ten",
  "the second one" all count; "on the 8th" is a date, not eight o'clock - cannot even be
  prepared. Replay of the real call 4 artifact passes (`tests/voice-call-replay.test.ts`).
- Post-call: Vapi grades every call (off topic, other person revealed, caller PII spoken,
  invented fact, outcome, frustration) into `calls.structured_data`.

**Pickup**: `/api/vapi/assistant-request` answers Vapi while the phone rings (4.1s known
caller cold, 2.3s unknown, 0.2s no number; budget 7.5s, fallback to the operator's line)
with "Hi Vanildo! Thanks for calling Cuts and Culture Barbershop. Which service would you
like to book?" and the caller's facts as prompt variables - no lookup tool on the line.

**Rehearsal**: 20 scenarios (13 callers + 7 adversarial: foreign lookup, foreign cancel,
other customers, off-topic x3, injection, prompt/robot, Portuguese), leak and leading-zero
lints, tool results carried in the artifact like production, the assistant-request greeting
seeded from the real lookup; `npm run call:last` prints any call's timeline, Vapi
latencies, tool timings, refusals and lint, and saves the artifact as a fixture.

**What the rehearsals found after the plan landed (all fixed the same day)**: the Liquid
`{{caller_facts | default}}` was invisible to the model in the harness (rendered now); the
model asked a known caller for a phone number (prompt: never); "you're booked" after three
refusals (instruction opens "nothing has been booked", read-back starts "So that's"); a day
of the month parsed as an hour; "all set" on a pending request (exact wording now:
"Your request is in for … the shop will confirm it shortly"); the CI latency gate still
expected 24-hour slots.

Scoreboard (20 scenarios, gpt-5.1, live prompt v41, reads against production `62e8a203`):
v35 5 pass · v37 6 · v39 13 · v41 14 · 19 of 20 · **20 of 20** once "monday, same time if
you can" on a move resolved to the existing appointment's time (the grammar had no notion
of "same time"; it holds until the caller names a clock time). Residue is lint only: an
occasional "Got it"/"No problem" opener and 46-53-word turns. Slowest model turn per
scenario averaged 7.9s (max 9.9s), almost all of it the provider's cold availability read.

What only a real call proves now: the assistant-request greeting timing on the phone, the
flash voice, Deepgram's "09:45" becoming a recognised choice on the line, and the SMS.
