# Canary Activation Runbook — Cuts & Culture (ROLL-03)

**Every step in this document requires a human with production access. No
agent — Claude Code or otherwise — has performed any of them.** This file
was written by an autonomous run of Phase 136 Plan 03, but writing the
runbook is the entirety of what that run did: it did not apply a migration,
did not run the provisioning script against a real organization, did not
bind a Vapi assistant, did not flip a routing row, and did not place a
booking. Everything below is a plan for a person to execute, not a record of
something already done.

Read this top to bottom before starting Step 1. Each step lists a
precondition, the exact command or action, the observable signal that tells
you it worked, and the abort step — how to undo *that step* if the signal is
wrong. Do not skip ahead: several steps are load-bearing preconditions for
the ones after them.

## The fact that makes Step 5 mandatory, not optional

Phases 131-134 built a routing switch (`agent_channel_routing_modes` +
`resolveChannelRoutingMode()`) and a trusted gateway
(`invokeAgentWithChannelRouting()` in
`src/lib/agent-runtime/invocation-gateway.ts`) that consults it. **Neither is
on any production request path today.** Verified by grep, not by reading a
comment:

- `src/app/api/chat/[token]/route.ts` (the live web widget) calls `runAgent()`
  directly.
- `src/app/api/vapi/tools/route.ts` (the live voice tool-call webhook) calls
  `executeAction()` directly.
- `invokeAgent` and `invokeAgentWithChannelRouting` have **zero** callers
  anywhere under `src/app`.

This means the milestone splits in two:

- **Already live, today, with no further action:** everything Phases
  132-134 put inside `runAgent()` and the Vapi tools route —
  edge authorization (`agent_partners` / `agent_partner_workflow_grants`),
  `kb_scope` enforcement, `partner_calls`, denial recording, redaction
  before persistence, and the idempotency guard on Xkedule booking
  mutations. The widget goes through `runAgent()`, so it inherits all of
  this now, before any canary step runs.
- **Not live until a human wires it in:** the Phase 131 gateway, the Phase
  132 trusted specialist routing, and the Phase 134 channel-routing switch.
  Flipping a row in `agent_channel_routing_modes` (Step 5) changes **nothing
  observable** until an ingress route actually calls
  `invokeAgentWithChannelRouting()` instead of `runAgent()` /
  `executeAction()` directly — and that code change has not been made. It
  is **Step 5.0** below, and it is itself part of this cutover, not a
  prerequisite completed by an earlier phase. Do not treat it as done
  because the gateway function exists; the function existing and the
  function being called are different facts, and only the second one
  matters here.

## Steps

### Step 1 — Apply migrations 1290-1294

**Precondition:** `npx supabase migration list --linked` shows 1290-1294 as
present locally and NOT applied remotely. No other pending local migration
exists that you have not separately reviewed.

**Action:**

```bash
npx supabase db push
```

This applies, in order: 1290 (voice channel + `assistant_mappings.entry_agent_id`),
1291 (authorized partner edges + delegated workflow grants), 1292 (workflow
run ↔ agent invocation trace linkage), 1293 (`agent_channel_routing_modes`,
defaulting every org/channel to `legacy`), 1294 (`workflow_tool_logs` view
stops discarding `trace_id`/`agent_invocation_id`). All five are additive and
idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE VIEW`); none backfills data
or changes existing behavior.

**Observable success signal:** `npx supabase migration list --linked` now
shows 1290-1294 with a matching Local and Remote version. `SELECT * FROM
public.agent_channel_routing_modes;` returns zero rows (no organization was
backfilled — absence of a row means legacy, by design).

**Abort step:** These five migrations only add columns, tables, and a view
replacement — nothing drops or rewrites existing data. If `db push` fails
partway, do not hand-edit the remote schema; re-run `npx supabase db push`
after fixing whatever it reported (all five files are safe to re-run). If a
migration applied but you decide not to proceed with the canary at all, you
can leave 1290-1294 applied indefinitely — an empty
`agent_channel_routing_modes` table and an unused `entry_agent_id` column
have no runtime effect on any organization, because nothing reads them
until Step 5.0 wires the gateway in and Step 5 flips a row.

**Independent of the canary — apply regardless:** migration 1295
(`1295_fix_member_profiles_cross_org_leak.sql`) closes a real
cross-organization leak in `get_org_member_profiles` — any authenticated
user could currently read any other organization's member list, including
emails and phone numbers. It has no relationship to the canary graph and
should be applied whether or not the rest of this runbook is ever executed.
`npx supabase db push` above applies it in the same batch as 1290-1294
since it is next in sequence; if you apply migrations in smaller batches for
any reason, do not leave 1295 for last. After it lands, add
`tests/security-secdef-isolation.test.ts` back into `GATE_MEMBERS` in
`scripts/release-gate.ts` (see `docs/agents/release-gate.md`) — that test is
what turns green as a result of this migration, and the release gate's
exclusion of it is documented there as conditional on 1295 being applied.

### Step 2 — Provisioning script, dry run

**Precondition:** Step 1 is complete (`agent_channel_routing_modes` exists;
`agents`/`agent_partners` carry the same-organization composite FKs from
1290/1291). You know the Cuts & Culture organization's UUID in the target
Supabase project. `NEXT_PUBLIC_SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are set in your shell for that project.

