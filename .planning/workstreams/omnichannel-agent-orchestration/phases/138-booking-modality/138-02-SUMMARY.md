---
phase: 138-booking-modality
plan: 02
status: complete
completed: 2026-09-04
requirements: [MODAL-02, MODAL-03]
---

# Plan 138-02 Summary

## Outcome

The widget/text runtime (`buildWorkflowTools()` + `runAgent()`) now decides, per
organization, whether `book_appointment` can be called without a `customerAddress` — the
engine, not a prompt author, makes this decision, and the same rendered modality text
reaches both the blocking and the streaming system-prompt assembly paths. Voice/Vapi is
unchanged: nothing in this plan touches the canary Vapi prompt or any Vapi-facing schema,
per its own stated scope.

## Changes

- `src/lib/agent-runtime/build-workflow-tools.ts`: `BuildResult` gains
  `modalityBlock: string` (default `''`). While iterating `agent_tools` rows, when a row's
  `wf.tool_name === 'book_appointment'`, the org's mode is resolved once via
  `resolveServiceLocationMode(orgId)` and cached for the rest of the call — never called
  twice even if more than one row matched. Before `deriveWorkflowInputSchema()` runs for
  that row, its raw input-schema map is transformed via `applyServiceLocationMode()`; every
  other workflow's `definition` passes through untouched. `result.modalityBlock` is set to
  `renderServiceLocationBlock(mode)`. `buildWorkflowSystemPromptSuffix()`'s signature widens
  to `(summaries, modalityBlock = '')`, appending the block under its own
  `## Service Location` heading after `## Available Workflows` only when non-empty —
  byte-identical output for every agent whose tools don't include `book_appointment`.
- `src/lib/agent-runtime/run-agent.ts`: both the blocking call site (around
  `workflowToolsResult.summaries`) and the streaming call site (around
  `workflowToolsStream.summaries`) now pass their sibling `.modalityBlock` as the second
  argument to `buildWorkflowSystemPromptSuffix()` — confirmed by direct read of both call
  sites at verification time (`grep -n "buildWorkflowSystemPromptSuffix\|modalityBlock"`
  shows exactly two matches, both threading `.modalityBlock`).
- `tests/agent-workflow-tools.test.ts`: adds `vi.mock('@/lib/agent-runtime/resolve-service-location-mode', ...)`
  defaulted to `on_premises` so every pre-existing test in the file is unaffected; a new
  `describe('buildWorkflowTools: service location modality')` block (schema
  omit/require/optional per mode, zero-resolver-calls for non-`book_appointment` agents,
  exact `modalityBlock` text, at-most-once resolution) plus
  `buildWorkflowSystemPromptSuffix()` unit tests and a structural check on `run-agent.ts`'s
  source text for the two call sites.

## Verification

- `npx vitest run tests/agent-workflow-tools.test.ts` — 24/24 in this file passed,
  independently re-run at verification time (89/89 across all three 138 test files
  combined).
- Independently confirmed at verification time: `deriveWorkflowInputSchema()`
  (`src/lib/workflows/derive-input-schema.ts`) treats `required !== false` as NOT
  `.optional()` in the resulting Zod object — so `at_customer`'s `required: true` produces
  a genuinely required Zod field, meaning the ai-sdk's own schema validation rejects a
  `book_appointment` call missing `customerAddress` before `create-booking.ts` is ever
  reached. This was checked by reading `fieldToZod()` directly, not assumed.

## Files Modified

- `src/lib/agent-runtime/build-workflow-tools.ts`
- `src/lib/agent-runtime/run-agent.ts`
- `tests/agent-workflow-tools.test.ts`

## Commit

`a94ded67` — `feat(138-02): wire booking modality into buildWorkflowTools() and runAgent()`

## What this plan does not do

Voice: the Vapi assistant's system prompt and function schema are configured entirely
outside this repo. `.planning/workstreams/omnichannel-agent-orchestration/canary/vapi-receptionist-prompt.md`
still contains the literal sentence "Do not ask for the caller's address, ever." — untouched
by this plan, exactly as its own objective states ("Cuts & Culture's voice prompt keeps its
hardcoded 'never ask' sentence until 139 gives it a way to read this setting instead").
Confirmed at verification time this hardcoded sentence is still present in that file, and
that Phase 139 (see 139-VERIFICATION.md) did not, in fact, close this gap for voice.

## Self-Check: PASSED (reconstructed independently from commit `a94ded67` and the live
source tree; this SUMMARY was not written by the executing agent and is being added
retroactively during verification)
