// Vapi webhook secret verification.
// Vapi sends the configured `serverSecret` in the X-Vapi-Secret header.
// If VAPI_WEBHOOK_SECRET is unset (dev/local), verification is skipped and a warning is logged.

import { timingSafeEqual } from 'crypto'

let warnedMissing = false

export function verifyVapiSecret(request: Request): boolean {
  const expected = process.env.VAPI_WEBHOOK_SECRET
  if (!expected) {
    if (!warnedMissing) {
      console.warn('[vapi] VAPI_WEBHOOK_SECRET is not set — webhook signature verification disabled.')
      warnedMissing = true
    }
    return true
  }

  const received = request.headers.get('x-vapi-secret')
  if (!received) return false

  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