**Action:**

```bash
tsx scripts/provision-canary-graph.ts --org=<cuts-and-culture-org-uuid>
```

Passing `--org` alone (no `--apply`) performs a *validated* dry run: it
reads the organization row, refuses to proceed if its `slug` isn't
`cuts-and-culture`, and prints the full plan (6 agents, 8 workflows, 5
partner edges, and every workflow grant) without writing anything. Running
the script with no arguments at all prints a structural preview straight
from the JSON with zero network calls — useful as an even earlier sanity
check before you have credentials loaded.

**Observable success signal:** Console output ends with `--dry-run:
organization verified, no writes performed. Would provision:` followed by
one line per agent (`upsert cuts-and-culture-<slug>`), one per workflow
(`resolve xkedule_<tool_name>`), and one per edge (`upsert entry ->
<partner>`) with its nested `grant` lines. Read every line — this is your
last chance to catch a wrong org id or a graph mismatch before anything is
written.

**Abort step:** Nothing was written; there is nothing to reverse. If the
script instead throws (`Organization <uuid> does not exist` or `has slug
"...", not "cuts-and-culture"`), you passed the wrong org id — stop and
re-confirm it before continuing to Step 3. Do not proceed to `--apply` on a
dry run you have not personally read.

### Step 3 — Provisioning script, apply

**Precondition:** Step 2's dry-run output was reviewed and matched
expectations (6 agents, 8 workflows, 5 edges, and only the `entry_to_booking`
edge granting `create_booking` / `cancel_booking` / `reschedule_booking`).

**Action:**

```bash
tsx scripts/provision-canary-graph.ts --org=<cuts-and-culture-org-uuid> --apply
```

Both `--org` and `--apply` are required together — the script has no
environment-variable org id and no "current org" fallback, so this is the
only way it will ever write. It re-validates the organization's slug before
writing (same check as Step 2), then upserts agents (on
`organization_id, slug`), resolves-or-inserts workflows (on `org_id,
tool_name`), upserts partner edges (on `agent_id, partner_agent_id`), and
upserts delegated workflow grants (on `partner_edge_id, workflow_id`).
Re-running this exact command is safe and changes nothing on a second run.

**Observable success signal:** Console output ends with `Provisioned: 6
agent(s), 8 workflow(s), 5 edge(s).` In the dashboard, **Agents** for the
Cuts & Culture organization now lists `Cuts & Culture Entry Orchestrator`
plus the five specialists. In `agent_partner_workflow_grants`, only the edge
whose `partner_agent_id` is the Booking specialist's agent id has grant rows
against a `write`-access workflow — confirm this either in the dashboard's
partner-edge view or with a read-only query joining
`agent_partner_workflow_grants` → `workflows` → filter `access = 'write'`;
every row should resolve back to the Booking edge. This is the same
assertion `tests/canary-graph-shape.test.ts` makes against a mocked client —
here you are confirming it against the real provisioned rows.

**Abort step:** There is no delete/rollback command for this script by
design (it only upserts). To reverse: deactivate or delete the six
`cuts-and-culture-*` agent rows, their partner edges, and the eight
`xkedule_*` workflow rows for this organization via the dashboard or a
direct, reviewed SQL statement scoped with `WHERE organization_id =
'<uuid>'`. Because nothing yet reads these rows outside of manual inspection
and Step 5.0's future ingress change, leaving them provisioned-but-unused is
also a safe abort — no channel resolves to them until Step 5.0 ships and
Step 5 flips a row.

