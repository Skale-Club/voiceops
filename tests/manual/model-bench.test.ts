import { describe, it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'

const CANDIDATES = [
  'anthropic/claude-haiku-4.5',
  'google/gemini-2.5-flash-lite',
  'google/gemini-2.5-flash',
  'openai/gpt-4.1-mini',
  'openai/gpt-4.1-nano',
]

describe('specialist model latency', () => {
  it('benchmarks candidates on a representative turn', async () => {
    const s = createServiceRoleClient()
    const { data } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', '31502b7d-f4bd-4493-91f7-fc6f2738a09d').eq('provider', 'openrouter').maybeSingle()
    const key = await decrypt(data!.encrypted_api_key)
    const system = 'You are the Availability specialist for a barbershop. Report open times in one short spoken sentence. Never invent a time.'
    const user = 'Tool returned: 2026-09-08: 09:00, 09:45, 10:30, 11:15, 12:00, 12:45, 13:30, 14:15, 15:00, 15:45, 16:30, 17:15. Answer the caller who asked what is open on the 8th.'
    for (const model of CANDIDATES) {
      const t = Date.now()
      try {
        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model, max_tokens: 120, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
        })
        const j = await r.json() as any
        const ms = Date.now() - t
        const text = j.choices?.[0]?.message?.content ?? j.error?.message ?? '(none)'
        console.log(`${model.padEnd(32)} ${String(ms).padStart(6)}ms  ${String(text).replace(/\n/g, ' ').slice(0, 90)}`)
      } catch (e) {
        console.log(`${model.padEnd(32)} FAILED ${(e as Error).message}`)
      }
    }
  }, 300000)
})
