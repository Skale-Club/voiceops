---
phase: 135-release-verification-and-hardening
plan: 03
commit: 0ff28a3e
status: complete
---

# 135-03 - CI gate and the UAT checklist

## What it changed

A workflow that runs the gate subset plus the latency test on pull requests and on pushes touching the orchestration surface, with no continue-on-error escape hatch. Deliberately not coupled to build-deploy.yml, so an unproven gate cannot block production deploys.

## Worth knowing

12 UAT items, split into what can be checked now, what needs production access, and what was not performable at all because no live route called the routing resolver yet. npm run build is excluded from the gate with its rationale stated rather than silently omitted.

## Files

```
.github/workflows/release-gate.yml | 111 +++++++++++++++
docs/agents/release-gate.md        | 204 ++++++++++++++++++++++++++++
docs/agents/uat-checklist.md       | 268 +++++++++++++++++++++++++++++++++++++
```
