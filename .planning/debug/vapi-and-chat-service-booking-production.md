---
status: verifying
trigger: "arrume tudo isso, mas o mais importante dessa historia, e a ligacao e o chat para agendar um servico"
created: 2026-09-04T16:08:52.1666820-04:00
updated: 2026-09-04T17:31:00-04:00
---

## Current Focus

hypothesis: the minimal fixes address both confirmed failure mechanisms without weakening the Vapi HTTP-200/latency or booking authorization contracts
test: run TypeScript, diff hygiene, default/manual discovery checks, the complete release gate, and production build; then apply the targeted live prompt update and repeat real chat/voice probes
expecting: static/build/gate checks pass, default tests exclude manual probes, manual config finds them, and live chat produces user-visible availability without the Services detour
next_action: rerun the production build with the repository-documented 8 GB Node heap, then update the targeted live prompt

## Symptoms

expected: A caller or chat visitor can choose a service, query availability, and create a booking; the assistant receives correlated tool results and confirms the appointment.
actual: The real Vapi call produced "No result returned" for lookup_customer and list_services with zero workflow_runs. Chat booking success has not yet been proven end-to-end. Commit 3c7fd967 may be deployed but GitHub only queued Coolify.
errors: Vapi "No result returned for <toolCallId>". Parser previously returned {results:[]} before logging. VAPI_WEBHOOK_SECRET differs between Coolify production (66 chars) and preview (64 chars); Vapi tools carry the preview fingerprint, which production accepted before rollout. vapi_secret_rejected did not surface in Sentry. CI gate for the commit reports 200 passed and 10 skipped; the new regression test is not a GATE_MEMBER. tests/manual/*.test.ts are included by the normal Vitest glob and can call production. tests/action-engine.test.ts was given 20s despite global testTimeout 30s. Malformed string arguments currently normalize to {}. There is no route-level regression test for nested payload.
reproduction: "Voice: call the Cuts & Culture Vapi assistant and ask to schedule a service; captured call id prefix 01a06de4. Parser: POST /api/vapi/tools with nested toolCallList shape. Chat: use the Cuts & Culture widget/chat token and ask to schedule a service; exact live E2E needs discovery from repo/planning."
started: First post-credential-fix v3 production call on 2026-09-04. Commit 3c7fd967 pushed at 19:51Z; GitHub build/deploy job later succeeded but only queues Coolify.

## Eliminated

## Evidence

- timestamp: 2026-09-04T16:13:30-04:00
  checked: persistent debug knowledge base
  found: .planning/debug/knowledge-base.md does not exist
  implication: there is no prior resolved-session pattern to test first
- timestamp: 2026-09-04T16:13:30-04:00
  checked: git status and recent history
  found: HEAD is local commit b7a91816, one commit ahead of origin/main and origin/dev at 3c7fd967; working tree contains only the new debug directory
  implication: preserve the operator's unpushed production probe commit and base all fixes on top without rewriting it
- timestamp: 2026-09-04T16:13:30-04:00
  checked: project source-of-truth documents
  found: the Action Engine is explicitly the core value and both Vapi voice and web chat are intended to share it; Vapi routes must remain Node.js, lean, and always HTTP 200
  implication: the fix must preserve latency and prove both channel adapters, not only the schema helper
- timestamp: 2026-09-04T16:25:00-04:00
  checked: current Vapi normalization and test/config wiring
  found: malformed non-empty argument strings are silently converted to {}; tests/manual is included by the default Vitest glob; the nested-payload regression is absent from GATE_MEMBERS; action-engine create_contact has an explicit 20s timeout despite a 30s global timeout
  implication: each review concern is directly reproducible in source and needs a targeted correction
- timestamp: 2026-09-04T16:25:00-04:00
  checked: live Cuts & Culture web chat probe supplied by the orchestrator
  found: session 6562740b-0763-47d1-b53f-419a5c21d26c emitted think, services-partner and availability-partner events, then done with zero token/text events
  implication: chat has a distinct end-to-end failure after successful tool orchestration; fixing Vapi parsing alone cannot satisfy the booking goal
- timestamp: 2026-09-04T16:31:00-04:00
  checked: live production Vapi nested-shape probe using the assistant's currently configured server secret
  found: lookup_customer returned one correlated result in 4.5s and check_availability returned one correlated result in 8.5s with real slots
  implication: commit 3c7fd967 is active in production and the secret currently embedded in the assistant is accepted by production; the immediate voice parse/secret failure is no longer reproducing
- timestamp: 2026-09-04T16:31:00-04:00
  checked: chat streaming loop in run-agent.ts
  found: it uses stopWhen stepCountIs(effectiveMaxSteps), emits text only for text-delta parts, and emits done even when accumulatedText remains empty; no final fallback is synthesized for a successful tool-only terminal step
  implication: a step-budget exhaustion can exactly produce the observed tool events followed by an empty visitor response
- timestamp: 2026-09-04T16:34:00-04:00
  checked: first read-only agent_invocations query attempt
  found: tsx -e rejected top-level await under CommonJS output before any query executed
  implication: retry with an async IIFE; no production state was touched
- timestamp: 2026-09-04T16:48:00-04:00
  checked: persisted live chat trace supplied by the orchestrator
  found: root invocation d7d4c11f completed after 40019ms with status=success and assistant_reply=''; Services took 10.2s and Availability took 15.85s before the root hit the production turn ceiling
  implication: chat failure is a provider abort/step termination that the stream loop misclassified as successful completion; the unnecessary first specialist consumed decisive latency
- timestamp: 2026-09-04T16:48:00-04:00
  checked: recursive partner invocation wiring
  found: parent traceId, conversationId and sessionId were not passed into runAgentBlocking, so live child invocations had unrelated trace ids and no conversation linkage
  implication: booking traces could not be followed end-to-end despite parent_invocation_id; propagate trusted correlation fields to children
- timestamp: 2026-09-04T16:55:00-04:00
  checked: first focused regression run
  found: 94/99 assertions passed; all new Vapi/completion tests passed. Five canary tests exposed stale expectations (8 direct grants/10 edge grants) while the checked-in graph intentionally contains 11/14 after specialists gained list_services. Importing run-agent for a pure helper also opened Redis handles.
  implication: update the canary assertions to the actual authorized graph and move completion normalization to a side-effect-free module before rerunning
- timestamp: 2026-09-04T17:01:00-04:00
  checked: focused regression rerun
  found: 7 files and 99 tests passed with zero failures, including Vapi nested route execution, malformed argument rejection, completion fallback/status, trace propagation, gate membership and canary routing/authorization
  implication: proceed to repository-wide gates and live configuration verification
- timestamp: 2026-09-04T17:08:00-04:00
  checked: patch hygiene and repository TypeScript baseline
  found: git diff --check passed. npx tsc --noEmit fails on numerous pre-existing test-only errors (missing removed modules, stale fixtures and mock tuple typing); it reported no error in the changed src files. Full vitest list imports the whole suite and hung on existing open handles, so it was stopped.
  implication: use the repository's required production build for source type safety and explicit filtered discovery commands for manual-probe isolation
- timestamp: 2026-09-04T17:15:00-04:00
  checked: release gate and manual probe discovery
  found: release gate passed 226/226 deterministic tests plus 33/33 workflow validations. Default Vitest config lists zero tests for an explicit tests/manual path, while vitest.manual.config.ts lists the production probe correctly.
  implication: the regressions now block releases and normal test runs cannot accidentally call production; proceed to production build and live prompt remediation
- timestamp: 2026-09-04T17:31:00-04:00
  checked: first production build attempt
  found: webpack compiled successfully in 8.1 minutes, then the Next TypeScript worker exhausted Node's default 2 GB heap (exit 134) before reporting a type error
  implication: this is the documented build-resource constraint, not evidence of a code failure; rerun with NODE_OPTIONS=--max-old-space-size=8192

## Resolution

root_cause: "Voice: Vapi's real nested function-call wire shape was rejected by a flat-only schema, returning an empty results array. Chat: the entry agent chained Services then Availability, exceeded the production turn budget, and the streaming adapter emitted done with no text while persisting status=success because clean AbortSignal/step exhaustion was not normalized. Recursive specialists also dropped trace/conversation correlation."
fix: "Accept and normalize both Vapi shapes; reject malformed argument strings with a correlated result; enforce a non-empty/abort-aware agent completion contract; route named-service availability directly to Availability; propagate trace/conversation/session to child invocations; gate regressions; isolate manual production probes; remove the contradictory per-test timeout."
verification: ""
files_changed: [src/types/vapi.ts, src/app/api/vapi/tools/route.ts, src/lib/agent-runtime/run-agent.ts, src/lib/agent-runtime/completion.ts, tests/vapi-payload-shape.test.ts, tests/vapi-tools-multicall.test.ts, tests/agent-completion-contract.test.ts, scripts/release-gate.ts, vitest.config.ts, vitest.manual.config.ts, package.json, tests/action-engine.test.ts, .planning/workstreams/omnichannel-agent-orchestration/canary/cuts-and-culture.json, tests/canary-graph-shape.test.ts]
