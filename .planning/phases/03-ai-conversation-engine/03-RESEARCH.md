# Phase 3: AI Conversation Engine - Research

**Researched:** 2026-04-04
**Domain:** Streaming AI responses with tool calls over a custom SSE protocol
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** Use `fetch + ReadableStream` on the POST route — keep POST semantics. No EventSource.

**D-02:** Stream format: plain JSON-encoded SSE events, newline-delimited. Three event types:
- `{"event":"session","sessionId":"<uuid>"}` — emitted once at start of stream before any tokens
- `{"event":"token","text":"<chunk>"}` — one per streamed token
- `{"event":"done"}` — signals stream complete
- `{"event":"tool_call","name":"<action_type>"}` — optional, when model calls a tool mid-stream

**D-03:** Response content type: `text/event-stream` with `Cache-Control: no-cache`.

**D-04:** Route changes from `Response.json(...)` to `Response` with `ReadableStream` body. Existing tests for stub behavior must be updated for streaming shape.

**D-05:** Full tool call integration in Phase 3 (CHAT-03 fully satisfied here, not deferred).

**D-06:** Fetch org's active `tool_configs` rows at request start. Expose each as an LLM tool definition. LLM decides whether to call a tool.

**D-07:** Tool call flow: stream tokens → model signals tool call → emit `tool_call` SSE event → run `executeAction()` → inject result into conversation → model continues streaming final answer.

**D-08:** Knowledge base retrieval (`queryKnowledge`) is wired as a tool OR as pre-retrieval context injection — researcher determines which fits the streaming pattern better (see "Claude's Discretion" below).

**D-09:** Default system prompt: `"You are a helpful assistant for {org.name}. Answer questions accurately and concisely using the provided context. If you don't know the answer, say so."`

**D-10:** No system_prompt column added to DB in this phase. Phase 5 owns that schema change.

**D-11:** Per-org API key routing via `getProviderKey()`:
- Try OpenRouter first → model: `anthropic/claude-haiku-4-5`
- Fall back to Anthropic SDK → model: `claude-3-5-haiku-20241022`

**D-12:** If no API keys configured: stream graceful degradation message as single token event, then emit `done`. No HTTP error, no 500.

**D-13:** No new environment variables. All provider credentials from existing integrations table.

**D-14:** Pass last 10 messages from `ChatSessionContext.messages[]` to LLM. Older messages remain in Supabase for audit.

**D-15:** After stream completes, store both turns: append assistant reply to context and call `setSession()` (Redis) + call `persistMessage()` for assistant reply via `after()`.

**D-16:** Assistant reply text accumulated from streamed tokens; persistence happens post-stream via `after()`.

### Claude's Discretion

- Exact Anthropic SDK streaming API (`.stream()` vs `.messages.create()` with `stream: true`) — researcher confirms
- Whether knowledge base retrieval happens as pre-retrieval context injection (RAG before LLM call) or as LLM tool call — researcher determines which fits the streaming pattern better
- Error handling granularity within the stream (e.g., tool call failures)
- Token accumulation strategy for building the full reply text before persistence

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CHAT-01 | Visitor can send messages and receive streamed AI responses in real time (SSE) | D-01 through D-04: ReadableStream + plain JSON SSE protocol. Anthropic SDK `.messages.stream()` / OpenAI SDK `stream: true` deliver incremental token events. |
| CHAT-02 | AI responses draw from the org's knowledge base (LangChain SupabaseVectorStore) | `queryKnowledge()` already implemented. Research determines pre-retrieval injection is the correct pattern (see Architecture Patterns). KB results injected as user-turn context before LLM call. |
| CHAT-03 | AI can call org tools during conversation (action engine `executeAction`) | D-05 through D-07: `tool_configs` loaded at request start, exposed as LLM tool definitions. `executeAction()` called on model tool_use event. Multi-turn conversation assembled and re-streamed for final answer. |
</phase_requirements>

---

## Summary

Phase 3 replaces the stub response at step 7 of `src/app/api/chat/[token]/route.ts` with a real streaming AI engine. All scaffolding is already in place from Phases 1-2: auth, session management, persistence helpers, provider key retrieval, knowledge query, and action execution are all implemented and tested. The work here is wiring these pieces together behind a `ReadableStream` response using the project's custom JSON-over-SSE protocol.

