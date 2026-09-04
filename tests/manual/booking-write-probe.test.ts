import { it } from 'vitest'
import { getXkeduleCredentialsForOrg } from '@/lib/xkedule/credentials'
import { lookupXkeduleCustomer } from '@/lib/xkedule/actions/lookup-customer'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
it('did the timed-out write actually land?', async () => {
  const s = createServiceRoleClient()
  const creds = await getXkeduleCredentialsForOrg(ORG, s)
  const ctx = { organizationId: ORG, supabase: s } as never
  const t = Date.now()
  const out = await lookupXkeduleCustomer({ phone: '+15088018190' } as never, creds as never, ctx)
  console.log(`### lookup_customer (${Date.now() - t}ms):\n${String(out).slice(0, 600)}`)
}, 120000)
