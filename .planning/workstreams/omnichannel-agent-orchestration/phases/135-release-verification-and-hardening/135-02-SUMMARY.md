---
phase: 135-release-verification-and-hardening
plan: 02
commit: 3e3def04
status: complete
---

# 135-02 - p95 measured against a written profile

## What it changed

The profile document was written before the test, so the number could not be reverse-engineered to fit. Measured p95 across five runs: 1410, 1657, 1631, 1406, 1348 ms against a 5000 ms target, and the failure path was verified by temporarily setting the target to 1 ms.

## Worth knowing

Every injected latency is labelled an assumption with a rationale, not a measurement. The document states plainly that it does not prove network transit to Vapi, real inference, real provider latency or database performance under load - it measures orchestration overhead.

## Files

```
docs/agents/latency-profile.md     | 177 ++++++++++++++++++++++
tests/vapi-latency-profile.test.ts | 290 +++++++++++++++++++++++++++++++++++++
```