The two SDKs already installed (`@anthropic-ai/sdk@0.82.0` and `openai@6.33.0`) both support streaming. For the Anthropic path the `.messages.stream()` helper is the correct API — it returns a `MessageStream` that emits typed events and handles the async iterator cleanly. For the OpenRouter path the OpenAI SDK `chat.completions.create({ stream: true })` returns an async iterable of `ChatCompletionChunk` objects. Both paths write to the same `ReadableStream` controller via a shared helper that emits the project's three event types.

Knowledge base retrieval is best handled as **pre-retrieval context injection** (RAG before the LLM call) rather than as an LLM-callable tool. The existing `queryKnowledge()` function already synthesizes an answer non-streamingly; injecting that result as an additional user context block before calling the LLM avoids a blocking tool round-trip inside the stream, keeps token flow continuous, and does not require a second LLM call mid-stream. The `knowledge_base` action_type in `executeAction` is already wired for Vapi tool calls — it remains available for programmatic tool invocations, but is not exposed as an LLM tool in the chat route. The other `tool_configs` action types (`create_contact`, `get_availability`, `create_appointment`) are exposed as LLM tools and require a multi-turn loop when the model picks one.

**Primary recommendation:** Use `client.messages.stream()` (Anthropic path) and `client.chat.completions.create({ stream: true })` (OpenRouter path). Inject KB context before the first LLM call. Implement a multi-turn loop only for non-KB tool calls. Accumulate tokens in a string buffer for post-stream persistence.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/sdk` | 0.82.0 (installed) | Anthropic streaming (`.messages.stream()`) | Already in project; provides `MessageStream` with typed events |
| `openai` | 6.33.0 (installed) | OpenRouter-compatible streaming | Already in project; OpenRouter uses OpenAI wire format |

### Supporting

No additional packages required. D-13 confirms no new env vars or packages.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom SSE JSON protocol | Vercel AI SDK wire format | AI SDK adds `ai` package dependency; Phase 4 widget would need AI SDK client. Custom protocol is lighter and already decided (D-02). |
| Pre-retrieval KB injection | KB as LLM tool | KB-as-tool requires a blocking tool round-trip inside the stream; pre-retrieval is faster and simpler. |
| `.messages.stream()` | `.messages.create({ stream: true })` | `.messages.create({ stream: true })` returns a raw `Stream<RawMessageStreamEvent>` — you must handle the async iterator manually and reassemble tool_use input JSON. `.messages.stream()` returns a `MessageStream` that buffers input JSON automatically and emits higher-level events. Use `.messages.stream()`. |

**Installation:** No new packages needed.

**Version verification:** Confirmed from `node_modules` — `@anthropic-ai/sdk@0.82.0`, `openai@6.33.0`. Both current as of research date.

---

## Architecture Patterns

### Recommended Project Structure

No new files except the updated route and stream helper:

```
src/
  app/api/chat/[token]/
    route.ts          # Modified: step 7 replaced with streaming logic
  lib/chat/
    session.ts        # Unchanged
    persist.ts        # Unchanged
    stream.ts         # NEW: shared ReadableStream builder + SSE serializer
```

The `stream.ts` helper isolates the SSE encoding and the provider-switch logic, keeping `route.ts` readable.

### Pattern 1: ReadableStream + WritableStream controller

**What:** Return a `Response` with a `ReadableStream` body. Use a `TransformStream` or `ReadableStream` constructor with enqueue callbacks to push JSON-encoded event lines.

**When to use:** All streaming responses in Node.js runtime routes.

**Example:**
```typescript
// Source: MDN ReadableStream + Node.js docs
const stream = new ReadableStream({
  async start(controller) {
    const enc = new TextEncoder()
    const emit = (obj: object) =>
      controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'))

    // Emit session event first (D-02)
    emit({ event: 'session', sessionId })

    // ... stream tokens ...

    emit({ event: 'done' })
    controller.close()
  },
})