### Step 4 — Bind the Vapi assistant to the entry orchestrator

**Precondition:** Step 3 is complete. You have (or will create) a Vapi
assistant for the Cuts & Culture phone number, and its
`assistant_mappings` row exists for this organization.

**Action:** In the dashboard, set `assistant_mappings.entry_agent_id` for
the Cuts & Culture assistant to the id of the `cuts-and-culture-entry` agent
provisioned in Step 3 (the same column migration 1290 added). If no UI
control exists yet for this field, set it via a direct, reviewed update
scoped to `WHERE organization_id = '<uuid>' AND vapi_assistant_id =
'<assistant-id>'` — never an unscoped update.

**Observable success signal:** `SELECT entry_agent_id FROM
assistant_mappings WHERE organization_id = '<uuid>'` returns the entry
agent's id. This column is read by `resolveOrgForCall()`'s callers today
only for informational/future use — setting it does **not** by itself
change what a live call does, because (per the fact at the top of this
document) `/api/vapi/tools` does not consult `entry_agent_id` and does not
call the gateway. Binding it here is a precondition for Step 5.0, not an
observable behavior change on its own.

**Abort step:** Set `entry_agent_id` back to `NULL` on the same row. This
column existing or being populated has no effect on any call path by
itself, so this is fully reversible with a single update and no
side effects on `agents`, `agent_partners`, or call history.

### Step 5.0 — Wire an ingress route to the gateway (the change this runbook cannot skip)

**Precondition:** Steps 1-4 are complete. You have reviewed
`invokeAgentWithChannelRouting()` in
`src/lib/agent-runtime/invocation-gateway.ts` and understand its contract:
resolve the routing mode once per invocation, dispatch to
`resolveTrustedAgentRoute()` + `invokeAgent()` when `specialist`, or fall
through to `invokeAgent()` (today's `runAgent()` path) unchanged when
`legacy` or on any uncertainty.

**Action:** This is a code change, reviewed and deployed like any other —
not a data flip. Choose the channel adapter you are cutting over first
(voice via `/api/vapi/tools`, or the widget via
`/api/chat/[token]/route.ts`) and change its call site from `runAgent()` /
`executeAction()` to `invokeAgentWithChannelRouting()`, passing that
channel's trusted `orgId`, `channel`, and `entryAgentId` (from
`assistant_mappings.entry_agent_id` for voice) as the envelope's route.
Ship this through the normal PR → CI (release gate) → merge → deploy
pipeline described in `CLAUDE.md`'s Deployment section — it is production
code, not a runbook step you execute by hand against the live database.

**Observable success signal:** The deploy completes and
`/api/health` reports healthy. With **every** organization still at the
`legacy` default (no row yet in `agent_channel_routing_modes` for Cuts &
Culture — Step 1 backfilled none), a live call or widget message behaves
identically to before this deploy, because `resolveChannelRoutingMode()`
returns `'legacy'` for an absent row and the gateway falls through to
`invokeAgent()` untouched. Confirm this with one ordinary call/message
before touching Step 5's routing row — this deploy should be invisible in
production until Step 5.

**Abort step:** Revert the PR and redeploy. Because every organization is
still `legacy` by default at this point, this step's own rollback is
low-risk — reverting removes the new call site and restores the direct
`runAgent()` / `executeAction()` call, which is exactly what every
organization was already experiencing throughout this step.

### Step 5 — Flip voice to specialist routing, observe, then the widget

