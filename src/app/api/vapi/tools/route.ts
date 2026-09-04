// src/app/api/vapi/tools/route.ts
// Node.js Route Handler | receives Vapi tool-call webhooks during live calls.
// Vercel Hobby-friendly: no Edge Runtime dependency, but still must respond fast.
// MUST always return HTTP 200.
//
// Phase 133 Plan 03 (SAFE-02, OBS-03, PERF-02, PERF-03):
//   - Side-effecting tool calls are guarded by the ingress-scoped idempotency
//     key from src/lib/agent-runtime/idempotency.ts, keyed on the trusted
//     call.id + toolCall.id from the ALREADY-VERIFIED webhook payload — never
//     on tool arguments or model output. Reads never pay for the guard.
//   - Every tool call in a multi-call payload gets its own result with a
//     matching toolCallId; one call's failure never suppresses the others.
//   - A timeout/abort on a side-effecting call records abandoned ownership
//     before the fallback message is returned, so a retry cannot treat the
//     slot as free.
//
// Phase 137 Plan 02 (MESH-02): explicit-intent specialist dispatch.
//   - Gated behind the Phase 134 channel routing mode for this org's 'voice'
//     channel, resolved ONCE per request (never per tool call). An org on
//     'legacy' — every org today, since migration 1293 inserts no rows — runs
//     the exact code that existed before this plan; the routing-mode lookup
//     itself fails closed to 'legacy' on any error, including a broken or
//     unavailable Supabase client, so this merges as a byte-for-byte no-op.
//   - In 'specialist' mode, a READ tool call whose name matches a same-org,
//     voice-allowed specialist's own granted workflow (resolved from tenant
//     configuration — never a hardcoded tool-name table) is dispatched to
//     that specialist through invokeInternalSpecialist(), which shares the
//     Phase 133 channel invocation ceiling (default 1 for voice) — exactly
//     one internal model call for this tool call, never a chained
//     orchestrator-then-specialist pair.
//   - Side-effecting tool calls (requiresIdempotency() === true) are NEVER
//     dispatched to a specialist here: this route's own idempotency guard is
//     keyed on the trusted call.id + toolCall.id specifically to survive a
//     Vapi-level retry, and the agent runtime's own internal tool-idempotency
//     (run-agent.ts) is keyed on its own freshly-created invocation id
//     instead, which does not protect against that retry. Delegating a write
//     through the mesh needs that gap closed first — out of scope here.
//   - An unmatched tool, a specialist that fails/denies/times out, or the
//     lookup itself throwing all fall back to the existing direct Action
//     Engine path below rather than failing the call.

import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { VapiToolCallMessageSchema, getToolArguments, normalizeVapiToolCall, type VapiToolCall } from '@/types/vapi'
import { resolveOrgForCall } from '@/lib/vapi/end-of-call'
import { resolveTool } from '@/lib/action-engine/resolve-tool'
import { executeAction } from '@/lib/action-engine/execute-action'
import { logToolRun } from '@/lib/workflows/log-tool-run'
import { decrypt } from '@/lib/crypto'
import { verifyVapiSecret } from '@/lib/vapi/verify-signature'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createLogger } from '@/lib/obs/logger'
import {
  requiresIdempotency,
  checkIdempotency,
  recordIdempotency,
  recordAbandonedIdempotency,
  deriveIngressIdempotencyKey,
  hashToolArgs,
} from '@/lib/agent-runtime/idempotency'
import { resolveChannelRoutingMode, type ChannelRoutingMode } from '@/lib/agent-runtime/routing-mode'
import { resolveSpecialistForTool } from '@/lib/agent-runtime/resolve-specialist-route'
import { invokeInternalSpecialist } from '@/lib/agent-runtime/invocation-gateway'
import type { Database } from '@/types/database'

export const runtime = 'nodejs'

const obs = createLogger({ route: 'api/vapi/tools' })

const IDEMPOTENCY_CONFLICT_RESULT =
  'That request conflicts with an earlier one from this call. Please repeat the details again.'
const IDEMPOTENCY_ABANDONED_RESULT =
  'I could not confirm the previous attempt completed. Please try again in a moment.'
const IDEMPOTENCY_UNAVAILABLE_RESULT =
  'I could not verify that request right now. Please try again in a moment.'
const INVALID_TOOL_ARGUMENTS_RESULT =
  'I could not read that request. Please repeat the details and try again.'

interface ToolCallResult {
  toolCallId: string
  result: string
}

/** Minimal shape this route needs from message.call — see VapiToolCallMessageSchema. */
interface VapiCallShape {
  id: string
  assistantId: string
  phoneNumberId?: string
  customer?: { number?: string; name?: string }
}

