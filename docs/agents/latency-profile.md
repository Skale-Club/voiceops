# Vapi Path Latency Profile (TEST-03)

Status: written before the test it backs (`tests/vapi-latency-profile.test.ts`),
per the standing rule for this workstream — a p95 number is only a
reproducible claim if the profile that produced it is written down first.

## What this measures

**Orchestration overhead for one voice turn**: the CPU-bound work Xphere's own
code does to take a trusted Vapi ingress event, resolve it to a specialist
agent, enforce the channel's cost/latency guardrails, and dispatch a
deterministic tool call — with the actual network calls to third parties
replaced by fixed, documented delays standing in for where a real round trip
would happen.

**Read the next section before trusting this number for anything beyond
that.**

## What this profile does NOT prove

This is a deterministic, in-process simulation. It does **not** prove:

- **Real network transit to Vapi** (the WebSocket/SIP signalling path between
  the caller's phone, Vapi's infrastructure, and Xphere's webhook). None of
  that transport exists in this test.
- **Real model inference time.** The specialist's own LLM turn is replaced by
  a fixed delay (see below). No OpenRouter/Anthropic call is made. Real
  provider latency varies by model, load, and prompt length in ways this
  profile cannot see.
- **Real Xkedule (or any vendor) API latency.** The availability lookup's
  HTTP call is replaced by a fixed delay. Xkedule's own infrastructure,
  network conditions, and cold-cache computation cost are not represented.
- **Database engine performance under real load or connection contention.**
  Every Supabase/Postgres round trip is replaced by a fixed delay chosen as a
  representative same-region indexed-lookup figure, not a measurement of the
  live database.

In short: **a green result here means Xphere's own routing, guardrail, and
dispatch logic did not regress in a way that adds CPU-bound orchestration
overhead.** It does not mean a live phone call resolves in under 5 seconds
end to end against real vendors. That end-to-end claim needs a live,
network-attached test this profile deliberately is not.

## Scenario: "simple voice lookup"

One voice turn, single specialist hop, single read-only tool call — the
shortest realistic path from Vapi ingress to a tool result:

1. A trusted Vapi voice event has already been authenticated (webhook secret
   verification, per `src/lib/vapi/verify-signature.ts`) and resolved to an
   `(organizationId, channel: 'voice')` pair by the caller. That
   authentication step itself is out of scope for this profile — it precedes
   the code paths below and is pure request-verification, not agent
   orchestration.
2. **Ingress routing-mode resolution** — `resolveChannelRoutingMode()`
   (`src/lib/agent-runtime/routing-mode.ts`) reads the org's
   `agent_channel_routing_modes` row for the `voice` channel to decide
   legacy-vs-specialist routing. This is the actual first read on the real
   ingress path per that module's own documentation.
3. **Trusted specialist routing** — `resolveTrustedAgentRoute()`
   (`src/lib/agent-runtime/invocation-gateway.ts`), which calls
   `resolveSpecialistRoute()` to map a trusted, channel-adapter-chosen intent
   (e.g. an `availability_specialist` function name) directly to an active,
   same-org, voice-allowed specialist agent — no router/orchestrator model
   call.
4. **Partner budget + channel ceiling** — `invokeInternalSpecialist()`
   (`src/lib/agent-runtime/invocation-gateway.ts`) checks the voice channel's
   internal-specialist-invocation ceiling
   (`checkChannelModelInvocationCeiling()` in `guardrails.ts`, backed by the
   Phase 132 tree-shared `PartnerBudget`) before allowing the specialist's own
   model turn, then invokes it.
5. **The specialist's model turn itself** — a single, short LLM call that
   produces a decision to call the `xkedule_check_availability` tool. This is
   the model-inference boundary named above as simulated.
6. **Deterministic tool execution** — `executeAction('xkedule_check_availability', …)`
   (`src/lib/action-engine/execute-action.ts`) dispatches to
   `getXkeduleCredentialsForOrg()` (a DB read) and then
   `checkXkeduleAvailability()` (`src/lib/xkedule/actions/check-availability.ts`),
   which calls the real `xkeduleFetchJson()`/`xkeduleFetch()` HTTP client code
   in `src/lib/xkedule/client.ts` — only the underlying `fetch()` network call
   is replaced by a fixed delay + canned JSON response. URL construction,
   header assembly, JSON encoding/decoding, and error handling in the client
   all run for real.

"Simple" here specifically means: one specialist hop (no nested delegation
through a second partner edge), one tool call, no retries, no idempotency
replay, and a warm-cache/typical-case vendor response — not the pathological
cold-cache case `client.ts` documents (see below).

## Boundaries: real vs. simulated

| Boundary | Real or simulated | Detail |
|---|---|---|
| Vapi webhook signature verification | Out of scope | Assumed already done by the caller; pure request auth, not orchestration |
| `resolveChannelRoutingMode()` routing-mode decision logic | **Real** | Actual exported function is called |
| Supabase read inside `resolveChannelRoutingMode()` | Simulated | Fixed delay in place of the network round trip (see below) |
| `resolveTrustedAgentRoute()` / `resolveSpecialistRoute()` matching logic | **Real** | Actual exported function is called |
| Supabase read inside `resolveSpecialistRoute()` | Simulated | Fixed delay in place of the network round trip |
| `checkChannelModelInvocationCeiling()` + `PartnerBudget` accounting | **Real** | In-memory, no I/O to simulate |
| `invokeInternalSpecialist()` / `invokeAgent()` gateway logic (identity copying, trace/idempotency id generation) | **Real** | Actual exported function is called |
| The specialist's own LLM call (inside `runAgent()`) | Simulated | `run-agent.ts` is mocked at its module boundary (same technique as `tests/agent-invocation-gateway.test.ts` and `tests/agent-voice-latency-policy.test.ts`); a fixed delay stands in for model inference |
| `executeAction()` dispatch to the `xkedule_check_availability` case | **Real** | Actual exported function and case branch run |
| `getXkeduleCredentialsForOrg()` DB read | Simulated | Fixed delay in place of the network round trip (credentials themselves are mocked to avoid unrelated `crypto.ts` decrypt setup) |
| `checkXkeduleAvailability()` / `xkeduleFetchJson()` / `xkeduleFetch()` request-building logic | **Real** | Actual exported functions run; only the underlying `fetch()` call is intercepted |
| The Xkedule vendor HTTP call itself | Simulated | Fixed delay + canned JSON in place of the real network call |

Everything in the "Real" rows is the actual production TypeScript running
in-process, imported from `src/`, unmodified. Nothing in this test mocks
`resolveChannelRoutingMode`, `resolveTrustedAgentRoute`,
`resolveSpecialistRoute`, `invokeInternalSpecialist`, `invokeAgent`,
`checkChannelModelInvocationCeiling`, `executeAction`, or the Xkedule client
functions themselves — only their outermost I/O primitives (`fetch`,
Supabase's `.maybeSingle()`, one credentials lookup) are replaced.

## Injected latency figures and their source

Every fixed delay below is either a documented measurement already sitting in
this codebase, or an explicitly labeled assumption. None is presented as a
live benchmark.

| Delay | Value | Source / rationale |
|---|---|---|
| Supabase point-lookup round trip (used 3×: routing mode, specialist route, Xkedule credentials) | 30 ms | **Assumption.** A single-row, indexed `.eq().maybeSingle()` query against a co-located Postgres instance (Supabase, same region as the app runtime) is commonly in the tens-of-milliseconds range once connection pooling is warm. No live measurement was taken for this profile; 30 ms is a round, conservative mid-point for that class of query, not a benchmark result. |
| Specialist LLM turn (inside the mocked `runAgent()`) | 900 ms | **Assumption.** Stands in for a short, few-sentence voice-turn completion from a fast hosted model via OpenRouter (the platform's only provider — see `run-agent.ts` header). This is not sourced from a live call; it is a representative mid-range figure for "time to first token through a short completion" on a small/fast model, chosen because it is neither an unrealistically instant 0 ms nor the multi-second tail some larger models show. Treat it as a placeholder for real model telemetry, not a claim about actual OpenRouter latency. |
| Xkedule availability lookup (the `fetch()` call inside `xkeduleFetchJson`) | 300 ms | **Assumption, explicitly NOT the number documented in `client.ts`.** `src/lib/xkedule/client.ts` documents a *measured* 5.1s cold-cache availability computation against the live demo tenant — that is a real number, but it describes the pathological case that justified the client's 15s timeout, not the "simple lookup" scenario this profile is named after. Using 5.1s here would overstate the typical case; using 300 ms instead represents a warm-cache/typical external API round trip and is labeled as an assumption, not a measurement. |

Sum of injected delays per turn: 3 × 30 ms + 900 ms + 300 ms = **1,290 ms**.
The remaining, unsimulated orchestration code (routing decisions, guardrail
checks, object construction, JSON handling) is real in-process JavaScript and
contributes low-single-digit milliseconds on top of that — the test measures
this combined total, not the injected sum in isolation.

## Iterations and p95 computation

- **Iteration count: 50.** Each iteration runs one full simulated turn
  (steps 2-6 above) independently — a fresh `PartnerBudget`, a fresh set of
  mock call sequences, no shared mutable state across iterations.
- Iterations run **concurrently** (`Promise.all`), each timed independently
  with `Date.now()` immediately before step 2 and immediately after step 6
  resolves. Running concurrently keeps the suite fast enough for a CI gate —
  50 iterations at a simulated ~1.3s each would take over a minute run
  serially, but the injected delays are `setTimeout`-based and non-blocking,
  so running them concurrently does not change any individual iteration's
  measured duration, only the wall-clock time of the whole test file.
- **p95 definition (nearest-rank method):** sort the 50 durations ascending,
  then take the value at index `Math.ceil(0.95 * N) - 1` (0-based). For
  `N = 50` that is index 47 (the 48th-smallest value). This is the same
  method the test implements — the test is the executable definition of this
  formula, not a second, independent one.
- The test asserts `p95 < 5000` (ms) and fails with the measured p95 value in
  the assertion message when it is not, so a regression tells the reader how
  far off it was rather than only whether a boolean passed.

## Target and hardware assumption

- **Target: p95 < 5,000 ms**, per TEST-03 / `135-CONTEXT.md`.
- **Hardware assumption: none, deliberately.** This test makes no claim about
  a specific CPU class or CI runner tier. Because the dominant cost per
  iteration is fixed `setTimeout` delays (1,290 ms of the ~1.3s+ total) and
  not CPU-bound work, the result is expected to be stable across ordinary
  developer laptops and CI runners alike — the injected delays swamp normal
  machine-to-machine variance in this orchestration code's own execution
  time. This is precisely why the target (5,000 ms) carries a large margin
  over the expected measured figure (~1.3-1.5s): the margin exists to absorb
  real machine variance in the *unsimulated* portion of the code, not to make
  the assertion trivially true regardless of regressions — an orchestration
  bug that added even one more accidental DB round trip or LLM call inside
  the loop would move the measured figure by hundreds of milliseconds to
  nearly a full second, well outside normal noise.

## When this profile stops being honest

If a future change makes this test assert against a number closer to
"whatever the code currently produces" rather than the fixed table above, or
if a future change swaps a "Real" row in the boundary table for a mock
without updating this document, the profile has drifted from what the test
actually does and must be corrected before the p95 claim is trusted again.
