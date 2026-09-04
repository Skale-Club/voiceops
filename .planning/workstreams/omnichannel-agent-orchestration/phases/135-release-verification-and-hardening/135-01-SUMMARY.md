---
phase: 135-release-verification-and-hardening
plan: 01
commit: ded9a6e9
status: complete
---

# 135-01 - Release gate and safety-critical coverage pins

## What it changed

Gate membership is explicit data rather than a glob, so removing a suite is a visible diff, and the gate runs a named deterministic subset because the full suite carries around 29 pre-existing live-database failures and would be permanently red.

## Worth knowing

The coverage pins parse the 48 action types out of execute-action.ts rather than retyping them, and fail on any type in no bucket. This is what surfaced 24 write action types that still bypass the idempotency guard, and it exists because Phase 133 tested the guard's behaviour thoroughly and never tested which actions reach it.

## Files

```
package.json                |   3 +-
scripts/release-gate.ts     | 185 ++++++++++++++++++++++++
tests/coverage-pins.test.ts | 333 ++++++++++++++++++++++++++++++++++++++++++++
tests/release-gate.test.ts  |  89 ++++++++++++
```
