---
phase: 139-agent-mesh-as-a-template
status: verified_except_the_live_walkthrough
verified: 2026-09-04
workstream: omnichannel-agent-orchestration
---

# Phase 139 Verification — The Specialist Mesh as a Product Template

## Goal restated

Standing up the mesh for a new tenant is an operator action in the product, not a sequence
of scripts and SQL run by an engineer.

## Commits

| Plan | Commit(s) | Scope |
|------|-----------|-------|
| 139-01 | `22086548`, `b7b6fb24` | `agents` asset group + `captureAgents()` |
| 139-02 | `3187234a` | Tenant-facts resolver and prompt-token renderer |
| 139-03 | `e90a895c`, `f6036319` | Operator surface for `agent_channel_routing_modes` |
| 139-04 | `9cce7d0a`, `df2cfa81` | Pure Vapi config renderer + the first outbound PATCH |
| 139-05 | `5d2b8951` | `installAgents()` |
| 139-06 | `1976143d` | Prompt tokenisation script |
| 139-07 | `4ddc83ff` | Templates page counts + assistant config push button |
| 139-08 | `524848fe` | End-to-end capture → install proof |

## Verification focus

Checked against source, not against the executing agents' reports.

| # | Focus | Result | Evidence |
|---|-------|--------|----------|
| 1 | `installAgents()` cannot produce an agent without an active prompt version | PASS | Every agent upsert is followed in the same path by a prompt-version insert and an `active_prompt_version_id` update, with no return or continue between them. This is the exact bug that left six agents inert when the mesh was first provisioned by hand — `provision-canary-graph.ts` upserts and stops. |
| 2 | Install never activates routing | PASS | `agent_channel_routing_modes` appears in `install.ts` only inside two comments explaining that it is deliberately never referenced. Asserted by test across capture plus two installs: zero calls to that table. |
| 3 | Install never repoints an existing channel default | PASS | Insert-only-if-absent; a pre-existing `web_widget` default keeps its `agent_id`. |
| 4 | Binding is by stable key, never by id | PASS | Agents by `slug`, tools and grants by `tool_name`. Ids differ per organization, which is what makes a cross-tenant install possible at all. |
| 5 | Install is idempotent | PASS | A second install produces byte-identical counts across seven tables. |
| 6 | Only Booking ends up with write grants | PASS | 10 delegated grants, exactly 3 of them writes, all resolving to the same Booking-shaped destination agent. |
| 7 | Installed prompts name the target tenant | PASS | The e2e test asserts the orchestrator's installed prompt contains the target's business name, does not contain the source's, and retains no `{{` token. The target fake deliberately also holds the source organization's row, so a lapse in filtering by organization id would surface here rather than pass silently. |
| 8 | The end-to-end proof crosses the capture seam | PASS | It runs the real `captureOrgSnapshot()` into the real `installSnapshotIntoOrg()`. No hand-authored snapshot fixture — 139-05's test builds one, which necessarily skips the seam most likely to break. |
| 9 | The Vapi push cannot fire without a deliberate action | PASS | The item exists only inside a kebab menu reached by a click, sets a target rather than calling anything, and the PATCH runs only from a second click inside an `AlertDialog` that names the assistant and warns it may be answering a real phone number. No `useEffect`, no render-time call. The server action re-resolves the mapping and verifies it belongs to the caller's organization. |
| 10 | The tokenisation script cannot silently drift a live prompt | PASS | `--apply` requires both an explicit organization id and a matching `--expect-slug`, and each prompt must render back through `renderPromptTemplate()` byte-identical to the original before it is eligible to be written. A prompt that fails the roundtrip is refused, not written. |

## What changed after the plans

`139-03` was scoped down during planning on a correction to this phase's own context: the
context claimed `agent_channel_defaults` was reachable only by raw SQL, and a
`ChannelDefaultsCard` already existed. Only the routing mode genuinely lacked a surface, so
only that was built rather than duplicating a card.

`139-07` added an `AlertDialog` beyond what its plan asked for. The plan wanted a button
matching the existing per-row action pattern; the executing agent judged that a single
click was too little between an operator and a PATCH against a live phone-answering
assistant. That judgement was right.

## What is not proven

**The live walkthrough.** `139-08`'s `checkpoint:human-verify` — an operator opening
`Settings → Organization Templates`, capturing Cuts & Culture and installing the mesh into a
real second organization — has not been done. Every guarantee above is proven against
in-memory fakes, which is the right place to prove them, and none of it substitutes for one
real install.

**The outbound Vapi sync has never run.** `pushAssistantConfig()` is unit-tested against a
mocked fetch and has never PATCHed a real assistant. Its request shape was not guessed: it
was read off this repository's own earlier probes, which did get 200 responses from the live
assistant. That is good evidence and it is not the same as having run.

Until both happen, this phase has built the capability to duplicate a tenant and has not
duplicated one.

## Requirement verdicts

- **TMPL-01** — Done. `agents` asset group, capture and install, bound by `slug` and `tool_name`.
- **TMPL-02** — Done. Prompts render tenant facts; the tokenisation script exists to convert the live ones.
- **TMPL-03** — Done in code, unexercised in production.
- **TMPL-04** — Done. Routing-mode card on the agents page.
- **TMPL-05** — Done. Idempotent, and it never activates routing.

## Production boundary

No migration was authored or applied by this phase. No Vapi API call was made against the
real account by any of the eight plans. The tokenisation script was never run against a real
organization. No tenant was templated.