// This route calls executeAction directly and never creates an agent
// invocation, so it has no id to point the nullable agent_invocation_id FK at.
// The helper accepts null for exactly this case — a fabricated id would fail
// the FK or the UUID format check inside the helper's non-fatal error
// handling, which would silently drop the receipt and disable the guard.
const NO_AGENT_INVOCATION = null

// Phase 134 (OBS-01): logToolRun() now also accepts a trace_id
// (src/lib/workflows/log-tool-run.ts, migration 1292). This route has no
// agent invocation and therefore no agent trace to attach either — voice
// calls that go through an entry agent are a separate, not-yet-wired path
// (a later wave). call.id is deliberately NOT reused as the trace here: it
// is stored elsewhere as vapi_call_id in a TEXT column precisely because it
// is not guaranteed UUID-shaped (see the workflow_runs.vapi_call_id
// convention for pseudo-ids like `manychat:<eventId>`), while trace_id is a
// UUID column shared with agent_invocations.trace_id. Passing it here would
// risk failing the insert on a malformed value and silently dropping the
// whole run row, not just the trace linkage.
const NO_AGENT_TRACE = null

export async function POST(request: Request): Promise<Response> {
  const startTime = Date.now()

  // Outer catch: prevents ANY uncaught error from returning non-200 to Vapi
  try {
    if (!verifyVapiSecret(request)) {
      obs.warn('vapi_secret_rejected')
      return Response.json({ results: [] }, { status: 200 })
    }

    // 1. Parse + validate Vapi payload
    let body: unknown
    try {
      body = await request.json()
    } catch {
      // Malformed JSON | Vapi may retry; return empty results (not an error from Vapi's perspective)
      return Response.json({ results: [] }, { status: 200 })
    }

    const parsed = VapiToolCallMessageSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ results: [] }, { status: 200 })
    }

    const { call } = parsed.data.message
    // Vapi sends either the flattened item shape or the nested OpenAI-style one
    // ({id, type, function:{name, arguments:"…"}}) - the latter is what the first
    // real production tool call carried. Normalise once here so nothing downstream
    // has to know which shape arrived.
    const toolCallList = parsed.data.message.toolCallList.map(normalizeVapiToolCall)
    if (!toolCallList || toolCallList.length === 0) {
      return Response.json({ results: [] }, { status: 200 })
    }

    // 2. Create service-role Supabase client (bypasses RLS | no user JWT in Vapi requests)
    const supabase = createServiceRoleClient()

    // 3. Resolve org from the call's assistant AND number | assistant_mappings
    // first (globally unique), then the Vapi-native number, then the legacy
    // per-number assistant override — same resolution used by the end-of-call
    // webhooks so a call and its tool-calls never disagree on which org owns them.
    const { organizationId: orgId } = await resolveOrgForCall(
      { assistantId: call.assistantId, phoneNumberId: call.phoneNumberId },
      supabase,
    )
    if (!orgId) {
      return Response.json({
        results: toolCallList.map((tc) => ({ toolCallId: tc.id, result: 'Service unavailable.' })),
      }, { status: 200 })
    }

    // Phase 137 Plan 02 (MESH-02): resolve the Phase 134 channel routing mode
    // ONCE per request, never per tool call. Fails closed to 'legacy' on any
    // axis of uncertainty, including this lookup itself throwing (e.g. an
    // unavailable Supabase client) — never lets a routing-mode problem turn
    // into a non-200 response or a changed legacy-path result.
    let routingMode: ChannelRoutingMode = 'legacy'
    try {
      routingMode = await resolveChannelRoutingMode({ organizationId: orgId, channel: 'voice' })
    } catch (routingModeErr) {
      obs.error('vapi_routing_mode_lookup_failed', { error: routingModeErr })
    }

    // 4/5/6. Execute every tool call, isolated from each other — one failing
    // call must never suppress or delay the others' results.
    const results = await Promise.all(
      toolCallList.map((toolCall) =>
        executeOneToolCall({ call, toolCall, orgId, supabase, startTime, routingMode })
      )
    )

    // 7. Return to Vapi | always HTTP 200, one result per requested call.
    return Response.json({ results }, { status: 200 })

  } catch (outerErr) {
    // Truly unexpected error | still return 200 so Vapi doesn't go silent
    obs.error('vapi_tools_unexpected_error', { error: outerErr })
    return Response.json({
      results: [{ toolCallId: 'unknown', result: 'Service unavailable.' }]
    }, { status: 200 })
  }
}