return new Response(stream, {
  headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
  },
})
```

### Pattern 2: Anthropic SDK `.messages.stream()` — correct streaming API

**What:** `client.messages.stream(params)` returns a `MessageStream`. Iterate with `for await (const event of stream)` or use `stream.on('text', ...)`. The `MessageStream` buffers `input_json` deltas and emits complete tool_use blocks.

**When to use:** Anthropic path (D-11).

```typescript
// Source: @anthropic-ai/sdk 0.82.0 types — messages.d.ts line 74
// stream<Params extends MessageStreamParams>(body, options?): MessageStream

const anthropic = new Anthropic({ apiKey })
const msgStream = anthropic.messages.stream({
  model: 'claude-3-5-haiku-20241022',
  max_tokens: 1024,
  system: systemPrompt,
  messages: history,
  tools: toolDefinitions,
})

for await (const event of msgStream) {
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    // token chunk
    emit({ event: 'token', text: event.delta.text })
    accumulatedText += event.delta.text
  }
  if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
    // tool call detected — handled on content_block_stop when input is complete
  }
}

const finalMessage = await msgStream.finalMessage()
// finalMessage.stop_reason === 'tool_use' → process tool calls
```

### Pattern 3: OpenRouter path — OpenAI SDK stream

**What:** `client.chat.completions.create({ stream: true })` returns an `AsyncIterable<ChatCompletionChunk>`. Detect tool calls via `finish_reason === 'tool_calls'` or delta `tool_calls` array.

**When to use:** OpenRouter path (D-11 first preference).

```typescript
// Source: openai@6.33.0 — resources/chat/completions/completions.d.ts
const openrouter = new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1' })
const completion = await openrouter.chat.completions.create({
  model: 'anthropic/claude-haiku-4-5',
  stream: true,
  messages: openaiHistory,
  tools: openaiToolDefinitions,
})

for await (const chunk of completion) {
  const delta = chunk.choices[0]?.delta
  if (delta?.content) {
    emit({ event: 'token', text: delta.content })
    accumulatedText += delta.content
  }
  if (chunk.choices[0]?.finish_reason === 'tool_calls') {
    // tool call — delta.tool_calls array carries name + accumulated arguments
  }
}
```

### Pattern 4: Pre-retrieval KB injection (CHAT-02 resolution)

**What:** Call `queryKnowledge()` before the LLM call. If results are returned, prepend a context block to the message history as a system-level or user-turn message.

**Why:** Avoids blocking tool round-trip mid-stream. `queryKnowledge()` already synthesizes an answer; inject raw document snippets (or the synthesized answer) as context, then let the LLM incorporate them. Keeps token stream continuous.

```typescript
// Pre-retrieval context injection (before stream construction)
let kbContext = ''
const kbResult = await queryKnowledge(message, org.id, supabase)
if (kbResult !== "I don't have information about that in my knowledge base.") {
  kbContext = `\n\nRelevant knowledge base content:\n${kbResult}`
}

const systemPromptWithKB = `You are a helpful assistant for ${org.name}. Answer questions accurately and concisely using the provided context. If you don't know the answer, say so.${kbContext}`
```

### Pattern 5: Multi-turn tool call loop

**What:** When the model stops with `stop_reason: 'tool_use'` (Anthropic) or `finish_reason: 'tool_calls'` (OpenAI), execute the tool, append the tool result, and re-call the model to get the final answer (which is then streamed to the client).

**When to use:** Non-KB tool calls from `tool_configs` (CHAT-03).

```typescript
// On tool_use stop:
emit({ event: 'tool_call', name: toolUseBlock.name })

const toolResult = await executeAction(
  toolConfig.action_type,
  toolUseBlock.input,
  credentials,
  { organizationId: org.id, supabase }
)

// Append tool result to message history and re-stream
// The second LLM call streams the final answer
```

### Pattern 6: Post-stream persistence via `after()`

**What:** Accumulate token text in a buffer during the stream. After `controller.close()`, schedule persistence via `after()`. This mirrors the existing pattern used for user messages in Phase 2.

```typescript
// Accumulated outside the ReadableStream start() callback scope
let accumulatedReply = ''

// Inside token loop:
accumulatedText += chunk

