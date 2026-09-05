// Read-only: which organization owns the number ending 0005, its Twilio
// integration row (ciphertext never printed), and what the demo org has.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const CC = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
it('finds the sms source', async () => {
  const s = createServiceRoleClient()
  const { data: nums, error } = await s.from('twilio_phone_numbers').select('*').ilike('e164', '%0005')
  if (error) console.log('### ERR ' + error.message)
  for (const n of nums ?? []) { const o = n as Record<string, unknown>; const { organization_id, ...rest } = o; console.log('### NUM org=' + organization_id + ' ' + JSON.stringify(Object.fromEntries(Object.entries(rest).filter(([k]) => !/token|secret|sid|key/i.test(k)))).slice(0, 400)) }
  const orgIds = [...new Set((nums ?? []).map((n) => (n as any).organization_id as string))]
  for (const id of orgIds) {
    const { data: org } = await s.from('organizations').select('name, slug').eq('id', id).maybeSingle()
    const { data: ints } = await s.from('integrations').select('id, provider, is_active, location_id').eq('organization_id', id).in('provider', ['twilio', 'evolution', 'whatsapp'])
    console.log('### ORG ' + id + ' ' + JSON.stringify(org) + ' integrations=' + JSON.stringify(ints))
  }
  const { data: ccInts } = await s.from('integrations').select('provider, is_active').eq('organization_id', CC)
  const { data: ccNums } = await s.from('twilio_phone_numbers').select('e164').eq('organization_id', CC)
  console.log('### CC integrations=' + JSON.stringify(ccInts) + ' numbers=' + JSON.stringify(ccNums))
}, 60000)
