---
phase: 139-agent-mesh-as-a-template
status: ready_for_detailed_planning
created: 2026-09-04
workstream: omnichannel-agent-orchestration
---

# Phase 139 Context — The Specialist Mesh as a Product Template

## The criticism this phase answers

The Cuts & Culture mesh works, and it was assembled by hand. Standing it up for a second
tenant today would mean repeating every one of these by hand:

| Step taken for Cuts & Culture | How it was done | Reproducible? |
|---|---|---|
| Six agents, seven edges, grants | `scripts/provision-canary-graph.ts` from a JSON under `.planning/` | Script yes, but the JSON is a planning artifact, not product data |
| `agent_prompt_versions` for each agent | **Raw SQL by hand** — the script does not create them, and `resolveAgent()` refuses an agent without one | No. A fresh run elsewhere yields six unusable agents |
| `list_services` granted to three specialists | Raw SQL by hand | No |
| Six specialist prompts | Written by hand, tenant facts inline | No |
| Vapi assistant prompt (v3) | **Manual PATCH from a probe script** | No |
| Vapi tool `request-start` / delay / failure lines | **Manual PATCH from a probe script** | No |
| `agent_channel_defaults.web_widget` → orchestrator | Raw SQL | No |
| `agent_channel_routing_modes.voice` | Raw SQL | No — there is no UI at all |

That is a demo, not a capability.

## What the product already has — and it is the right primitive

`org_templates` + `org_template_installs` exist, with a UI at
`Settings → Organization Templates`, and `src/lib/org-templates/{snapshot,install,types}.ts`
implementing capture-from-one-org, install-into-another. Both modules follow a clean
per-asset-group pattern (`capturePipelines` / `installPipelines`, one pair per group).

Current groups: `pipelines`, `custom_fields`, `tags`, `message_templates`, `workflows`.

**It does not touch agents.** Verified: no reference to `agents`, `agent_partners`,
`agent_tools` or `agent_prompt_versions` anywhere under `src/lib/org-templates/`. The
entire orchestration layer is outside the one mechanism the product has for duplication.

So this phase is an extension of existing architecture, not new architecture.

## Goal

Standing up the mesh for a new tenant is an operator action in the product, not a
sequence of scripts and SQL run by an engineer.

## Design

### 1. An `agents` asset group

Add to `ASSET_GROUPS`, with `captureAgents` / `installAgents` following the existing
pair pattern. The snapshot must carry, by stable key rather than by id:

- agents: slug, name, role, model, temperature, max_tokens, allowed_channels, kb_scope
- the **active prompt**, and install must create `agent_prompt_versions` and set
  `active_prompt_version_id` — the failure that made the first provisioning produce six
  unusable agents
- direct tool grants (`agent_tools`), resolved by workflow `tool_name`
- partner edges with their channel/budget policy
- delegated workflow grants, resolved by `tool_name`
- channel defaults, so the target org's widget points at the orchestrator

Workflows are already an asset group; agents reference them by `tool_name`, which is how
the canary graph already binds and is what makes a cross-tenant install possible at all.

### 2. Prompts as templates, not prose

A prompt today hardcodes "Cuts & Culture Barbershop, 212 Newbury Street, Boston". Install
must render tenant facts — business name, address, hours, currency — from the target org
and its provider (`business_info` already returns exactly these). What stays fixed is the
*behaviour*: never invent a price, quote before booking, at most three times spoken
naturally, ask to repeat rather than agree. What varies is the business.

The modality decision from Phase 138 (`on_premises` / `at_customer` / `either`) is
rendered the same way — a template that asks for an address only when the tenant needs it.

### 3. Outbound Vapi sync — the largest gap

`src/lib/vapi/sync-assistants.ts` is **inbound only**: it mirrors Vapi assistants into
`assistant_mappings`. Nothing writes to Vapi. Every voice change made today — the v3
prompt, the eight `request-start` lines, the two delay lines, the three failure lines —
was a manual PATCH.

Needed: given a tenant's entry orchestrator and its granted workflows, render and PATCH
the assistant's prompt, function schemas and tool messages. That single piece is what
turns voice from hand-configured into provisioned, and it is also what would carry
Phase 138's `customerAddress` parameter into the Vapi schema.

### 4. Operator surfaces for what is currently SQL

`agent_channel_defaults` per channel and `agent_channel_routing_modes` (legacy /
specialist) both need a control in Settings. Phase 134 built the switch and proved
rollback is non-destructive; nobody can reach it without database access.

## Locked decisions

- Extend `org-templates`; do not build a parallel mechanism.
- Bind across tenants by stable keys (`slug`, `tool_name`), never by id.
- Install is idempotent and re-runnable, matching the existing groups' behaviour.
- Install never activates: routing stays `legacy` and channel defaults are only
  repointed when the operator asks.
- A template carries behaviour; a tenant supplies its facts.
- The canary JSON under `.planning/` becomes a fixture for tests, not the source of truth.

## Verification focus

- Capture Cuts & Culture, install into a scratch org, and get a working mesh with no SQL:
  six agents each with an active prompt version, seven edges, correct grants, and only
  Booking holding writes.
- The installed prompts name the target business, not Cuts & Culture.
- Re-running the install changes nothing.
- A tenant with `at_customer` modality produces prompts that collect an address; an
  `on_premises` one never asks.
- The Vapi assistant for the target org ends up with the rendered prompt, the eight
  function schemas and the tool messages, without a human PATCH.
- Installing does not enable specialist routing anywhere.

## Known debt this phase must clear

`scripts/provision-canary-graph.ts` not creating `agent_prompt_versions` is the specific
bug that made the mesh silently unusable on first provisioning. Whatever replaces or
wraps it must not be able to produce an agent without an active prompt version.
