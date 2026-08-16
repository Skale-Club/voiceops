// src/app/api/vapi/tools/route.ts
// Node.js Route Handler | receives Vapi tool-call webhooks during live calls.
// Vercel Hobby-friendly: no Edge Runtime dependency, but still must respond fast.
// MUST always return HTTP 200.

import { after } from 'next/server'
import { VapiToolCallMessageSchema, getToolArguments } from '@/types/vapi'
import { resolveOrgForCall } from '@/lib/vapi/end-of-call'
import { resolveTool } from '@/lib/action-engine/resolve-tool'
import { executeAction } from '@/lib/action-engine/execute-action'
import { logToolRun } from '@/lib/workflows/log-tool-run'
import { decrypt } from '@/lib/crypto'
import { verifyVapiSecret } from '@/lib/vapi/verify-signature'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createLogger } from '@/lib/obs/logger'

export const runtime = 'nodejs'

const obs = createLogger({ route: 'api/vapi/tools' })

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

    const { call, toolCallList } = parsed.data.message
    const toolCall = toolCallList[0]
    if (!toolCall) {
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
        results: [{ toolCallId: toolCall.id, result: 'Service unavailable.' }]
      }, { status: 200 })
    }

    // 4. Resolve tool config (with nested integration credentials)
    const toolConfig = await resolveTool(orgId, toolCall.name, supabase)
    if (!toolConfig) {
      return Response.json({
        results: [{ toolCallId: toolCall.id, result: 'Tool not configured.' }]
      }, { status: 200 })
    }

    // 5. Decrypt API key + build credentials
    let result: string
    let status: 'success' | 'error' | 'timeout' = 'success'
    let errorDetail: string | null = null

    try {
      // Native actions (create_task, knowledge_base, contact_create, ...) carry
      // no integration row — there is nothing to decrypt and executeAction
      // ignores `credentials` for them.
      const integration = toolConfig.integrations
      const credentials = integration
        ? { apiKey: await decrypt(integration.encrypted_api_key), locationId: integration.location_id ?? '' }
        : { apiKey: '', locationId: '' }
      const args = getToolArguments(toolCall)
      result = await executeAction(toolConfig.action_type, args, credentials, {
        organizationId: orgId,
        supabase,
        toolConfig: toolConfig.config,
        integrationProvider: integration?.provider,
        callerNumber: call.customer?.number,
      })
    } catch (err) {
      // GHL executor threw (error, timeout, or unsupported action type)
      const isTimeout = err instanceof Error && err.name === 'AbortError'
      status = isTimeout ? 'timeout' : 'error'
      errorDetail = err instanceof Error ? err.message : String(err)
      result = toolConfig.fallback_message
    }

    const executionMs = Date.now() - startTime

    // 6. Log execution async | does NOT block Vapi response
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
        requestPayload: getToolArguments(toolCall),
        responsePayload: { result },
        errorDetail,
      }, supabase)
    })

    // 7. Return to Vapi | always HTTP 200
    return Response.json({
      results: [{ toolCallId: toolCall.id, result }]
    }, { status: 200 })

  } catch (outerErr) {
    // Truly unexpected error | still return 200 so Vapi doesn't go silent
    obs.error('vapi_tools_unexpected_error', { error: outerErr })
    return Response.json({
      results: [{ toolCallId: 'unknown', result: 'Service unavailable.' }]
    }, { status: 200 })
  }
}
