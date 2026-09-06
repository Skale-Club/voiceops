// Node.js Route Handler | answers Vapi's `assistant-request` for an inbound
// call: which assistant, and a greeting that already knows the caller.
// See src/lib/vapi/assistant-request.ts for the why and the budget.
//
// Unlike the other Vapi receivers this one cannot "always 200 with ok:true":
// Vapi needs an assistant in the body or it has nothing to answer the call
// with. A rejected secret or an unknown number gets an `error` message Vapi
// speaks to the caller; everything else degrades to the plain assistantId.
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { verifyVapiSecret } from '@/lib/vapi/verify-signature'
import { answerAssistantRequest, type AssistantRequestCall } from '@/lib/vapi/assistant-request'
import { createLogger } from '@/lib/obs/logger'

export const runtime = 'nodejs'

const obs = createLogger({ route: 'api/vapi/assistant-request' })

const UNAVAILABLE = 'Sorry, we cannot take calls right now. Please try again in a few minutes.'

export async function POST(request: Request) {
  const started = Date.now()
  try {
    if (!verifyVapiSecret(request)) {
      return Response.json({ error: UNAVAILABLE }, { status: 401 })
    }
    const body = (await request.json().catch(() => null)) as { message?: { type?: string; call?: AssistantRequestCall } } | null
    const message = body?.message
    if (!message || message.type !== 'assistant-request' || !message.call) {
      return Response.json({ error: UNAVAILABLE })
    }
    const supabase = createServiceRoleClient()
    const answer = await answerAssistantRequest(message.call, supabase)
    obs.info('vapi_assistant_request', {
      phoneNumberId: message.call.phoneNumberId ?? null,
      known: answer?.assistantOverrides?.variableValues?.caller_known ?? null,
      ms: Date.now() - started,
    })
    if (!answer) return Response.json({ error: UNAVAILABLE })
    return Response.json(answer)
  } catch (err) {
    obs.error('vapi_assistant_request_failed', { error: err instanceof Error ? err.message : String(err), ms: Date.now() - started })
    return Response.json({ error: UNAVAILABLE })
  }
}
