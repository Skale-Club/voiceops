---
phase: 139-agent-mesh-as-a-template
plan: 05
status: complete
completed: 2026-09-04
requirements: [TMPL-01]
---

# Plan 139-05 Summary

## Outcome

`installAgents()` implements the install half of the `agents` asset group: given a
captured snapshot, it creates agents, prompt versions, direct tool grants, partner edges,
delegated workflow grants, and channel defaults in a fresh target org — idempotently, and
without ever activating specialist routing. This directly targets 139-CONTEXT.md's named
historic bug: the first hand-run provisioning of the Cuts & Culture mesh created six agents
and no `agent_prompt_versions` rows, and `resolveAgent()` refuses to load an agent with no
active prompt version.

## Changes

- `src/lib/org-templates/install.ts` — `installAgents(admin, orgId, snapshot, createdBy, counts)`,
  wired into `installSnapshotIntoOrg()` behind `want.has('agents') && snapshot.agents?.length`:
  1. For every `SnapshotAgent`, renders its `system_prompt` via `renderPromptTemplate()`
     (139-02) against `resolveTenantFacts(admin, orgId)`, then upserts the `agents` row on
     `(organization_id, slug)`.
  2. **Every agent upsert is immediately followed, in the same pass, by a prompt-version
     insert and an `active_prompt_version_id` update** — unless an equivalent
     (content-identical) active version already exists, in which case nothing further is
     written (this is what makes the install idempotent on re-run). Confirmed at
     verification time by direct read: there is no code path in this function that creates
     or upserts an `agents` row without also attempting to point it at a real prompt
     version; the only way an agent could end up without one is a mid-write Supabase error
     on the version insert itself (a genuine DB failure, not a design omission), and that
     path is logged with `console.warn`, not silently swallowed.
  3. Direct tool grants (`agent_tools`) resolved by workflow `tool_name` in the target org;
     a `tool_name` with no matching target-org workflow is skipped with a warning, not
     fatal.
  4. Partner edges (`agent_partners`) upserted by resolved agent-slug pair; delegated
     workflow grants (`agent_partner_workflow_grants`) resolved the same way as direct
     grants.
  5. Channel defaults (`agent_channel_defaults`) — **insert only if absent, never upsert**:
     an existing row for that `(organization_id, channel)` is left untouched, so install
     can never repoint an operator's existing choice.
  6. `agent_channel_routing_modes` is never referenced anywhere in this file — confirmed at
     verification time by grep; its absence for a freshly installed org resolves to
     `'legacy'` via `routing-mode.ts`'s own fail-closed default.
  `buildChecklist()` extended: when the `agents` group installed at least one agent, the
  checklist gains an item telling the operator to review the imported agents' prompts and
  connect the integrations they call before enabling any channel.
- `tests/org-templates-agents-install.test.ts`: tests against an in-memory fake Supabase
  client, including — every installed agent has a non-null `active_prompt_version_id`
  (both spot-checked and asserted as an invariant across the full fixture); re-running
  install a second time creates zero new rows of any kind; installs exactly 6 agents, 7
  partner edges, and 10 delegated workflow grants with exactly 3 writes, all on the
  Booking specialist — the known-good Cuts & Culture mesh shape; zero calls to
  `agent_channel_routing_modes`; never overwrites an existing `agent_channel_defaults` row;
  creates one when none exists, pointing at the installed orchestrator; a `direct_tools`
  entry with no matching target-org workflow is skipped, not fatal.

## Verification

- `npx vitest run tests/org-templates-agents-install.test.ts` — passed, independently
  re-run at verification time as part of a combined 51-test run across the phase's
  `org-templates`/Vapi/channel-routing test files.
- Independently confirmed at verification time by direct read of `install.ts`: no path
  writes to `agent_channel_routing_modes`; `agent_channel_defaults` writes are gated by a
  prior `.select().maybeSingle()` existence check before every insert.

## Files Modified

- `src/lib/org-templates/install.ts`
- `tests/org-templates-agents-install.test.ts`

## Commit

`5d2b8951` — `feat(139-05): install an agent mesh into another organization`

## What this plan does not do

Installed agent prompts render only `{{business_name}}`/`{{business_location}}` tokens
(139-02). They carry no modality-specific instruction (Phase 138's
`renderServiceLocationBlock()`) — the captured system prompts are whatever text the source
org's agent had, templatized or not, and this plan does not inject a service-location block
into that text at install time. For the widget/text runtime this is by design (Phase 138
renders the modality block live, per-call, in `runAgent()` — it was never meant to be baked
into the stored prompt). For voice, since no mechanism anywhere renders the modality block
into what gets PATCHed to Vapi either (see 139-04-SUMMARY.md), an installed org's voice
assistant carries no modality-aware instruction regardless of its
`service_location_mode`. See 139-VERIFICATION.md.

## Self-Check: PASSED, with the above gap noted (reconstructed independently from commit
`5d2b8951` and the live source tree; this SUMMARY was not written by the executing agent
and is being added retroactively during verification)
