---
phase: 139-agent-mesh-as-a-template
plan: 08
commit: 524848fe
status: complete_except_the_human_walkthrough
---

# 139-08 - Prove a mesh installs into a second tenant

## What it changed

One new file, `tests/org-templates-agents-e2e.test.ts`, and no source change. It runs the
real `captureOrgSnapshot()` against a source fixture and feeds its output straight into the
real `installSnapshotIntoOrg()` against a different, empty target, across two independent
in-memory Supabase fakes.

The choice that gives it its value: no hand-authored `SnapshotAgent[]` fixture. 139-05's
install test builds one, which necessarily skips the capture step — the seam where a
cross-tenant install is most likely to break. This one crosses that seam.

## Worth knowing

The target fake deliberately holds the **source** organization's row as well as the
target's. So if `resolveTenantFacts()` ever stopped filtering by organization id, the
installed prompt would come out naming Cuts & Culture and the test would catch it. The
assertion is that the orchestrator's installed prompt contains the target's business name,
does not contain the source's, and retains no `{{` token at all.

Six end-state assertions: 6 agents each with a truthy `active_prompt_version_id`, 7 partner
edges, 10 delegated grants, exactly 3 of them write grants all resolving to the same
Booking-shaped destination agent, a second install producing byte-identical counts across
seven tables, and zero `agent_channel_routing_modes` calls on either client across capture
and both installs — so a template cannot switch a tenant's live traffic on.

No defect was found. The executing agent read `snapshot.ts`, `install.ts` and
`prompt-template.ts` in full before writing the test, and was instructed to stop and report
rather than edit source to make a test pass.

## What it did not prove

The plan's `checkpoint:human-verify` — an operator walking through
`Settings → Organization Templates` against the live tenant and installing the mesh into a
real second organization — was not attempted. It needs production access and a person, and
it is the difference between "the pipeline is correct" and "a second tenant is running".

A release-gate run during this plan exited 1 on `security-secdef-isolation`'s `afterAll`
timing out against the live database under parallel load; every assertion in that suite
passed. Addressed separately in `edfb679d` by giving hooks the same 30s budget as tests.
