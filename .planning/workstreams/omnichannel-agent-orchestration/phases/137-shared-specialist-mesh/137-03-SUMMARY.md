---
phase: 137-shared-specialist-mesh
plan: 03
commit: 92a375a7, cb5882eb, 8a58cb3d, 1c8ce4d0, abc3c4f3, 3c7fd967, 3150adc9, f41b021c
status: complete_except_the_booking
---

# 137-03 - Prove the mesh on both channels

## What it changed

Written retroactively to cover work that had already landed as loose commits. Eight of
them, in order: end-to-end measurement against the live tenant, terser specialist prompts,
the voice receptionist redesigned to lead the call, service discovery in the caller's own
words with price gating, `list_services` granted to the specialists that need an id, the
nested Vapi tool-call shape accepted, empty and aborted turns stopped from reporting
success, and spoken lines while a tool runs.

## Worth knowing

Two production failures drove most of it, one per channel, and neither was visible from
tests.

Voice: Vapi sends `{id, type, function:{name, arguments}}`, the schema only accepted the
flattened form, so `safeParse` failed before anything logged and the caller heard that the
menu could not be pulled up. Zero rows in `workflow_runs` made it look like nothing had
happened at all.

Chat: the orchestrator asked Services for a service id and only then Availability, spent
40s, blew the turn budget, and the stream emitted `done` with no text while the invocation
persisted `status=success` - the visitor saw silence and the trace claimed success. Fixed
by sending a named service straight to Availability and by normalising provider completion
so an empty or aborted turn can never be recorded as success.

A model swap was tried and rejected on evidence: `gemini-2.5-flash-lite` benchmarks 606ms
against haiku's 1393ms but invented a `09:15` slot the tool never returned, and separately
failed to call the tool at all - one correct run in three.

## What it did not prove

No booking. Every availability call, live or probed, was a read. MESH-04 stays open, and
it is the same line Phase 136's ROLL-03 stops at.
