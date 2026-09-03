# Roadmap: Xphere v3.5 Omnichannel Agent Orchestration

## Overview

This milestone extends the existing text-agent platform into a tenant-safe voice and text orchestration layer without replacing Vapi, the unified workflow system, or the Action Engine. Work begins by establishing one trusted invocation boundary and a clean test baseline, then adds least-privilege routing, hardened side-effect execution, end-to-end traces and rollback controls. Release gates run before any production cutover, and the milestone ends with Cuts & Culture as an isolated tenant canary rather than a platform default.

## Phases

**Phase Numbering:**
- Integer phases (131, 132, 133): Planned milestone work
- Decimal phases (131.1, 131.2): Urgent insertions (marked with INSERTED)

- [ ] **Phase 131: Trusted Omnichannel Invocation Foundation** - Voice and widget enter the same tenant-resolved agent boundary on a repaired regression baseline.
- [ ] **Phase 132: Authorized Specialist Orchestration** - Agents route and delegate with typed contracts, least privilege, scoped knowledge, and centralized model access.
- [ ] **Phase 133: Idempotent Action and Vapi Safety** - Voice-triggered actions stay fast, replay-safe, timeout-safe, and compatible with the always-200 Vapi contract.
- [ ] **Phase 134: Traceability and Reversible Routing** - Operators can inspect complete invocation trees and switch each channel between legacy and specialist routing without data loss.
- [ ] **Phase 135: Release Verification and Hardening** - Automated, timed, build, workflow, and UAT gates prove the orchestration path is safe to expose to production traffic.
- [ ] **Phase 136: Cuts & Culture Canary Rollout** - The specialist graph is enabled and proven for one tenant without becoming platform-default behavior.

## Phase Details

### Phase 131: Trusted Omnichannel Invocation Foundation
**Goal**: Voice and web widget requests can enter one typed internal-agent boundary with organization and agent identity resolved only from trusted server-side context, while the existing Vapi and Action Engine baseline is known-good before cutover work begins.
**Depends on**: Phase 130
**Requirements**: AIGW-01, AIGW-02, AIGW-03, AIGW-04, AUTHZ-04, TEST-01
**Success Criteria** (what must be TRUE):
  1. A supported voice or text request reaches an internal agent through the same typed boundary and carries a server-resolved organization, channel, external interaction ID, actor/contact, locale, message or intent, correlation ID, and idempotency key.
  2. A Vapi assistant mapping selects the configured Xphere entry agent from trusted assistant/call data, and supplied tool arguments cannot override either the organization or agent identity.
  3. The same specialist definition can be invoked from Vapi and the web widget while applying a first-class voice policy for prompt, model, history, tools, latency, and delegation.
  4. Authenticated agent configuration remains tenant-isolated through RLS, while the privileged Vapi resolution path derives tenant context explicitly from trusted mappings.
  5. Existing Vapi and Action Engine baseline suites pass without dependence on stale mocks or live Redis availability, so later failures identify real behavioral regressions.
**Plans**: TBD
**UI hint**: yes

### Phase 132: Authorized Specialist Orchestration
**Goal**: Requests reach the right specialist through explicit or delegated routing, and every handoff, capability, knowledge scope, model call, and final response remains typed, bounded, tenant-safe, and least-privileged.
**Depends on**: Phase 131
**Requirements**: ROUT-01, ROUT-02, ROUT-03, ROUT-04, ROUT-05, AUTHZ-01, AUTHZ-02, AUTHZ-03, KNOW-01, KNOW-02, MODEL-01, MODEL-02
**Success Criteria** (what must be TRUE):
  1. An ambiguous request can be delegated by an entry agent to an authorized specialist, while an explicit Vapi function can call its mapped specialist directly without an unnecessary router model call.
  2. A specialist can call another permitted specialist only within channel depth, call-count, time, and cost budgets; cross-organization, cyclic, inactive, and disallowed-channel targets are rejected before any model or action runs.
  3. Delegation permission is separate from direct tool permission, and a delegated action succeeds only when both the specialist's own grants and the configured partner edge allow it.
  4. Exactly one response owner converts typed specialist success, business-failure, retryable-failure, or handoff results into the channel reply without exposing internal monologue.
  5. Each specialist receives only its configured tenant knowledge and minimum approved handoff context, while every generative router, agent, summarizer, and extractor call uses the centralized OpenRouter path with provider-drift tests guarding direct generation paths.
**Plans**: TBD

