import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { verifyApiKey } from '@/lib/api-keys/verify'
import { rateLimit } from '@/lib/rate-limit'
import { commerceEventSchema } from '@/lib/commerce/ingestion-schema'
import { insertCommerceReceipt } from '@/lib/commerce/receipts'
import { emitCommerceEvent, type CommerceOrderData, type CommerceCustomerData } from '@/lib/commerce/events'

export const runtime = 'nodejs'

const MAX_BODY_BYTES = 64 * 1024

export async function POST(request: Request): Promise<Response> {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: 'Request body is too large', code: 'payload_too_large' }, { status: 413 })
  }

  const supabase = createServiceRoleClient()
  const auth = await verifyApiKey(request, supabase, 'commerce:events')
  if (!auth.ok) {
    return Response.json({ error: auth.error, code: auth.code }, { status: auth.status })
  }

  // X8: bounded per-instance fallback instead of 'open' — this is an
  // authenticated endpoint that fans out into workflow dispatch, so if Redis
  // is down, failMode 'open' would remove the 600/min/org cap entirely
  // (DoS / billing amplifier). 'memory' keeps a coarse but non-zero limit.
  const rl = await rateLimit('commerce:evt:' + auth.key.orgId, 600, 60, { failMode: 'memory' })
  if (!rl.allowed) {
    return Response.json({ error: 'Too many events', code: 'rate_limited' }, { status: 429 })
  }

  let payload: z.infer<typeof commerceEventSchema>
  try {
    const rawText = await request.text()
    if (new TextEncoder().encode(rawText).byteLength > MAX_BODY_BYTES) {
      return Response.json({ error: 'Request body is too large', code: 'payload_too_large' }, { status: 413 })
    }
    payload = commerceEventSchema.parse(JSON.parse(rawText))
  } catch (error) {
    return Response.json(
      {
        error: 'Invalid request body',
        code: 'invalid_payload',
        details: error instanceof z.ZodError ? error.errors : undefined,
      },
      { status: 422 },
    )
  }

  const idempotencyKey = request.headers.get('idempotency-key')?.trim()
  if (!idempotencyKey || idempotencyKey !== payload.event_id) {
    return Response.json(
      { error: 'Idempotency-Key must match event_id', code: 'invalid_idempotency_key' },
      { status: 422 },
    )
  }

  try {
    const result = await insertCommerceReceipt(supabase, auth.key.orgId, payload)
    if (!result.duplicate) {
      // payload.data is zod-validated and structurally matches CommerceOrderData/
      // CommerceCustomerData (events.ts's own interfaces, kept independent of
      // ingestion-schema.ts per 136-02) except items[].variant_id, which zod types
      // as `string | null | undefined` (nullable().optional()) vs the interface's
      // `string | null` — the value itself is never actually `undefined` once the
      // envelope has parsed (the field is always present, only its value may be
      // null), so the cast is a type-only widening, not a runtime risk.
      await emitCommerceEvent(
        supabase,
        auth.key.orgId,
        result.receiptId,
        payload.type,
        payload.data as CommerceOrderData | CommerceCustomerData,
      )
    }
    await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', auth.key.keyId)
    return result.duplicate
      ? Response.json({ duplicate: true }, { status: 200 })
      : Response.json({ receipt_id: result.receiptId }, { status: 201 })
  } catch (error) {
    console.error('[api/v1/commerce/events] ingestion failed', error instanceof Error ? error.message : 'unknown error')
    return Response.json({ error: 'Failed to ingest commerce event', code: 'ingestion_failed' }, { status: 500 })
  }
}