// After stream ends, call after() for persistence (D-15, D-16)
after(async () => {
  ctx.messages.push({ role: 'assistant', content: accumulatedReply })
  ctx.lastActiveAt = new Date().toISOString()
  await setSession(sessionId, ctx)
  await persistMessage({ dbSessionId: ctx.dbSessionId, orgId: ctx.orgId, role: 'assistant', content: accumulatedReply })
})
```

**Note:** `after()` is called from the route handler scope before returning the `Response`, so the `after()` callback fires after the response stream finishes. The `accumulatedReply` must be in a closure shared between the stream `start()` callback and the `after()` call.

### Anti-Patterns to Avoid

- **Calling `after()` from inside `ReadableStream.start()`:** `after()` must be registered from the route handler scope (before `return new Response(...)`), not inside the stream's async generator. The stream `start()` is not in the request handler's async context.
- **Using EventSource on the client:** EventSource does not support POST bodies. Decided against (D-01). Widget will use `fetch` with a `ReadableStream` reader.
- **Blocking on KB lookup inside the stream:** Pre-retrieve before opening the stream. A blocking async call inside `start()` delays first token delivery.
- **Exposing `knowledge_base` as an LLM tool in the chat route:** This would cause a second synthesis LLM call mid-stream. Pre-retrieval injection is the correct pattern.
- **Forgetting to flush `ReadableStream` on tool call pause:** When the model stops for a tool call, the first stream ends. Tokens must be flushed before pausing; the second stream (after tool result) continues from the same `controller`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Streaming token delivery | Custom WebSocket server | `ReadableStream` in Node.js route | Native to Web platform; works in Vercel Hobby |
| Tool input JSON assembly | Manual delta stitching | `.messages.stream()` `MessageStream` | SDK buffers `input_json` deltas internally |
| OpenRouter token streaming | Manual `fetch` + `text()` parsing | `openai` SDK `stream: true` | SDK handles chunked transfer and delta parsing |
| Provider fallback logic | Custom try/catch chain | Reuse `getProviderKey()` pattern already in project | Same pattern as `queryKnowledge()` |

**Key insight:** Both streaming APIs (Anthropic and OpenRouter/OpenAI) are already installed and tested in the project. The implementation is primarily wiring, not building.

---

## Common Pitfalls

### Pitfall 1: `after()` not firing after streaming responses

**What goes wrong:** `after()` is a Next.js primitive that schedules work after the response is committed. With streaming responses (`ReadableStream`), `after()` fires after the stream is fully consumed by the client, not after `controller.close()` — but only if registered in the route handler scope before the `return new Response(...)`.

**Why it happens:** The stream's `start()` callback runs asynchronously. If `after()` is called inside `start()`, it may not be in the correct request context.

**How to avoid:** Register `after()` in the route handler body (same level as the `return`), referencing a `let accumulatedReply = ''` closure variable that gets populated as the stream runs.

**Warning signs:** Persistence not happening, Redis session not updated after stream completes.

### Pitfall 2: Tool call input JSON is fragmented in raw streaming events

**What goes wrong:** With `.messages.create({ stream: true })` (raw stream), `input_json` deltas arrive as partial JSON strings. Manually stitching them is error-prone.

**Why it happens:** Anthropic streams tool input character by character as `InputJSONDelta` events.

**How to avoid:** Use `.messages.stream()` which buffers the JSON deltas and emits a complete `ToolUseBlock` only at `content_block_stop`.

**Warning signs:** JSON parse errors when trying to read tool call arguments mid-stream.

### Pitfall 3: `accumulatedReply` closure not accessible after `ReadableStream` closes

**What goes wrong:** `let accumulatedReply = ''` declared inside the `ReadableStream` `start()` callback is not accessible from the `after()` call registered outside.

**How to avoid:** Declare `let accumulatedReply = ''` in the route handler scope (before stream construction). The stream `start()` closes over it.

### Pitfall 4: OpenRouter tool call arguments arrive as partial JSON in streaming chunks

**What goes wrong:** OpenAI-compatible streaming sends `delta.tool_calls[0].function.arguments` as incremental JSON fragments.

**How to avoid:** Accumulate `arguments` strings across chunks, then `JSON.parse()` the final accumulated string when `finish_reason === 'tool_calls'`.

### Pitfall 5: Vitest cannot test streaming `ReadableStream` responses without adaptation

**What goes wrong:** Existing tests call `await res.json()` — this fails on a `ReadableStream` response.

**Why it happens:** The stub response was `Response.json(...)`. After Phase 3, the response body is a stream.

**How to avoid:** Tests that cover the streaming path need a helper to collect SSE lines. Tests that cover the non-streaming error paths (401, 400) remain unchanged. Update the "200 with sessionId" tests to use a stream reader.

### Pitfall 6: `tool_configs` has RLS — use service-role client

**What goes wrong:** Reading `tool_configs` with an authenticated client while the org is identified only by widget token (no user session) returns no rows.

**Why it happens:** `tool_configs` RLS is scoped to authenticated role via `get_current_org_id()`.

**How to avoid:** Use `createServiceRoleClient()` for the `tool_configs` query (same client already used for `organizations` lookup in this route). This is called out explicitly in `03-CONTEXT.md` under canonical refs.

### Pitfall 7: `tool_configs` `integration_id` must be joined to get credentials for `executeAction`

**What goes wrong:** `tool_configs` stores `integration_id` but `executeAction` needs a `GhlCredentials` object. A bare `tool_configs` select is insufficient.

**Why it happens:** `executeAction` for GHL actions needs `location_id` and the decrypted API key from `integrations`.

**How to avoid:** When fetching `tool_configs`, join `integrations` table and call `getProviderKey()` to decrypt the API key. Store credentials per integration_id in a map before entering the stream.

---

## Code Examples

Verified patterns from installed SDKs:

### Anthropic `.messages.stream()` — event loop
```typescript
// Source: @anthropic-ai/sdk 0.82.0 — resources/messages/messages.d.ts line 74
// stream<Params extends MessageStreamParams>(body: Params, options?): MessageStream

