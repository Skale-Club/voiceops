---
phase: 2
slug: chat-api
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-04
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm run build` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~20 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run build`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green + `npm run build` clean
- **Max feedback latency:** ~20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| migration-012 | 02-01 | 0 | INFRA-03 | manual | `npx supabase db push` | manual | ⬜ pending |
| test-scaffolds | 02-01 | 0 | INFRA-03, CHAT-04, CHAT-05, CHAT-06 | unit | `npx vitest run tests/chat-api.test.ts tests/chat-session.test.ts tests/chat-persist.test.ts` | ❌ W0 | ⬜ pending |
| session-helpers | 02-02 | 1 | CHAT-04, CHAT-06 | unit | `npx vitest run tests/chat-session.test.ts tests/chat-api.test.ts` | ❌ W0 | ⬜ pending |
| persist-helpers | 02-02 | 1 | CHAT-05 | unit | `npx vitest run tests/chat-persist.test.ts` | ❌ W0 | ⬜ pending |
| route-handler | 02-03 | 1 | INFRA-03, CHAT-04, CHAT-05, CHAT-06 | unit + build | `npx vitest run && npm run build` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/chat-api.test.ts` — covers INFRA-03 and CHAT-06: token validation (valid/invalid/missing token), session ID generation and reuse
- [ ] `tests/chat-session.test.ts` — covers CHAT-04: `getSession`/`setSession` helpers with mocked Redis client
- [ ] `tests/chat-persist.test.ts` — covers CHAT-05: `ensureDbSession`/`persistMessage` with mocked `createServiceRoleClient`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `organizations.widget_token` column exists in remote Supabase | INFRA-03 | Requires live DB connection | Run `npx supabase db push`, confirm column in dashboard |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