function buildSpecialistDispatchMessage(toolName: string, args: Record<string, unknown>): string {
  // Channel-neutral, tenant-agnostic framing: no tool name is hardcoded here,
  // and the arguments are passed through verbatim from the trusted,
  // already-verified Vapi payload. The specialist's own granted workflow
  // (same tool name) is what actually executes the deterministic call.
  return `Explicit voice tool request: ${toolName}\nArguments: ${JSON.stringify(args)}`
}

async function executeOneToolCall(params: {
  call: VapiCallShape
  toolCall: VapiToolCall
  orgId: string
  supabase: SupabaseClient<Database>
  startTime: number
  routingMode: ChannelRoutingMode
}): Promise<ToolCallResult> {
  const { call, toolCall, orgId, supabase, startTime, routingMode } = params

  try {
    // A malformed non-empty argument string is a transport failure, not an
    // empty argument object. Never execute a write with silently discarded
    // fields; keep the response correlated so Vapi can recover in-call.
    let args: Record<string, unknown>
    try {
      args = getToolArguments(toolCall)
    } catch (argumentErr) {
      obs.warn('vapi_tool_arguments_invalid', {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        error: argumentErr,
      })
      return { toolCallId: toolCall.id, result: INVALID_TOOL_ARGUMENTS_RESULT }
    }

    // Resolve tool config (with nested integration credentials)
    const toolConfig = await resolveTool(orgId, toolCall.name, supabase)
    if (!toolConfig) {
      return { toolCallId: toolCall.id, result: 'Tool not configured.' }
    }

    // SAFE-02: guard side-effecting executions only — a read must not pay
    // for the check or be blocked by it.
    const idempotencyNeeded = requiresIdempotency(toolConfig.action_type, toolConfig.config)
    let idempotencyKey = ''
    let requestHash = ''

    if (idempotencyNeeded) {
      // Keyed on the trusted, already-verified call.id + toolCall.id — never
      // on tool arguments or anything the model produced.
      idempotencyKey = deriveIngressIdempotencyKey({
        channel: 'voice',
        externalCallId: call.id,
        externalToolCallId: toolCall.id,
      })
      requestHash = hashToolArgs(args)

      // The preflight is a database read and can fail transiently. It must
      // fail on its own terms: swallowing it into the per-call catch below
      // would turn every side-effecting voice call into a generic "Service
      // unavailable." the moment the lookup blips, masking both success and
      // the tenant's own fallback message. Fail closed — a lookup we could
      // not complete means we do not know whether a prior attempt already
      // mutated the provider, and executing anyway is the double-booking this
      // phase exists to prevent.
      let outcome: Awaited<ReturnType<typeof checkIdempotency>>
      try {
        outcome = await checkIdempotency(orgId, idempotencyKey, requestHash)
      } catch (preflightErr) {
        obs.error('vapi_idempotency_preflight_failed', {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          error: preflightErr,
        })
        return { toolCallId: toolCall.id, result: IDEMPOTENCY_UNAVAILABLE_RESULT }
      }

      if (outcome.status === 'replay') {
        // Cache hit | return the original result without re-executing.
        return { toolCallId: toolCall.id, result: outcome.response }
      }
      if (outcome.status === 'conflict') {
        // Same key, different arguments — never answer with the original
        // response. Distinct message from `abandoned` below.
        return { toolCallId: toolCall.id, result: IDEMPOTENCY_CONFLICT_RESULT }
      }
      if (outcome.status === 'abandoned') {
        // A prior attempt was killed mid-flight with unresolved ownership.
        // Not a free slot (would risk double-executing an in-flight
        // mutation) and not a success.
        return { toolCallId: toolCall.id, result: IDEMPOTENCY_ABANDONED_RESULT }
      }
      // status === 'fresh' — fall through to execute.
    }

    let result: string | undefined
    let status: 'success' | 'error' | 'timeout' = 'success'
    let errorDetail: string | null = null

    // Phase 137 Plan 02 (MESH-02): explicit-intent specialist dispatch.
    // Only attempted for reads — idempotencyNeeded gates the whole branch,
    // see the module header for why side-effecting calls never take this
    // path yet. Any failure (no match, denied/error/aborted/skipped
    // invocation, or the resolver/gateway itself throwing) leaves `result`
    // unset and falls through to the unchanged direct Action Engine path
    // below — this never fails the call.
    if (routingMode === 'specialist' && !idempotencyNeeded) {
      try {
        const specialistRoute = await resolveSpecialistForTool({
          organizationId: orgId,
          channel: 'voice',
          toolName: toolCall.name,
        })

        if (specialistRoute.matched) {
          const envelope = {
            route: {
              orgId,
              agentId: specialistRoute.agentId,
              channel: 'voice' as const,
              externalInteractionId: `voice:${call.id}:${toolCall.id}`,
            },
            input: {
              userMessage: buildSpecialistDispatchMessage(toolCall.name, args),
            },
          }

          // invokeInternalSpecialist() (not invokeAgent()) so this dispatch
          // is counted against the SAME Phase 133 channel invocation ceiling
          // (default 1 for voice) that bounds any further delegation the
          // specialist itself might attempt — exactly one internal model
          // call for this tool call, enforced by existing infrastructure.
          const invocation = await invokeInternalSpecialist(envelope)

          if (invocation.result.status === 'success') {
            result = invocation.result.text
          } else {
            obs.warn('vapi_specialist_dispatch_non_success', {
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              status: invocation.result.status,
              errorDetail: invocation.result.errorDetail,
            })
          }
        }
      } catch (specialistErr) {
        obs.error('vapi_specialist_dispatch_failed', {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          error: specialistErr,
        })
      }
    }

    if (result === undefined) {
      try {
        // Native actions (create_task, knowledge_base, contact_create, ...) carry
        // no integration row — there is nothing to decrypt and executeAction
        // ignores `credentials` for them.
        const integration = toolConfig.integrations
        const credentials = integration
          ? { apiKey: await decrypt(integration.encrypted_api_key), locationId: integration.location_id ?? '' }
          : { apiKey: '', locationId: '' }
        result = await executeAction(toolConfig.action_type, args, credentials, {
          organizationId: orgId,
          supabase,
          toolConfig: toolConfig.config,
          integrationProvider: integration?.provider,
          callerNumber: call.customer?.number,
        })

        if (idempotencyNeeded && idempotencyKey) {
          // The mutation already succeeded. Failing to persist the receipt must
          // not convert that success into the tenant's failure message — the
          // caller would hear an error for work that actually landed, and the
          // real result would be lost. Log it and return the truth.
          try {
            await recordIdempotency({
              organizationId: orgId,
              agentInvocationId: NO_AGENT_INVOCATION,
              idempotencyKey,
              toolName: toolCall.name,
              requestHash,
              response: result,
            })
          } catch (recordErr) {
            obs.error('vapi_idempotency_record_failed', {
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              error: recordErr,
            })
          }
        }
      } catch (err) {
        // GHL executor threw (error, timeout, or unsupported action type)
        const isTimeout = err instanceof Error && err.name === 'AbortError'
        status = isTimeout ? 'timeout' : 'error'
        errorDetail = err instanceof Error ? err.message : String(err)
        result = toolConfig.fallback_message

        // PERF-03: a timeout on a side-effecting action may have left the
        // provider mutation in flight. Record abandoned ownership BEFORE
        // returning the fallback so a later retry sees `abandoned`, not a
        // free slot.
        if (isTimeout && idempotencyNeeded && idempotencyKey) {
          await recordAbandonedIdempotency({
            organizationId: orgId,
            agentInvocationId: NO_AGENT_INVOCATION,
            idempotencyKey,
            toolName: toolCall.name,
            requestHash,
            reason: 'vapi_tool_timeout',
          })
        }
      }
    }

    // Defensive: every branch above assigns `result` before reaching here.
    // This never triggers in practice — it only guards against a future
    // branch that forgets to, so the route can never respond with an
    // undefined tool result.
    if (result === undefined) {
      result = 'Service unavailable.'
    }

    const executionMs = Date.now() - startTime

    // Log execution async | does NOT block Vapi response
    // workflow_runs (kind='tool') via logToolRun — feeds the call-detail
    // timeline and the Workflow logs page (workflow_tool_logs view).
    after(async () => {
      await logToolRun({
        orgId,
        workflowId: toolConfig.workflow_id,
        toolName: toolCall.name,
        triggerType: 'vapi',
        vapiCallId: call.id,
        status,
        executionMs,
        requestPayload: args,
        responsePayload: { result },
        errorDetail,
        traceId: NO_AGENT_TRACE,
        agentInvocationId: NO_AGENT_INVOCATION,
      }, supabase)
    })

    return { toolCallId: toolCall.id, result }
  } catch (err) {
    // Per-call isolation: this call's own unexpected failure must never
    // suppress or drop the results of the other calls in the payload.
    obs.error('vapi_tool_call_failed', { toolCallId: toolCall.id, error: err })
    return { toolCallId: toolCall.id, result: 'Service unavailable.' }
  }
}
