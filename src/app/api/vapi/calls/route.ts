// src/app/api/vapi/calls/route.ts
// Node.js Route Handler — receives Vapi end-of-call-report webhook after a call ends.
// No 500ms constraint — Vapi fires and forgets. Write synchronously, always return 200.

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { VapiEndOfCallMessageSchema } from '@/types/vapi'
import { verifyVapiSecret } from '@/lib/vapi/verify-signature'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  try {
    if (!verifyVapiSecret(request)) {
      console.warn('[vapi/calls] Rejected request with invalid or missing X-Vapi-Secret')
      return new Response(null, { status: 200 })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return new Response(null, { status: 200 })
    }

    const parsed = VapiEndOfCallMessageSchema.safeParse(body)
    if (!parsed.success || parsed.data.message.type !== 'end-of-call-report') {
      return new Response(null, { status: 200 })
    }

    const { call, artifact, analysis, startedAt, endedAt, cost, endedReason } = parsed.data.message

    const vapiCallId = call?.id
    if (!vapiCallId) {
      console.warn('[vapi/calls] Missing call.id in end-of-call payload')
      return new Response(null, { status: 200 })
    }

    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )

    // Resolve org via assistant mapping
    let organizationId: string | null = null
    if (call?.assistantId) {
      const { data: mapping } = await supabase
        .from('assistant_mappings')
        .select('organization_id')
        .eq('vapi_assistant_id', call.assistantId)
        .eq('is_active', true)
        .limit(1)
        .single()
      organizationId = mapping?.organization_id ?? null
    }

    if (!organizationId) {
      console.warn('[vapi/calls] No active assistant mapping for assistantId:', call?.assistantId)
      return new Response(null, { status: 200 })
    }

    const { error } = await supabase.from('calls').insert({
      organization_id: organizationId,
      vapi_call_id: vapiCallId,
      assistant_id: call?.assistantId ?? null,
      call_type: call?.type ?? null,
      status: call?.status ?? null,
      ended_reason: endedReason ?? null,
      started_at: startedAt ?? call?.startedAt ?? null,
      ended_at: endedAt ?? call?.endedAt ?? null,
      cost: cost ?? call?.cost ?? null,
      customer_number: call?.customer?.number ?? null,
      customer_name: call?.customer?.name ?? null,
      summary: analysis?.summary ?? null,
      transcript: artifact?.transcript ?? null,
      transcript_turns: (artifact?.messages ?? []) as import('@/types/database').Json,
    })

    if (error) {
      // Duplicate vapi_call_id — idempotent: Vapi may retry, ignore unique constraint violations
      if (error.code !== '23505') {
        console.error('[vapi/calls] Insert error:', error.message)
      }
    }

    return new Response(null, { status: 200 })
  } catch (err) {
    console.error('[vapi/calls] Unexpected error:', err)
    return new Response(null, { status: 200 })
  }
}
