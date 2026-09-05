// Read-only: the Twilio integration rows of the orgs that share the
// notifications number (ids and flags only; ciphertext never printed).
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
it('dumps twilio integration rows', async () => {
  const s = createServiceRoleClient()
  for (const [name, id] of [['Skale Club', 'b27e99cf-efcb-4b6b-a369-5a0d3ca7ffe5'], ['Skleanings', '24552ef3-de77-4fba-a2c3-148cd58d8750'], ['Cuts & Culture', '31502b7d-f4bd-4493-91f7-fc6f2738a09d']]) {
    const { data, error } = await s.from('integrations').select('id, provider, is_active, location_id, created_at, updated_at').eq('organization_id', id).eq('provider', 'twilio')
    console.log(`### ${name} :: ${error ? 'ERR ' + error.message : JSON.stringify(data)}`)
  }
  const { data: cols } = await s.from('integrations').select('*').eq('organization_id', 'b27e99cf-efcb-4b6b-a369-5a0d3ca7ffe5').eq('provider', 'twilio').maybeSingle()
  console.log('### COLUMNS ' + JSON.stringify(Object.keys(cols ?? {})))
  console.log('### CIPHER_LEN ' + String((cols as any)?.encrypted_api_key ?? '').length)
}, 60000)
