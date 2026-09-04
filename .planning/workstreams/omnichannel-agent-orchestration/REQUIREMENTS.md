# Requirements: Xphere v3.5 Omnichannel Agent Orchestration

**Defined:** 2026-09-03
**Core Value:** Voice and text must reach the correct tenant-scoped specialist and execute business actions through the Action Engine quickly, safely, and observably.

## v3.5 Requirements

Total: **32 active requirements** across 7 delivery categories.

### Shared Invocation Boundary

- [x] **AIGW-01**: Every supported conversational channel can invoke an internal agent through one typed invocation boundary carrying server-resolved organization, channel, external interaction ID, actor/contact, locale, message or intent, correlation ID, and idempotency key.
- [x] **AIGW-02**: A Vapi assistant mapping can select an internal Xphere entry agent without accepting organization or agent identity from untrusted tool arguments.
- [x] **AIGW-03**: `voice` is a first-class agent channel with channel-specific prompt, model, history, tool, latency, and delegation policies.
- [x] **AIGW-04**: Web widget and Vapi can invoke the same specialist agent definitions without duplicating prompts, knowledge, or tool assignments per channel.

### Routing and Specialization

- [x] **ROUT-01**: An entry agent can delegate an ambiguous request to an authorized specialist using a structured handoff contract.
- [x] **ROUT-02**: A Vapi function whose intent is already explicit can invoke its mapped specialist directly, avoiding an unnecessary orchestrator model call.
- [x] **ROUT-03**: One specialist can invoke another authorized specialist when required, subject to channel-specific depth, call-count, time, and cost budgets.
- [x] **ROUT-04**: Every invocation has exactly one response owner responsible for converting specialist output into the channel response; internal monologue is never exposed.
- [x] **ROUT-05**: Specialist outputs use typed success, business-failure, retryable-failure, and handoff-result contracts instead of relying only on free-form prose.

### Authorization and Tenant Safety

- [x] **AUTHZ-01**: Direct tool execution permission is distinct from permission to delegate to a specialist; an orchestrator does not need the specialist's tools attached to call that specialist.
- [x] **AUTHZ-02**: A delegated agent can execute only the capabilities allowed by its own grants and the partner edge; delegation never expands access beyond either boundary.
- [x] **AUTHZ-03**: Delegation rejects cross-organization agents, cycles, inactive agents, disallowed channels, and calls beyond the configured budget before invoking a model or action.
- [x] **AUTHZ-04**: Authenticated agent configuration remains RLS-scoped, while Vapi webhook resolution uses an explicit privileged path and derives organization context from trusted assistant/call mappings.

### Knowledge and Model Routing

- [x] **KNOW-01**: Agent `kb_scope` is enforced at runtime so a specialist receives only its configured tenant knowledge, or no automatic retrieval when disabled.
- [x] **KNOW-02**: Structured handoffs include only the minimum approved context and reject nested role, system, instruction, secret, credential, and organization-override fields.
- [x] **MODEL-01**: Every generative Xphere agent, router, summarizer, and extractor invocation uses the centralized OpenRouter provider path with tenant key first and platform fallback according to policy.
- [x] **MODEL-02**: Direct OpenAI or Anthropic generation paths are removed or explicitly classified as non-generative embedding infrastructure with documented ownership and tests preventing provider drift.

### Action Safety and Latency

- [x] **SAFE-01**: Booking, rescheduling, cancellation, contact creation, and other side-effecting operations receive a stable idempotency key propagated from channel ingress through agent, workflow, Action Engine, and provider execution.
- [x] **SAFE-02**: Duplicate delivery, Vapi retries, model retries, or timeout recovery cannot execute the same Xkedule mutation more than once and return the original result when replayed.
- [x] **PERF-01**: Voice uses a latency policy that normally permits at most one internal specialist model invocation before deterministic tool execution; budget exhaustion returns a lean recoverable Vapi result.
- [x] **PERF-02**: Vapi tool webhooks preserve Node.js runtime, canonical `https://xphere.app` URLs, lean payloads, asynchronous non-essential logging, and HTTP 200 responses for all handled and error paths.
- [x] **PERF-03**: A request timeout stops or safely detaches downstream work; it cannot report completion while a side-effecting operation continues without traceable ownership.

### Observability and Rollout

- [x] **OBS-01**: One trace links channel ingress, entry agent, every specialist invocation, workflow run, Action Engine execution, and provider result using parent/child invocation relationships.
- [x] **OBS-02**: Invocation status reflects nested tool and partner failures; `partner_calls`, timing, token usage, model, cost, denial reason, and idempotency replay are recorded without plaintext credentials or unnecessary personal data.
- [x] **OBS-03**: Vapi payloads containing multiple tool calls either execute every supported call with matching result IDs or reject the unsupported shape deterministically without silently ignoring calls.
- [ ] **ROLL-01**: Cuts & Culture is configured as the first tenant canary with entry orchestrator plus Services, Pricing, Availability, Customer, and Booking specialists; only Booking receives Xkedule write capabilities.
- [x] **ROLL-02**: Operators can switch each channel between legacy and specialist routing independently and roll back without deleting agents, mappings, workflows, or invocation history.
- [ ] **ROLL-03**: A live canary proves the same Availability specialist is called from widget and Vapi, followed by a real idempotent booking flow and a trace showing the complete path.

