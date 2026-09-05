---
phase: 139-agent-mesh-as-a-template
plan: 02
status: complete
completed: 2026-09-04
requirements: [TMPL-02]
---

# Plan 139-02 Summary

## Outcome

A pure, tenant-neutral rendering mechanism now exists: `{{business_name}}` /
`{{business_location}}` tokens in a prompt template render to one target organization's
real facts, preferring a live Xkedule `business-info` fetch when connected and falling
back to the organization's own `name`/address columns otherwise. Both the install path
(139-05) and the one-off content fix that detokenizes Cuts & Culture's own live prompts
(139-06) use this exact renderer.

## Changes

- `src/lib/org-templates/prompt-template.ts`:
  - `renderPromptTemplate(template, facts)` — pure string substitution.
    `{{business_location}}` renders as `"{name}, {address}"` when an address is present,
    or just the name when it is not (no dangling comma, no literal `"null"`).
    `{{business_name}}` renders as the name alone. A template containing neither token
    round-trips unchanged.
  - `resolveTenantFacts(admin, orgId)` — reads the `organizations` row first
    (`name` + the six address columns) as the fallback. Then tries
    `getXkeduleCredentialsForOrg()` + `xkeduleFetchJson('/api/v1/business-info', ...)`
    inside a `try/catch`; on success, prefers Xkedule's non-empty `businessName`/`address`
    over the fallback. Any failure (no integration, decrypt error, network error, timeout)
    is swallowed and the organizations-row fallback is returned. Never throws. Read-only —
    no insert/update/upsert anywhere in the module.
  - No tenant-specific string anywhere in the file (confirmed at verification time: no
    "Cuts & Culture" / "Newbury Street" literal in this module) — independent of
    `snapshot.ts`/`install.ts` so it could land in the same wave without file contention.
- `tests/org-templates-prompt-template.test.ts`: 8 cases — 3 for the renderer (both
  tokens, name-only fallback, no-token round-trip) and 5 for the resolver (Xkedule
  preferred when connected, organizations-row fallback when not connected, and the
  swallow-and-fallback behavior for decrypt/network/timeout failures), mocking
  `@/lib/xkedule/credentials` and `@/lib/xkedule/client`.

## Verification

- `npx vitest run tests/org-templates-prompt-template.test.ts` — 8/8 passed, independently
  re-run at verification time as part of a combined 51-test run.

## Files Modified

- `src/lib/org-templates/prompt-template.ts`
- `tests/org-templates-prompt-template.test.ts`

## Commit

`3187234a` — `feat(139-02): tenant-facts resolver and prompt-token renderer`

## What this plan does not do

This module renders `business_name`/`business_location` tokens only. It has no awareness
of Phase 138's `service_location_mode` or `renderServiceLocationBlock()` — confirmed at
verification time by grepping this file and every other file under `src/lib/org-templates/`
and `src/lib/vapi/` for `service_location`/`modality`/`ServiceLocation`: zero matches
anywhere in either directory. No later plan in this phase (139-04 through 139-07) adds
that integration either — see 139-VERIFICATION.md's central finding.

## Self-Check: PASSED (reconstructed independently from commit `3187234a` and the live
source tree; this SUMMARY was not written by the executing agent and is being added
retroactively during verification)
