---
phase: 2
slug: action-engine
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-02
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (ESM-native, already installed) |
| **Config file** | `vitest.config.ts` — already exists from Phase 1 |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| DB-01 | 02-01 | 1 | ACTN-03, ACTN-10 | Integration (DB) | `npx vitest run tests/integrations.test.ts` | ❌ Wave 0 | ⬜ pending |
| CRYPTO-01 | 02-02 | 1 | ACTN-04 | Unit (crypto) | `npx vitest run tests/crypto.test.ts` | ❌ Wave 0 | ⬜ pending |
| GHL-01 | 02-03 | 2 | ACTN-09 | Unit (fetch mocked) | `npx vitest run tests/ghl-executor.test.ts` | ❌ Wave 0 | ⬜ pending |
| ENGINE-01 | 02-04 | 2 | ACTN-01, ACTN-02 | Unit | `npx vitest run tests/action-engine.test.ts` | ❌ Wave 0 | ⬜ pending |
| ROUTE-01 | 02-05 | 3 | ACTN-11, ACTN-12 | Unit | `npx vitest run tests/action-engine.test.ts` | ❌ Wave 0 | ⬜ pending |
| UI-INT | 02-06 | 3 | ACTN-05, ACTN-06, ACTN-07, ACTN-08 | Integration (API) | `npx vitest run tests/integrations.test.ts` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/crypto.test.ts` — stubs for ACTN-04 (encryption round-trip, masked display)
- [ ] `tests/ghl-executor.test.ts` — stubs for ACTN-09 (create contact, check availability, book appointment)
- [ ] `tests/action-engine.test.ts` — stubs for ACTN-01, ACTN-02, ACTN-11, ACTN-12 (org resolution, tool routing, fallback, 500ms)
- [ ] `tests/integrations.test.ts` — stubs for ACTN-03, ACTN-05, ACTN-06, ACTN-07, ACTN-08 (CRUD + test connection)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real Vapi webhook fires tool and gets response | ACTN-01, ACTN-12 | Requires live Vapi + GHL accounts | Configure test assistant in Vapi → make test call → confirm action_logs row created within 500ms |
| Test Connection button with real GHL credentials | ACTN-05 | Requires live GHL sub-account | Enter real GHL token + locationId → click Test Connection → confirm success toast appears |
| Encrypted key is not visible in DB | ACTN-04 | Requires Supabase SQL editor | SELECT encrypted_api_key FROM integrations → confirm value is base64 ciphertext, not plain text |
| Fallback message on GHL timeout | ACTN-11 | Requires simulated timeout | Mock GHL to delay > 400ms → confirm Vapi receives fallback_message in result field |

---

## Critical: Action Engine Integration Scenarios

The following 5 end-to-end scenarios MUST pass before phase is complete:

1. POST to `/api/vapi/tools` with valid `assistantId` → returns HTTP 200 with correct `results[0].result` within 500ms
2. POST with unknown `assistantId` → returns HTTP 200 with `"Service unavailable."` (no 4xx/5xx)
3. GHL action fails (API error) → Vapi receives `fallback_message` (not the error detail) with HTTP 200
4. Org A's tool config does not execute using Org B's credentials (RLS isolation on `tool_configs` + `integrations`)
5. `action_logs` row is created after response is sent with correct status/executionMs/payload fields

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
