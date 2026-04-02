---
phase: 1
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-02
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (ESM-native, no Next.js config friction) |
| **Config file** | `vitest.config.ts` — Wave 0 gap |
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
| TEN-01 | DB schema | 1 | TEN-01 | Integration (API) | `npx vitest run tests/organizations.test.ts` | ❌ Wave 0 | ⬜ pending |
| TEN-02 | RLS policies | 1 | TEN-02 | Integration (DB/RLS) | `npx vitest run tests/rls-isolation.test.ts` | ❌ Wave 0 | ⬜ pending |
| TEN-03 | Assistant mappings | 2 | TEN-03, TEN-04 | Integration (API) | `npx vitest run tests/assistant-mappings.test.ts` | ❌ Wave 0 | ⬜ pending |
| TEN-04 | Toggle mapping | 2 | TEN-04 | Integration (API) | `npx vitest run tests/assistant-mappings.test.ts` | ❌ Wave 0 | ⬜ pending |
| TEN-05 | Org list | 2 | TEN-05 | Integration (API) | `npx vitest run tests/organizations.test.ts` | ❌ Wave 0 | ⬜ pending |
| AUTH-01 | Sign-in | 2 | AUTH-01 | Integration (Auth) | `npx vitest run tests/auth.test.ts` | ❌ Wave 0 | ⬜ pending |
| AUTH-02 | Session persistence | 2 | AUTH-02 | Manual | Browser test (cookie survives refresh) | N/A | ⬜ pending |
| AUTH-03 | Sign-out | 2 | AUTH-03 | Integration (Auth) | `npx vitest run tests/auth.test.ts` | ❌ Wave 0 | ⬜ pending |
| AUTH-04 | Middleware redirect | 1 | AUTH-04 | Integration (middleware) | `npx vitest run tests/middleware.test.ts` | ❌ Wave 0 | ⬜ pending |
| AUTH-05 | User-org linking | 1 | AUTH-05 | Integration (DB) | `npx vitest run tests/auth.test.ts` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest.config.ts` — Vitest config for Next.js App Router
- [ ] `tests/auth.test.ts` — stubs for AUTH-01, AUTH-03, AUTH-05
- [ ] `tests/middleware.test.ts` — stub for AUTH-04
- [ ] `tests/organizations.test.ts` — stubs for TEN-01, TEN-05
- [ ] `tests/assistant-mappings.test.ts` — stubs for TEN-03, TEN-04
- [ ] `tests/rls-isolation.test.ts` — cross-org RLS isolation tests for TEN-02

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Session survives browser refresh | AUTH-02 | Requires real browser cookie inspection | Log in → F5 → verify still logged in, DevTools cookies show `sb-*` cookie |
| RLS isolation confirmed | TEN-02 | Requires live Supabase instance with two real org users | Create 2 orgs, 2 users; verify user A cannot query user B's org data |

---

## Critical: RLS Integration Test Pattern

The following 5 cross-org scenarios MUST pass before phase is complete (TEN-02):

1. User A queries `organizations` → returns only Org A's record (not Org B)
2. User A queries `org_members` → returns only Org A's members
3. User A queries `assistant_mappings` → returns only Org A's mappings
4. User A attempts INSERT to `assistant_mappings` with `organization_id = org_b_id` → rejected by WITH CHECK policy
5. User with no `org_members` record queries any table → returns empty result (not error)

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