### Phase 133: Idempotent Action and Vapi Safety
**Goal**: Side-effecting specialist actions execute through the existing Action Engine exactly once, and the latency-sensitive Vapi route remains lean, deterministic, traceably owned, and HTTP-200-compatible under retries, multi-call payloads, timeouts, and failures.
**Depends on**: Phase 132
**Requirements**: SAFE-01, SAFE-02, PERF-01, PERF-02, PERF-03, OBS-03
**Success Criteria** (what must be TRUE):
  1. A stable idempotency key follows a side-effecting request from channel ingress through agent, workflow, Action Engine, and provider execution.
  2. Duplicate delivery, Vapi retry, model retry, or timeout recovery cannot repeat the same Xkedule mutation and instead returns the original recorded result.
  3. A normal voice lookup uses no more than one internal specialist model invocation before deterministic tool execution, and budget exhaustion returns a lean recoverable Vapi result.
  4. Every handled and error path in the Node.js Vapi tool webhook returns HTTP 200 with a lean payload, uses canonical `https://xphere.app` targets, and defers non-essential logging.
  5. Multi-tool Vapi payloads execute every supported call with matching result IDs or reject the unsupported shape deterministically, while timeout handling never reports completion for unowned side-effecting work still in progress.
**Plans**: TBD

### Phase 134: Traceability and Reversible Routing
**Goal**: Operators can follow one request across every orchestration and action boundary, understand nested failures and costs, and move channels between legacy and specialist routing without destroying configuration or history.
**Depends on**: Phase 133
**Requirements**: OBS-01, OBS-02, ROLL-02
**Success Criteria** (what must be TRUE):
  1. An operator can follow one correlation trace from channel ingress through the entry agent, all child specialist invocations, workflow run, Action Engine execution, and provider result.
  2. The trace reports nested tool and partner failures plus partner calls, timing, token usage, model, cost, denial reason, and idempotency replay without plaintext credentials or unnecessary personal data.
  3. An operator can switch voice and text channels independently between legacy and specialist routing, then roll either channel back without deleting agents, mappings, workflows, or invocation history.
**Plans**: TBD

### Phase 135: Release Verification and Hardening
**Goal**: The complete omnichannel orchestration path satisfies its security, provider, idempotency, latency, build, workflow, and human-validation gates before any specialist routing is enabled for production traffic.
**Depends on**: Phase 134
**Requirements**: TEST-02, TEST-03, TEST-04
**Success Criteria** (what must be TRUE):
  1. Automated suites pass for tenant isolation, direct versus delegated authorization, cross-agent calls, cycle/depth limits, handoff injection resistance, OpenRouter-only generation, and Xkedule idempotency.
  2. A realistic timed integration test exercises Vapi ingress through specialist and tool result, with a simple voice lookup meeting p95 at or below 5 seconds under the documented test profile.
  3. The production build, focused Vitest suites, workflow validation, and documented voice/text UAT checklist all pass before the canary receives specialist-routed traffic.
**Plans**: TBD

### Phase 136: Cuts & Culture Canary Rollout
**Goal**: Cuts & Culture alone runs the first production specialist graph across voice and widget, proving shared specialization, real idempotent booking, and complete tracing without installing tenant-specific behavior as a platform default.
**Depends on**: Phase 135
**Requirements**: ROLL-01, ROLL-03
**Success Criteria** (what must be TRUE):
  1. Cuts & Culture has a tenant-scoped entry orchestrator plus Services, Pricing, Availability, Customer, and Booking specialists, and only Booking holds Xkedule write capabilities.
  2. The Cuts & Culture canary configuration is isolated to that tenant and no new or existing organization receives its specialist graph as a platform default.
  3. A live widget interaction and a live Vapi interaction both invoke the same Availability specialist definition successfully.
  4. A real booking completes idempotently and its trace shows channel ingress, routing, specialist invocation, workflow, Action Engine execution, and provider result end to end.
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 131 → 132 → 133 → 134 → 135 → 136.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 131. Trusted Omnichannel Invocation Foundation | 0/TBD | Not started | - |
| 132. Authorized Specialist Orchestration | 0/TBD | Not started | - |
| 133. Idempotent Action and Vapi Safety | 0/TBD | Not started | - |
| 134. Traceability and Reversible Routing | 0/TBD | Not started | - |
| 135. Release Verification and Hardening | 0/TBD | Not started | - |
| 136. Cuts & Culture Canary Rollout | 0/TBD | Not started | - |

---

*Roadmap created: 2026-09-03 — 32/32 active v3.5 requirements mapped exactly once across 6 phases.*
