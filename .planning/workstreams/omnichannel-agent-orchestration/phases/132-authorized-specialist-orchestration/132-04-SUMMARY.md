---
phase: 132-authorized-specialist-orchestration
plan: 04
commit: 5351f00c
status: complete
---

# 132-04 - Trusted specialist routing and centralized OpenRouter

## What it changed

Explicit intents resolve to a specialist without a router model call, and all seven inventoried generative call sites moved onto one OpenRouter factory with tenant key first and platform fallback. src/lib/chat/stream/anthropic.ts was deleted outright as orphaned dead code.

## Worth knowing

The drift guard fires on client CONSTRUCTION, not imports, so the three type-only importers do not false-positive; knowledge/embed.ts is the documented embedding exception. Routing was deliberately built as a resolver and not wired into /api/vapi/tools.

## Files

```
.../email-marketing/_actions/generate.ts           |  36 ++--
.../workflows/flows/_actions/ai-build.ts           |  81 +-------
src/app/api/ads/memories/extract/route.ts          |  75 ++++---
src/app/api/email-templates/generate/route.ts      |  35 ++--
src/lib/agent-runtime/invocation-gateway.ts        |  58 ++++++
src/lib/agent-runtime/resolve-specialist-route.ts  | 133 ++++++++++++
src/lib/chat/stream/anthropic.ts                   | 111 ----------
src/lib/copilot/run-turn.ts                        | 143 +------------
src/lib/knowledge/query-knowledge.ts               |  35 ++--
src/lib/llm/openrouter.ts                          |  92 ++++++++
tests/agent-specialist-routing.test.ts             | 231 +++++++++++++++++++++
tests/openrouter-provider-policy.test.ts           | 130 ++++++++++++
```
