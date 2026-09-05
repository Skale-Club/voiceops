---
phase: 138-booking-modality
status: verified_with_one_carried_gap
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
| 1 | `customerAddress` is genuinely required at the tool boundary for `at_customer` | PASS | `applyServiceLocationMode` sets `required: safeMode === 'at_customer'` on the field before `deriveWorkflowInputSchema` runs, so the requirement lands in the ai-sdk tool schema. The model is structurally unable to call `book_appointment` without one — it is not a runtime check that could be bypassed. |
| 2 | An `on_premises` organization never sees the field | PASS | For `on_premises` the transform deletes the field outright, so it is absent from the schema the model is shown rather than present-and-optional. |
| 3 | An unrecognised mode never fails open into asking | PASS | `const safeMode = isServiceLocationMode(mode) ? mode : 'on_premises'`. A typo, a null, or a value from a future migration all resolve to the mode that does not ask. |
| 4 | Merging changes no existing organization's behaviour | PASS | Verified in production after applying 1296 and 1297: all **350** organizations sit on `business_type='on_premises_shop'` and `service_location_mode='on_premises'`. No backfill ran; the defaults did the work. |
| 5 | Business type is settable by an operator, not only by SQL | PASS | `Settings → Company Info`, through the existing company-profile server action and form. No new settings surface was invented. |
| 6 | Selecting a business type does not clobber a deliberate override | PASS | The seed applies only when the organization has not diverged from what its previous business type implied. |
| 7 | Only the `book_appointment` row is transformed | PASS | The mode is resolved at most once per build and only when a `book_appointment` row is present; every other workflow definition passes through untouched, and an agent that never touches booking makes zero resolver calls. |
| 8 | No prompt hardcodes ask / never-ask | **PARTIAL** | See below. |

## The one carried gap

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

So the gap is real, understood, and has a mechanism waiting for it. It is recorded here
rather than quietly counted as done.

## Requirement verdicts

- **MODAL-00** — Done. `business_type` on the organization, set in Company Info, seeding the modality.
- **MODAL-01** — Done. `service_location_mode` with a safe default and a fail-closed resolver.
- **MODAL-02** — Done for the widget path; the address requirement is structural.
- **MODAL-03** — Partial. The engine renders the block; the voice prompt still carries static text.

## Production boundary

Migrations 1296 and 1297 were **applied** on 2026-09-04 on the operator's instruction to
finish everything, and verified afterwards across all 350 organizations. Nothing else in
this phase touches production: no assistant was pushed, no routing flipped, no tenant's
booking behaviour changed.
