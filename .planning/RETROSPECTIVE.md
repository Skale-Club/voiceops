# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — VoiceOps MVP

**Shipped:** 2026-04-03
**Phases:** 6 | **Plans:** 30 | **Timeline:** 4 days (2026-03-30 → 2026-04-03)

### What Was Built
- Multi-tenant foundation with Supabase RLS, auth, and org management
- Action Engine: Edge Function webhook → GHL execution → async logging (<500ms)
- Observability: call ingestion, paginated list, chat transcript with tool badges, dashboard metrics
- Knowledge Base: document upload → vectorization (OpenAI + pgvector) → semantic search during calls
- Outbound Campaigns: CSV import, Vapi dialing with cadence, Realtime contact status
- API Key Admin: per-org encrypted key management for 8 providers

### What Worked
- GSD phased planning kept scope tight — each phase had clear success criteria
- Edge Function architecture achieved <500ms target for Vapi webhook responses
- Supabase RLS-first approach prevented any multi-tenant data leaks by design
- Progressive phase dependencies (Foundation → Action Engine → Observability → Knowledge → Campaigns) meant each phase built on a stable base
- Per-org API key migration (Phase 6) was a clean refactor that touched many files but broke nothing

### What Was Inefficient
- ROADMAP.md progress table and REQUIREMENTS.md traceability were not updated as phases completed — caused stale tracking at milestone end
- VERIFICATION.md was never created for any phase — all verification was ad-hoc
- SUMMARY.md frontmatter `requirements_completed` arrays were mostly left empty
- Nyquist validation files were draft/incomplete for phases that had them, missing for others

### Patterns Established
- `get_current_org_id()` SECURITY DEFINER function as the single source of org context for RLS
- `after()` pattern for deferred async work in Edge Functions (logging, heavy processing)
- Belt-and-suspenders auth: middleware `getClaims()` + layout `getUser()` double-check
- `getProviderKey()` as unified interface for fetching encrypted per-org API keys
- Service-role client for bootstrap operations (org creation, bulk contact import)

### Key Lessons
1. Track requirement completion in SUMMARY.md frontmatter as you go — retroactive tracking is painful
2. Phase verification should happen immediately after execution, not deferred to milestone audit
3. Edge Function + `after()` pattern is excellent for Vapi's latency constraints — keep this for all webhook routes
4. Supabase RLS with SECURITY DEFINER functions is the right abstraction — simpler than application-level filtering

### Cost Observations
- Model mix: predominantly opus for planning, sonnet for execution
- 95 commits across 4 days
- Notable: Phase 6 (API key admin) was a single-plan phase that touched 9 files across 4 prior phases — clean cross-cutting refactor

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Timeline | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | 4 days | 6 | Initial build — established all patterns |

### Cumulative Quality

| Milestone | Tests | Todo Stubs | Audit Score |
|-----------|-------|------------|-------------|
| v1.0 | 38 passing | 132 todos | 42/42 req wired |

### Top Lessons (Verified Across Milestones)

1. Track requirements completion incrementally — not at milestone end
2. RLS-first multi-tenancy prevents entire categories of bugs