**Precondition:** Step 5.0 is deployed and confirmed invisible (previous
step's signal). The Cuts & Culture organization's UUID and its `voice`
channel are what you intend to flip.

**Action:**

```sql
insert into agent_channel_routing_modes (organization_id, channel, mode)
values ('<cuts-and-culture-org-uuid>', 'voice', 'specialist')
on conflict (organization_id, channel) do update set mode = excluded.mode;
```

Run this as a reviewed, scoped statement (dashboard SQL console or a
one-off script) — not a blanket update. Observe voice behavior (see below)
before touching the `web_widget` row. Once satisfied, repeat for
`channel = 'web_widget'`.

**Observable success signal:** Work through the relevant **PHASE-136**
items in `docs/agents/uat-checklist.md` (UAT-07 through UAT-12) for the
channel you just flipped — that checklist defines the full observation
protocol; it is not restated here. In short: an explicit-intent request now
resolves directly to a specialist agent (confirmed in **Agents →
Invocations**, no orchestrator hop for that turn), an ambiguous request
still falls back to the entry orchestrator, and once both channels are
flipped, a voice and a widget request for the same intent (e.g.
availability) resolve to the **same** specialist agent id.

**Abort step:** Flip the row back:

```sql
update agent_channel_routing_modes
set mode = 'legacy'
where organization_id = '<cuts-and-culture-org-uuid>' and channel = 'voice';
```

**This rollback is non-destructive by construction.** The table records
only which code path an invocation reads next — it holds no reference to
any agent, partner edge, workflow, or invocation history, and nothing in
`routing-mode.ts` or the gateway ever writes to those tables. Reverting the
row removes zero agents, zero partner edges, zero workflows, and zero
invocation records; the next request after the revert takes the legacy path
exactly as it did before Step 5, and UAT-12 in the checklist is the drill
that exists specifically to prove this in practice rather than only in
code comments.

### Step 6 — Place one real booking and follow its trace end to end

**Precondition:** Both channels are flipped to `specialist` (or you are
testing the one channel you flipped) and Step 5's observation passed.

**Action:** Through a real voice call or a real widget conversation,
complete one booking request that reaches the Booking specialist and
creates a real Xkedule appointment (use a disposable test slot you can
delete afterward). Immediately repeat the same request (or replay the exact
captured webhook payload, for voice) to exercise the idempotency guard —
this mirrors UAT-05/UAT-06 in the checklist.

**Observable success signal:** Exactly one booking exists in Cuts &
Culture's Xkedule calendar for that slot. In **Agents → Invocations**, the
booking turn's trace shows: the entry orchestrator invocation, a delegated
call to the Booking specialist, and the `xkedule_create_booking` workflow
run — joined by `trace_id` / `agent_invocation_id` (migration 1292/1294),
not just co-located in time. The repeated request/replay returns the
original result without a second calendar entry.

**Abort step:** Cancel or delete the test booking directly in Xkedule (or
via the `cancel_booking` tool through the same agent, which is itself
idempotent — cancelling an already-terminal booking returns its current
state rather than erroring). This step does not touch the routing switch or
the graph; if the trace or the booking count looks wrong, flip both
channels back to `legacy` (Step 5's abort) before investigating further, so
production traffic is not left running through a path you don't yet trust.

## What is proven today versus what only the live run proves

**Proven by test, in this repository, right now — no production access
required:**

- The provisioned graph's shape: exactly one entry orchestrator plus
  Services, Pricing, Availability, Customer, and Booking
  (`tests/canary-graph-shape.test.ts`).
- Only the Booking specialist's edge holds an Xkedule write grant; the
  other four hold none — asserted against the grant rows the script would
  produce, and additionally fail-closed at
  `assertOnlyBookingHoldsWriteGrants()` before any write is attempted.
- Voice and widget are declared against the **same** Availability
  specialist row (one agent, `allowed_channels: ["voice", "web_widget"]`,
  one edge) — not two channel-specific copies.
- With no row present in `agent_channel_routing_modes`, every channel
  resolves to `legacy` (`tests/channel-routing-mode.test.ts`), and flipping
  one channel's row changes only that channel while leaving the other alone
  (`tests/channel-routing-wiring.test.ts`).
- The provisioning script is idempotent, defaults to a dry run with zero
  network calls when `--org` is omitted, and refuses to write to any
  organization whose slug doesn't match the graph's declared target.
- The idempotency guard on the Xkedule booking mutations
  (`d0a162bf`, exercised by `tests/vapi-tools-idempotency.test.ts` and
  `tests/idempotency-ingress-key.test.ts`).

**Unproven until the canary actually runs, live, in production:**

- That a real widget conversation and a real Vapi phone call reach the
  *same* specialist agent record in production — the test above proves the
  graph is *declared* that way, not that a live invocation resolves there.
- That the code change in Step 5.0 is actually deployed and actually
  intercepting the request that the routing row says it should.
- That a real booking, placed through a real call or a real widget message,
  completes exactly once in Xkedule with a trace that joins entry →
  specialist → workflow run end to end in the live `agent_invocations` /
  `workflow_runs` data — not a mocked client, a real row.

Completing every step in this runbook is necessary for the canary to be
live. It is not sufficient on its own to call ROLL-03 proven — that
requires actually executing Steps 4 through 6 against production and
observing the signals above, which is exactly what this document hands to
a human to do, not what it claims has already happened.
