---
phase: 138-booking-modality
status: verified
verified: 2026-09-04
workstream: omnichannel-agent-orchestration
---

# Phase 138 Verification — Booking Modality

## Goal restated

The booking engine serves a business the customer visits and a business that visits the
customer, without a fork. The address is collected at the right moment when — and only
when — the business needs it, and the engine decides that, not the prompt author.

## Commits

| Plan | Commit | Scope |
|------|--------|-------|
| docs | `b1bdf1d4`, `221d175c` | Plans, then 138-00 added after the operator asked whether a business type already existed |
| 138-00 | `0b835926` | `organizations.business_type` (migration 1296) + Company Info form |
| 138-01 | `faa86637` | `organizations.service_location_mode` (migration 1297) + three pure modules |
| 138-02 | `a94ded67` | Wired into `buildWorkflowTools()` and both `run-agent.ts` paths |

## Verification focus

Checked against source, not against the executing agent's report.

| # | Focus | Result | Evidence |
|---|-------|--------|----------|
| 1 | `customerAddress` is genuinely required at the tool boundary for `at_customer` | PASS (after a fix, see below) | `applyServiceLocationMode` sets `required: safeMode === 'at_customer'` on the field before `deriveWorkflowInputSchema` runs, so the requirement lands in the ai-sdk tool schema. The model is structurally unable to call `book_appointment` without one — it is not a runtime check that could be bypassed. |
| 2 | An `on_premises` organization never sees the field | PASS | For `on_premises` the transform deletes the field outright, so it is absent from the schema the model is shown rather than present-and-optional. |
| 3 | An unrecognised mode never fails open into asking | PASS | `const safeMode = isServiceLocationMode(mode) ? mode : 'on_premises'`. A typo, a null, or a value from a future migration all resolve to the mode that does not ask. |
| 4 | Merging changes no existing organization's behaviour | PASS | Verified in production after applying 1296 and 1297: all **350** organizations sit on `business_type='on_premises_shop'` and `service_location_mode='on_premises'`. No backfill ran; the defaults did the work. |
| 5 | Business type is settable by an operator, not only by SQL | PASS | `Settings → Company Info`, through the existing company-profile server action and form. No new settings surface was invented. |
| 6 | Selecting a business type does not clobber a deliberate override | PASS | The seed applies only when the organization has not diverged from what its previous business type implied. |
| 7 | Only the `book_appointment` row is transformed | PASS | The mode is resolved at most once per build and only when a `book_appointment` row is present; every other workflow definition passes through untouched, and an agent that never touches booking makes zero resolver calls. |
| 8 | No prompt hardcodes ask / never-ask | PASS | Closed 2026-09-04, after this document was first written — see below. The live Vapi assistant now carries the engine-rendered block (“Service location: this business does not travel to the customer…”) in place of the hand-written rule, verified by reading the assistant back after the push. |

## The one carried gap — now closed

`canary/vapi-receptionist-prompt.md` still contains, as static text:

> Cuts & Culture serves customers on site at 212 Newbury Street. Do not ask for the
> caller's address, ever.

That is exactly the hardcoding this phase exists to remove. It survives because the voice
prompt does not live in this repository's runtime — it lives inside the Vapi assistant, and
until today nothing could write to Vapi at all.

`buildWorkflowTools()` now returns a `modalityBlock` and both `run-agent.ts` paths thread it
into the system prompt, so **the widget path is genuinely engine-driven**. Voice is not, and
cannot be until someone renders and pushes a config — which is precisely what Phase 139-04
built (`pushAssistantConfig`) and 139-07 surfaced as a deliberate two-click operator action.

**Closed on 2026-09-04.** Closing it exposed that the mechanism as built would have made voice
worse, not better: `pushAssistantConfig()` resolved the *widget orchestrator's* prompt (“you do
not call booking tools”) as the voice prompt, passed it through with no modality block, and
flattened every tuned per-tool line to “One moment.” Three changes, then the push:

- the renderer places `renderServiceLocationBlock(service_location_mode)` at a
  `{{service_location_block}}` token (or appends it — a prompt can never come out with no rule)
  and preserves the assistant's existing tool messages verbatim;
- the pusher renders tenant facts at push time, since 139-06 turns live prompts back into
  templates, and gained a `dryRun` so the payload is inspected before it reaches a live line;
- a voice entry agent (`cc-voice-receptionist`, `scripts/provision-voice-entry-agent.ts`) owns
  the voice prompt as a template, with read tools direct and writes only through an edge to the
  Booking specialist, and `agent_channel_defaults.voice` points at it.

The canary prompt file is now a template with the token; the hardcoded sentence no longer
exists in the repository or in Vapi.

## Two gaps found on re-analysis, 2026-09-05

**The field the rule acts on did not exist.** The live `book_appointment` workflow's trigger
`input_schema` had no `customerAddress`, and `applyServiceLocationMode()` returns a map
unchanged when the key is absent. So for this tenant the rule was vacuous — nothing to require
for `at_customer`, nothing to hide for `on_premises` — and every organization installed from its
template would have inherited the gap: a prompt that asks for an address and a function with no
field to carry it. Fixed as workflow version 2 (append-only, `current_version_id` repointed);
`create-booking.ts` already forwards the field as `address`. Verified: a push dry run now renders
`book_appointment` for this `on_premises` org **without** the field, which is the transform doing
its job on a field that finally exists.

**The Vapi push did not apply the rule to schemas.** `buildWorkflowTools()` transformed the
widget's tool schema; `pushAssistantConfig()` pushed the raw `input_schema`. The prompt and the
schema were rendered from different sources. Now both go through `applyServiceLocationMode()`
with the org's mode.

The same pattern as the four before it: a mechanism correct in itself, never reached by the
data or the path that needed it. Found by asking what the live definition actually contained
rather than what the plan said it would.

## Requirement verdicts

- **MODAL-00** — Done. `business_type` on the organization, set in Company Info, seeding the modality.
- **MODAL-01** — Done. `service_location_mode` with a safe default and a fail-closed resolver.
- **MODAL-02** — Done on both channels; the address requirement is structural, and the field it acts on now exists in the tenant's definition.
- **MODAL-03** — Done. One source, two channels: the widget renders the block at build time, voice at push time, both from `service_location_mode`.

## Production boundary

Migrations 1296 and 1297 were **applied** on 2026-09-04 on the operator's instruction to
finish everything, and verified afterwards across all 350 organizations. On the same day, on the operator's
instruction, the live Vapi assistant was PATCHed with the rendered config. Voice routing was
not flipped (still `legacy`), and no tenant's booking behaviour changed.