### Verification Gates

- [x] **TEST-01**: Existing Vapi and Action Engine baseline tests are repaired before behavioral cutover so failures distinguish regressions from stale mocks or external Redis availability.
- [x] **TEST-02**: Automated tests cover tenant isolation, direct versus delegated authorization, cross-agent calls, cycle/depth limits, handoff injection resistance, OpenRouter-only generation, and Xkedule idempotency.
- [x] **TEST-03**: A realistic timed integration test exercises Vapi ingress to specialist to tool result; simple voice lookup meets a p95 target of 5 seconds under the documented test profile.
- [x] **TEST-04**: Build, focused Vitest suites, workflow validation, and a documented voice/text UAT checklist pass before specialist routing is enabled for production traffic.

## Future Requirements

### Optimization

- **OPT-01**: Deterministic or learned routing can bypass the orchestrator for additional text-channel intents after production traces establish safe confidence thresholds.
- **OPT-02**: Tenant administrators can inspect latency and cost budgets per channel and receive proactive alerts when thresholds are exceeded.
- **OPT-03**: Offline evaluation datasets score intent routing and specialist answers before prompt or model versions are promoted.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Replacing Vapi STT, TTS, telephony, or its live conversation loop | Vapi remains the voice runtime; Xphere owns internal specialization and action orchestration. |
| Creating a separate copy of every specialist for voice and text | Channel overrides on shared agents are the intended abstraction. |
| Giving the orchestrator every specialist tool | This recreates the overloaded generalist and defeats least privilege. |
| Unbounded or autonomous agent spawning | Agent relationships are configured, tenant-scoped, budgeted, and auditable. |
| Replacing the Action Engine or unified workflow system | They remain the authoritative execution substrate. |
| Installing the Cuts & Culture specialist graph as a universal default | The canary is tenant configuration, not platform-wide business behavior. |
| Migrating the embedding model solely to satisfy generative-provider policy | Embeddings require a separate compatibility and reindexing decision. |

## Traceability

Every active v3.5 requirement maps to exactly one implementation phase.

| Requirement | Phase | Status |
|-------------|-------|--------|
| AIGW-01 | Phase 131 | Complete |
| AIGW-02 | Phase 131 | Complete |
| AIGW-03 | Phase 131 | Complete |
| AIGW-04 | Phase 131 | Complete |
| ROUT-01 | Phase 132 | Done |
| ROUT-02 | Phase 132 | Done |
| ROUT-03 | Phase 132 | Done |
| ROUT-04 | Phase 132 | Done |
| ROUT-05 | Phase 132 | Done |
| AUTHZ-01 | Phase 132 | Done |
| AUTHZ-02 | Phase 132 | Done |
| AUTHZ-03 | Phase 132 | Done |
| AUTHZ-04 | Phase 131 | Complete |
| KNOW-01 | Phase 132 | Done |
| KNOW-02 | Phase 132 | Done |
| MODEL-01 | Phase 132 | Done |
| MODEL-02 | Phase 132 | Done |
| SAFE-01 | Phase 133 | Done |
| SAFE-02 | Phase 133 | Done |
| PERF-01 | Phase 133 | Done |
| PERF-02 | Phase 133 | Done |
| PERF-03 | Phase 133 | Done |
| OBS-01 | Phase 134 | Done |
| OBS-02 | Phase 134 | Done |
| OBS-03 | Phase 133 | Done |
| ROLL-01 | Phase 136 | Pending |
| ROLL-02 | Phase 134 | Done |
| ROLL-03 | Phase 136 | Pending |
| TEST-01 | Phase 131 | Complete |
| TEST-02 | Phase 135 | Done |
| TEST-03 | Phase 135 | Done |
| TEST-04 | Phase 135 | Done |

### Coverage Summary by Phase

| Phase | Requirement Count | Requirements |
|-------|------------------:|--------------|
| Phase 131 | 6 | AIGW-01..04, AUTHZ-04, TEST-01 |
| Phase 132 | 12 | ROUT-01..05, AUTHZ-01..03, KNOW-01..02, MODEL-01..02 |
| Phase 133 | 6 | SAFE-01..02, PERF-01..03, OBS-03 |
| Phase 134 | 3 | OBS-01..02, ROLL-02 |
| Phase 135 | 3 | TEST-02..04 |
| Phase 136 | 2 | ROLL-01, ROLL-03 |
| **Total** | **32** | **All active requirements mapped exactly once** |

**Coverage:**
- v3.5 requirements: 32 total
- Mapped to phases: 32
- Unmapped: 0
- Duplicate phase ownership: 0

---
*Requirements defined: 2026-09-03 from operator architecture discussion and repository analysis.*
*Last updated: 2026-09-03 — roadmap traceability populated with 32/32 requirements across Phases 131-136.*