const msgStream = client.messages.stream({
  model: 'claude-3-5-haiku-20241022',
  max_tokens: 1024,
  system: systemPrompt,
  messages: anthropicHistory,
  tools: anthropicTools,
})

for await (const event of msgStream) {
  switch (event.type) {
    case 'content_block_delta':
      if (event.delta.type === 'text_delta') {
        enqueue({ event: 'token', text: event.delta.text })
        accumulatedReply += event.delta.text
      }
      break
    case 'content_block_start':
      if (event.content_block.type === 'tool_use') {
        enqueue({ event: 'tool_call', name: event.content_block.name })
      }
      break
  }
}
const finalMsg = await msgStream.finalMessage()
// finalMsg.stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | ...
```

### OpenAI SDK streaming over OpenRouter
```typescript
// Source: openai@6.33.0 — resources/chat/completions/completions.d.ts
// create(body: ChatCompletionCreateParamsStreaming, options?): APIPromise<Stream<ChatCompletionChunk>>

const completion = await client.chat.completions.create({
  model: 'anthropic/claude-haiku-4-5',
  stream: true,
  messages: openaiHistory,
  tools: openaiTools,
})

let toolCallName = ''
let toolCallArguments = ''

for await (const chunk of completion) {
  const delta = chunk.choices[0]?.delta
  if (delta?.content) {
    enqueue({ event: 'token', text: delta.content })
    accumulatedReply += delta.content
  }
  if (delta?.tool_calls?.[0]) {
    const tc = delta.tool_calls[0]
    if (tc.function?.name) toolCallName = tc.function.name
    if (tc.function?.arguments) toolCallArguments += tc.function.arguments
  }
  if (chunk.choices[0]?.finish_reason === 'tool_calls') {
    enqueue({ event: 'tool_call', name: toolCallName })
    // parse toolCallArguments, call executeAction, re-send with tool result
  }
}
```

### SSE encoder helper
```typescript
// Proposed pattern for src/lib/chat/stream.ts
export function createSseEncoder() {
  const encoder = new TextEncoder()
  return (obj: object) => encoder.encode(JSON.stringify(obj) + '\n')
}
```

### Tool definition shape for Anthropic
```typescript
// Source: @anthropic-ai/sdk Tool interface — name, description, input_schema
const anthropicTools: Anthropic.Tool[] = toolConfigs.map(tc => ({
  name: tc.tool_name,
  description: tc.config?.description as string ?? tc.tool_name,
  input_schema: {
    type: 'object' as const,
    properties: tc.config?.parameters as object ?? {},
    required: (tc.config?.required as string[]) ?? [],
  },
}))
```

### Tool definition shape for OpenRouter (OpenAI format)
```typescript
// Source: openai@6.33.0 ChatCompletionTool
const openaiTools: OpenAI.ChatCompletionTool[] = toolConfigs.map(tc => ({
  type: 'function' as const,
  function: {
    name: tc.tool_name,
    description: tc.config?.description as string ?? tc.tool_name,
    parameters: {
      type: 'object',
      properties: tc.config?.parameters as object ?? {},
      required: (tc.config?.required as string[]) ?? [],
    },
  },
}))
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SSE via EventSource | `fetch + ReadableStream` for POST bodies | Project decision D-01 | Allows POST body with session + message; EventSource is GET-only |
| Vercel AI SDK wire format | Custom plain JSON SSE protocol | Project decision D-02 | No `ai` package needed; simpler widget-side parser |
| Blocking LLM call (`await messages.create(...)`) | Streaming (`messages.stream()` / `stream: true`) | Phase 3 | First token arrives before full completion; satisfies CHAT-01 |

