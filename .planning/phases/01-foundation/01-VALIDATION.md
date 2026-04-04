---
phase: 1
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-04
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm run build` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run build`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green + `npm run build` clean
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| brand-rename | 01 | 1 | BRAND-01, BRAND-02 | unit + build | `npx vitest run tests/brand.test.ts && npm run build` | ❌ W0 | ⬜ pending |
| redis-client | 01 | 1 | INFRA-01 | unit | `npx vitest run tests/redis.test.ts` | ❌ W0 | ⬜ pending |
| chat-schema | 01 | 1 | INFRA-02 | manual | `npx supabase db push` + inspect tables | manual | ⬜ pending |
| widget-placeholder | 01 | 1 | INFRA-04 | unit | `npx vitest run tests/widget-asset.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/brand.test.ts` — reads `src/app/layout.tsx` metadata export, asserts `title === "Leaidear"` and `description === "AI Operations Platform"`
- [ ] `tests/redis.test.ts` — imports `src/lib/redis.ts` without `REDIS_URL` set, asserts module loads (gracefully no-ops or defers connection without crashing)
- [ ] `tests/widget-asset.test.ts` — asserts `public/widget.js` exists and contains `// Leaidear widget`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `chat_sessions` and `chat_messages` tables exist with correct columns and RLS | INFRA-02 | Requires live Supabase connection | Run `npx supabase db push`, then inspect table structure in Supabase dashboard or via `supabase db diff` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
