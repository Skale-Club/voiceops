import { it } from 'vitest'
import { getXkeduleCredentialsForOrg } from '@/lib/xkedule/credentials'
import { getXkeduleBusinessInfo } from '@/lib/xkedule/actions/business-info'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
it('business_info shape', async () => {
  const s = createServiceRoleClient()
  const creds = await getXkeduleCredentialsForOrg(ORG, s)
  const out = await getXkeduleBusinessInfo({} as never, creds as never, { organizationId: ORG, supabase: s } as never)
  console.log('### business_info\n' + String(out).slice(0, 700))
}, 60000)