**Deprecated/outdated:**
- `.messages.create({ stream: true })` returning raw `Stream<RawMessageStreamEvent>`: still works but forces manual input_json delta stitching. Superseded by `.messages.stream()` which provides `MessageStream` with complete tool_use blocks.

---

## Open Questions

1. **`tool_configs.config` JSONB schema for tool parameters**
   - What we know: `tool_configs.config` is `JSONB DEFAULT '{}'`; it stores tool configuration. The action_engine uses it but the column structure is not enforced by schema.
   - What's unclear: Whether existing `tool_configs` rows already store OpenAI-compatible `parameters`/`required` fields, or whether the chat route should define a minimal fixed schema per action_type.
   - Recommendation: Define a minimal fixed tool schema per action_type directly in the route (hardcode parameter shapes for `create_contact`, `get_availability`, `create_appointment`). This avoids a schema column dependency and is safe for Phase 3 scope.

2. **Multi-turn streaming: single stream vs two stream calls**
   - What we know: When the model calls a tool, it must stop, execute, and re-call the LLM. The second LLM call also streams.
   - What's unclear: Whether to send all tokens through a single `ReadableStream` controller (stream stays open across both LLM calls) or close and re-open.
   - Recommendation: Keep a single `ReadableStream` controller open across both LLM calls. The controller is not closed until after the final answer streams through. This is the correct approach for the chosen protocol.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|---------|
| `@anthropic-ai/sdk` | Anthropic streaming path | Yes | 0.82.0 | — |
| `openai` | OpenRouter streaming path | Yes | 6.33.0 | — |
| Redis | Session read/write | Yes (Phase 1 confirmed) | node-redis 5.x | Graceful no-op (already guarded in session.ts) |
| Supabase service role | `tool_configs` query + persistence | Yes (Phase 1-2 confirmed) | — | — |

