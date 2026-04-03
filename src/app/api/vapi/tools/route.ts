// src/app/api/vapi/tools/route.ts
// Edge Function — receives Vapi tool-call webhooks during live calls
// MUST respond within 500ms. MUST always return HTTP 200.

import { after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { VapiToolCallMessageSchema, getToolArguments } from '@/types/vapi'
import { resolveOrg } from '@/lib/action-engine/resolve-org'
import { resolveTool } from '@/lib/action-engine/resolve-tool'
import { executeAction } from '@/lib/action-engine/execute-action'
import { logAction } from '@/lib/action-engine/log-action'
import { decrypt } from '@/lib/crypto'

export const runtime = 'edge'

export async function POST(request: Request): Promise<Response> {
  const startTime = Date.now()

  // Outer catch: prevents ANY uncaught error from returning non-200 to Vapi
  try {
    // 1. Parse + validate Vapi payload
    let body: unknown
    try {
      body = await request.json()
    } catch {
      // Malformed JSON — Vapi may retry; return empty results (not an error from Vapi's perspective)
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

    // 2. Create service-role Supabase client (bypasses RLS — no user JWT in Vapi requests)
    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )

    // 3. Resolve org from assistant ID
    const orgId = await resolveOrg(call.assistantId, supabase)
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
      const apiKey = await decrypt(toolConfig.integrations.encrypted_api_key)
      const credentials = {
        apiKey,
        locationId: toolConfig.integrations.location_id ?? '',
      }
      const args = getToolArguments(toolCall)
      result = await executeAction(toolConfig.action_type, args, credentials, {
        organizationId: orgId,
        supabase,
      })
    } catch (err) {
      // GHL executor threw (error, timeout, or unsupported action type)
      const isTimeout = err instanceof Error && err.name === 'AbortError'
      status = isTimeout ? 'timeout' : 'error'
      errorDetail = err instanceof Error ? err.message : String(err)
      result = toolConfig.fallback_message
    }

    const executionMs = Date.now() - startTime

    // 6. Log execution async — does NOT block Vapi response
    after(async () => {
      await logAction({
        organization_id: orgId,
        tool_config_id: toolConfig.id,
        vapi_call_id: call.id,
        tool_name: toolCall.name,
        status,
        execution_ms: executionMs,
        request_payload: getToolArguments(toolCall) as import('@/types/database').Json,
        response_payload: { result },
        error_detail: errorDetail,
      }, supabase)
    })

    // 7. Return to Vapi — always HTTP 200
    return Response.json({
      results: [{ toolCallId: toolCall.id, result }]
    }, { status: 200 })

  } catch (outerErr) {
    // Truly unexpected error — still return 200 so Vapi doesn't go silent
    console.error('[vapi/tools] Unexpected error:', outerErr)
    return Response.json({
      results: [{ toolCallId: 'unknown', result: 'Service unavailable.' }]
    }, { status: 200 })
  }
}
