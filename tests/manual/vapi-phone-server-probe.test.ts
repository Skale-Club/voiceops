// Read-only: where the assistant's tool calls are actually routed (phone
// number / org-level server config) and the effective timeout, plus the last
// invocations of the legacy widget agent.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const LEGACY_AGENT = 'a971fa69-e975-41c1-acbc-e9a85e2dbd68'
it('dumps phone-number server config and legacy invocations', async () => {
  const s = createServiceRoleClient()
  const { data } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', ORG_ID).eq('provider', 'vapi').eq('is_active', true).maybeSingle()
  const key = await decrypt(data!.encrypted_api_key)
  const nums = (await (await fetch('https://api.vapi.ai/phone-number', { headers: { Authorization: `Bearer ${key}` } })).json()) as any[]
  for (const n of nums) console.log('### NUMBER ' + JSON.stringify({ number: n.number, assistantId: n.assistantId, server: n.server ?? null, serverUrl: n.serverUrl ?? null }))
  const { data: inv } = await s.from('agent_invocations').select('created_at, channel, status').eq('agent_id', LEGACY_AGENT).order('created_at', { ascending: false }).limit(3)
  console.log('### LEGACY_INV ' + JSON.stringify(inv))
}, 60000)
