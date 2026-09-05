---
phase: 139-agent-mesh-as-a-template
plan: 04
status: complete
completed: 2026-09-04
requirements: [TMPL-03]
---

# Plan 139-04 Summary

## Outcome

The outbound half of Vapi assistant configuration now exists: given an org's entry
orchestrator and its granted workflows, the platform renders the exact
prompt/functions/tool-messages payload a Vapi assistant needs and PATCHes it — closing
139-CONTEXT.md's named largest gap (`sync-assistants.ts` was, and remains, inbound-only).
This plan explicitly did not implement Phase 138's modality integration (at plan-writing
time, 138 did not exist yet) — see "What this plan does not do" below for the status of
that gap after 138 shipped.

## Changes

- `9cce7d0a` — `src/lib/vapi/render-assistant-config.ts`: `renderAssistantConfig(source)`
  — pure, zero imports of `@supabase/*` or `fetch`, deterministic (same input twice →
  byte-identical output). Shapes each granted workflow's own `input_schema` into a Vapi
  function (`{name, description, parameters: {type:'object', properties, required}}`),
  with unknown/unrecognised field types falling back to `'string'` in the JSON Schema
  output. Emits a generic `requestStart: 'One moment.'` per tool (per-tool tuning is
  explicitly out of this renderer's scope, deferred to operator refinement). Does **not**
  template tenant facts or touch `systemPrompt` beyond pass-through — that already
  happened once, at install time, into `agent_prompt_versions` (139-02/139-05).
- `df2cfa81`:
  - `src/lib/vapi/client.ts`: `vapiFetchWrite()` — authenticated `PATCH` against
    `api.vapi.ai`, reusing `vapiFetch()`'s 8s hard timeout and `VapiApiError` contract.
  - `src/lib/vapi/sync-assistant-config.ts`: `pushAssistantConfig(supabase, organizationId, vapiAssistantId)`
    — resolves the org's entry orchestrator (voice's `agent_channel_defaults` row, falling
    back to `web_widget`'s), that agent's active-prompt-version `system_prompt`, and every
    workflow its mesh can reach (its own direct `agent_tools` grants UNION every workflow
    delegated across its outgoing `agent_partners` edges via
    `agent_partner_workflow_grants`) — then renders via `renderAssistantConfig()` and
    PATCHes `model.messages`/`model.tools` onto the live Vapi assistant, preserving every
    other `model` field returned by a preceding `GET`. Never throws past its own boundary,
    matching `syncVapiAssistants()`'s convention.
  - `tests/manual/vapi-push-assistant-config.test.ts`: excluded from the default Vitest
    glob (`tests/manual/**`), reads org/assistant ids from env vars and
    `it.skipIf(!ORG_ID || !VAPI_ASSISTANT_ID)` — confirmed at verification time this file
    still self-skips (no env vars set in this environment) and has never run against a
    real Vapi assistant.
  - `tests/vapi-render-assistant-config.test.ts`: 6 cases (function shape, required-field
    derivation from `input_schema`, unknown-type fallback, per-tool message shape,
    determinism, prompt pass-through).

## Verification

- `npx vitest run tests/vapi-render-assistant-config.test.ts` — 6/6 passed, independently
  re-run at verification time.
- Independently confirmed at verification time (by direct read, not by trusting the
  commit message): `pushAssistantConfig()` has exactly one caller in the entire codebase —
  `pushAssistantConfigAction()` in `src/app/(dashboard)/assistants/actions.ts` (139-07) —
  and that caller is only reachable from an explicit button click behind a confirmation
  dialog naming the live assistant (see 139-07-SUMMARY.md). Nothing calls it on render,
  mount, install, or as a side effect of any other action.

## Files Modified

- `src/lib/vapi/client.ts`
- `src/lib/vapi/render-assistant-config.ts`
- `src/lib/vapi/sync-assistant-config.ts`
- `tests/vapi-render-assistant-config.test.ts`
- `tests/manual/vapi-push-assistant-config.test.ts`

## Commits

- `9cce7d0a` — `feat(139-04): pure Vapi assistant-config renderer`
- `df2cfa81` — `feat(139-04): PATCH wrapper and org-scoped push entry point`

## What this plan does not do — a gap that outlived it

This plan's own 139-04-PLAN.md is explicit: "138 is not built yet; do not reference
`organizations.service_location_mode`, it does not exist." By the time 138 shipped
(commits `0b835926`/`faa86637`/`a94ded67`, all timestamped the same day as this plan's
commits), no later plan in this phase revisited `render-assistant-config.ts` or
`sync-assistant-config.ts` to add the integration. Confirmed at verification time: grepping
`src/lib/vapi/` for `service_location`/`modality`/`resolveServiceLocationMode`/
`applyServiceLocationMode` returns zero matches. `renderFunction()` in
`render-assistant-config.ts` builds `book_appointment`'s Vapi function parameters straight
from the workflow's raw, unmodified `input_schema` — the same static shape 138-01 wrote
into the canary fixture (`customerAddress`, `required: false`, unconditionally present) —
with no call to `applyServiceLocationMode()` anywhere in the push path. The consequence:
pushing an org's assistant config to Vapi produces the same `customerAddress` field,
`required: false`, regardless of whether that org is `on_premises`, `at_customer`, or
`either`. See 139-VERIFICATION.md for the full analysis; this is that report's central
finding.

## Self-Check: PASSED, with the above gap noted (reconstructed independently from commits
`9cce7d0a`/`df2cfa81` and the live source tree; this SUMMARY was not written by the
executing agent and is being added retroactively during verification)