All dependencies available. No blocking gaps.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `npx vitest run tests/chat-api.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CHAT-01 | Stream response begins before full answer (first line is `{"event":"session",...}`) | unit | `npx vitest run tests/chat-api.test.ts` | Exists (needs update) |
| CHAT-01 | Response Content-Type is `text/event-stream` | unit | `npx vitest run tests/chat-api.test.ts` | Exists (needs update) |
| CHAT-01 | Stream contains `{"event":"token",...}` lines | unit | `npx vitest run tests/chat-api.test.ts` | Exists (needs update) |
| CHAT-01 | Stream ends with `{"event":"done"}` | unit | `npx vitest run tests/chat-api.test.ts` | Exists (needs update) |
| CHAT-02 | When org has OpenAI key, `queryKnowledge` is called before LLM | unit | `npx vitest run tests/chat-api.test.ts` | Exists (needs update) |
| CHAT-03 | When model returns tool_use, `executeAction` is called | unit | `npx vitest run tests/chat-api.test.ts` | Exists (needs update) |
| CHAT-03 | `{"event":"tool_call","name":"..."}` SSE event emitted mid-stream | unit | `npx vitest run tests/chat-api.test.ts` | Exists (needs update) |
| D-12 | No API keys → stream single token with degradation message, then done | unit | `npx vitest run tests/chat-api.test.ts` | Exists (needs update) |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/chat-api.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

The test file `tests/chat-api.test.ts` exists with 5 tests covering the stub behavior. All 5 tests must be updated in Wave 0 (before implementation) because the response shape changes fundamentally from `Response.json(...)` to `ReadableStream`:

- [ ] `tests/chat-api.test.ts` — update "returns 200 with sessionId" test to read stream lines (not `res.json()`) and assert SSE event sequence
- [ ] `tests/chat-api.test.ts` — add streaming CHAT-01 test: assert `Content-Type: text/event-stream`, session event, token events, done event
- [ ] `tests/chat-api.test.ts` — add CHAT-02 test: mock `queryKnowledge`, assert called before LLM mock
- [ ] `tests/chat-api.test.ts` — add CHAT-03 test: mock LLM to return tool_use, assert `executeAction` called and tool_call SSE event emitted
- [ ] `tests/chat-api.test.ts` — add D-12 degradation test: no API keys → stream contains degradation message

A test helper for reading SSE lines from a `ReadableStream` response will be needed — add to the test file or a shared `tests/helpers/stream.ts`.

---

## Project Constraints (from CLAUDE.md)

- `export const runtime = 'nodejs'` required on the route — stays unchanged
- Always use `createServiceRoleClient()` for public API writes — already applied in route, extend to `tool_configs` query
- Vapi webhook routes always return HTTP 200 — does NOT apply to chat route (returns 401 for invalid token per existing route)
- `after()` for fire-and-forget persistence — extend to assistant reply (D-15, D-16)
- `npm run build` after changes to catch type errors — mandatory before finishing
- No `any` types — TypeScript strict; all SDK event types must be properly narrowed
- `src/lib/crypto.ts` — do not touch; `getProviderKey()` handles decryption
- `supabase/migrations/` — no new migration needed for Phase 3

---

## Sources

### Primary (HIGH confidence)
- `@anthropic-ai/sdk` installed source — `resources/messages/messages.d.ts` (line 74: `.stream()` method), `lib/MessageStream.d.ts` — streaming API shape
- `openai` installed source — `resources/chat/completions/completions.d.ts` (lines 456, 492: `finish_reason === 'tool_calls'`, `delta.tool_calls`) — OpenRouter streaming shape
- Project source code — `src/app/api/chat/[token]/route.ts`, `src/lib/knowledge/query-knowledge.ts`, `src/lib/action-engine/execute-action.ts`, `src/lib/chat/session.ts`, `src/lib/chat/persist.ts`, `src/lib/integrations/get-provider-key.ts` — all verified directly
- `supabase/migrations/002_action_engine.sql` — `tool_configs` schema with `integration_id`, `tool_name`, `action_type`, `config` JSONB
- `03-CONTEXT.md` — all locked decisions read verbatim

### Secondary (MEDIUM confidence)
- `C:\Users\Vanildo\Dev\chatbot\app\(chat)\api\chat\route.ts` — reference for streaming pattern (Vercel AI SDK). Confirmed: Leaidear uses plain SSE, not AI SDK wire format. Reference only for async structure.
- MDN `ReadableStream` API — standard Web platform; applies to Node.js 18+ and Next.js App Router Node.js runtime

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — SDKs verified by direct inspection of installed node_modules
- Architecture: HIGH — all patterns derived from existing project code + SDK type definitions
- Pitfalls: HIGH — derived from code inspection (RLS pattern, `after()` scope, streaming delta stitching)
- Test map: HIGH — test file confirmed to exist and current shape understood

**Research date:** 2026-04-04
**Valid until:** 2026-05-04 (SDK APIs stable; custom protocol is project-owned)
