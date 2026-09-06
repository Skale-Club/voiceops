// Tenant data + Vapi config: route a phone number through the
// assistant-request endpoint so the greeting already knows the caller
// (src/lib/vapi/assistant-request.ts). Dry run by default.
//
//   VAPI_PUSH_TEST_ORG_ID=<org> VAPI_NUMBER=+12245516131 \
//     npx vitest run --config vitest.manual.config.ts tests/manual/set-number-assistant-request.test.ts
//   APPLY=1   registers the number in twilio_phone_numbers (if missing), sets the
//             number's server URL + secret on Vapi and clears its assistantId
//             (Vapi only asks the server when the number has no fixed assistant).
//   REVERT=1  puts the assistantId back on the number and removes the server.
//   DB_ONLY=1 with APPLY=1: only registers the number row (to probe the endpoint first).
//
// The secret is the one the assistant's tools already send (x-vapi-secret);
// only its fingerprint is printed.
import { it } from 'vitest'
import { createHash } from 'node:crypto'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'

const ORG_ID = process.env.VAPI_PUSH_TEST_ORG_ID
const NUMBER = process.env.VAPI_NUMBER
const SERVER_URL = 'https://xphere.app/api/vapi/assistant-request'
// Where Vapi sends the call if the server cannot answer in time (never a dead line).
const FALLBACK = process.env.VAPI_FALLBACK_NUMBER

it.skipIf(!ORG_ID || !NUMBER)('routes the number through assistant-request', async () => {
  const s = createServiceRoleClient()
  const { data: integ } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', ORG_ID!).eq('provider', 'vapi').eq('is_active', true).maybeSingle()
  const key = await decrypt(integ!.encrypted_api_key)
  const h = { Authorization: `Bearer ${key}`, 'content-type': 'application/json' }
  const numbers = (await (await fetch('https://api.vapi.ai/phone-number', { headers: h })).json()) as Array<Record<string, any>>
  const num = numbers.find((n) => n.number === NUMBER)
  if (!num) throw new Error(`Number ${NUMBER} is not on this Vapi account`)
  const { data: mapping } = await s.from('assistant_mappings').select('vapi_assistant_id').eq('organization_id', ORG_ID!).eq('is_active', true).order('created_at', { ascending: true }).limit(1).maybeSingle()
  const assistantId: string = num.assistantId ?? mapping?.vapi_assistant_id
  if (!assistantId) throw new Error('No assistant for this number or org')
  const assistant = (await (await fetch(`https://api.vapi.ai/assistant/${assistantId}`, { headers: h })).json()) as Record<string, any>
  const secret: string | undefined = (assistant.model?.tools ?? []).map((t: any) => t.server?.secret ?? t.server?.headers?.['x-vapi-secret']).find(Boolean) ?? assistant.server?.headers?.['x-vapi-secret']
  if (!secret) throw new Error('No x-vapi-secret on the assistant tools to reuse')
  const fp = createHash('sha256').update(secret).digest('hex').slice(0, 12)
  const { data: row } = await s.from('twilio_phone_numbers').select('id, vapi_phone_number_id, vapi_assistant_id, is_active').eq('organization_id', ORG_ID!).eq('e164', NUMBER!).maybeSingle()
  console.log(`### number ${num.id} assistantId=${num.assistantId ?? 'none'} server=${num.server?.url ?? 'none'} | db row=${row ? JSON.stringify(row) : 'MISSING'} | assistant=${assistantId} secret fp=${fp}`)

  if (process.env.REVERT === '1') {
    const r = await fetch(`https://api.vapi.ai/phone-number/${num.id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ assistantId, server: null }) })
    console.log(`### REVERTED vapi ${r.status}`)
    return
  }
  if (process.env.APPLY !== '1') { console.log('### DRY RUN: would register the row (if missing), set server + secret, clear assistantId'); return }

  if (!row) {
    const { error } = await s.from('twilio_phone_numbers').insert({
      organization_id: ORG_ID!, e164: NUMBER!, provider: 'vapi', vapi_phone_number_id: num.id, vapi_assistant_id: assistantId,
      friendly_name: num.name ?? NUMBER!, capability_voice: true, capability_sms: false, capability_mms: false, is_active: true,
    })
    if (error) throw new Error(error.message)
    console.log('### db row inserted')
  } else if (row.vapi_phone_number_id !== num.id || row.vapi_assistant_id !== assistantId || !row.is_active) {
    const { error } = await s.from('twilio_phone_numbers').update({ vapi_phone_number_id: num.id, vapi_assistant_id: assistantId, is_active: true }).eq('id', row.id)
    if (error) throw new Error(error.message)
    console.log('### db row updated')
  }
  if (process.env.DB_ONLY === '1') { console.log('### DB_ONLY: number registered, Vapi untouched'); return }
  const r = await fetch(`https://api.vapi.ai/phone-number/${num.id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ assistantId: null, server: { url: SERVER_URL, secret }, ...(FALLBACK ? { fallbackDestination: { type: 'number', number: FALLBACK } } : {}) }) })
  const body = (await r.json()) as Record<string, any>
  console.log(`### APPLIED vapi ${r.status} assistantId=${body.assistantId ?? 'none'} server=${body.server?.url ?? 'none'}`)
}, 60000)
