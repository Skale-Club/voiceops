// Read-only probe: POSTs a synthetic assistant-request to production the way
// Vapi would (secret reused from the assistant's tool routing; only its
// fingerprint is printed) and shows the answer and its latency.
//   VAPI_PUSH_TEST_ORG_ID=<org> VAPI_NUMBER=+12245516131 CALLER=+15088018190 \
//     npx vitest run --config vitest.manual.config.ts tests/manual/probe-assistant-request.test.ts
import { it } from 'vitest'
import { createHash } from 'node:crypto'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'

const ORG_ID = process.env.VAPI_PUSH_TEST_ORG_ID
const NUMBER = process.env.VAPI_NUMBER
const CALLER = process.env.CALLER
const URL = process.env.ASSISTANT_REQUEST_URL ?? 'https://xphere.app/api/vapi/assistant-request'

it.skipIf(!ORG_ID || !NUMBER)('answers an assistant-request', async () => {
  const s = createServiceRoleClient()
  const { data: integ } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', ORG_ID!).eq('provider', 'vapi').eq('is_active', true).maybeSingle()
  const key = await decrypt(integ!.encrypted_api_key)
  const h = { Authorization: `Bearer ${key}` }
  const numbers = (await (await fetch('https://api.vapi.ai/phone-number', { headers: h })).json()) as Array<Record<string, any>>
  const num = numbers.find((n) => n.number === NUMBER)
  if (!num) throw new Error('number not found')
  const { data: mapping } = await s.from('assistant_mappings').select('vapi_assistant_id').eq('organization_id', ORG_ID!).eq('is_active', true).limit(1).maybeSingle()
  const assistantId = num.assistantId ?? mapping?.vapi_assistant_id
  const assistant = (await (await fetch(`https://api.vapi.ai/assistant/${assistantId}`, { headers: h })).json()) as Record<string, any>
  const secret: string = (assistant.model?.tools ?? []).map((t: any) => t.server?.secret ?? t.server?.headers?.['x-vapi-secret']).find(Boolean)
  console.log('### secret fp ' + createHash('sha256').update(secret).digest('hex').slice(0, 12))
  for (const caller of [CALLER, '+15550001111', undefined]) {
    const t0 = Date.now()
    const r = await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-vapi-secret': secret }, body: JSON.stringify({ message: { type: 'assistant-request', call: { id: 'probe', phoneNumberId: num.id, customer: caller ? { number: caller } : undefined } } }) })
    const body = await r.text()
    console.log(`### caller=${caller ?? 'none'} HTTP ${r.status} ${Date.now() - t0}ms :: ${body.slice(0, 400)}`)
  }
}, 120000)
