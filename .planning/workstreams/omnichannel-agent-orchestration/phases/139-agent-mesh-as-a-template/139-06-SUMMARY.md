---
phase: 139-agent-mesh-as-a-template
plan: 06
status: complete
completed: 2026-09-04
requirements: [TMPL-02]
---

# Plan 139-06 Summary

## Outcome

A dry-run-by-default, `--apply`-gated script exists that can remove Cuts & Culture's
hardcoded business identity from its own six live agent prompts, replacing it with the
`{{business_name}}`/`{{business_location}}` tokens `prompt-template.ts` (139-02) knows how
to render — with a mandatory roundtrip safety check before any write. **This script has
never been run with `--apply` against the real organization.** Cuts & Culture's live
prompts, and the canary fixtures that mirror them, still contain the literal strings
"Cuts & Culture Barbershop" and "212 Newbury Street, Boston" as of this verification.

## Changes

- `scripts/templatize-agent-prompts.ts`:
  - `templatizeAgentPrompt(prompt, facts)` — pure detect-and-replace: replaces a literal
    `"{name}, {address}"` substring with `{{business_location}}` when both are present,
    falls back to replacing the bare name alone with `{{business_name}}` when no address
    substring is found, and leaves a prompt with neither recognizable substring completely
    unchanged (recorded as "no change needed", not an error).
  - **Mandatory roundtrip guard**: before any write, the function renders the newly
    templatized text back through `renderPromptTemplate()` with the tenant's own facts and
    refuses to write anything unless that render reproduces the original prompt
    byte-for-byte. This is what makes the one-time content fix safe — the operator's
    original live-tested wording for that tenant cannot silently change as a side effect
    of tokenizing it.
  - `templatizeOrgAgentPrompts(admin, orgId, options)` — the safety-gated org-level flow,
    reusing `parseArgs`/`assertSafeToWrite` from `scripts/provision-canary-graph.ts` rather
    than reimplementing them: no arguments → structural preview; `--org` alone → validated
    dry run, writes nothing; `--org` + `--apply` → writes, but only when
    `--expect-slug=<slug>` also matches the resolved organization's slug (refuses
    otherwise). An agent with no active prompt version is skipped, not an error. Every
    changed prompt gets one new, append-only `agent_prompt_versions` row
    (`version = max + 1`) with `active_prompt_version_id` repointed — the prior version row
    is never edited in place.
- `tests/templatize-agent-prompts.test.ts`: 13 tests against an in-memory fake Supabase
  client — the pure function's three substitution cases plus the roundtrip-guard failure
  case, and the org-level flow's argument-gating, slug-mismatch refusal, append-only
  version behavior, and orphan-agent (no active prompt version) skip.

## Verification

- `npx vitest run tests/templatize-agent-prompts.test.ts` — 13/13 passed, independently
  re-run at verification time.
- Independently confirmed at verification time by reading the commit message and this
  file's own header comment: "never run with `--apply` against a real organization." Cross-
  checked against the live canary fixtures — `grep -rl "Cuts & Culture\|Newbury Street" .planning/workstreams/omnichannel-agent-orchestration/canary/`
  still returns `cuts-and-culture.json`, `vapi-receptionist-prompt.md`, and
  `vapi-tool-messages.md` at verification time, consistent with the script never having
  applied its change to the live tenant this phase.

## Files Modified

- `scripts/templatize-agent-prompts.ts`
- `tests/templatize-agent-prompts.test.ts`

## Commit

`1976143d` — `feat(139-06): tokenise the canary prompts into a reusable template`

## What this plan does not do

This is a one-time content-fix script for ONE tenant's OWN prompts (removing that tenant's
own hardcoded identity so a future capture of it produces a genuinely reusable template).
It has no relationship to Phase 138's modality wording — it never touches, reads, or
references `service_location_mode` or `renderServiceLocationBlock()`. That integration
remains unimplemented across the whole phase; see 139-VERIFICATION.md.

## Self-Check: PASSED (reconstructed independently from commit `1976143d` and the live
source tree; this SUMMARY was not written by the executing agent and is being added
retroactively during verification)
