import { it } from 'vitest'
import { getXkeduleCredentialsForOrg } from '@/lib/xkedule/credentials'
import { checkXkeduleAvailability } from '@/lib/xkedule/actions/check-availability'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
it('can we warm 7 days in parallel, and do they stay warm?', async () => {
  const s = createServiceRoleClient()
  const creds = await getXkeduleCredentialsForOrg(ORG, s)
  const ctx = { organizationId: ORG, supabase: s } as never
  const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-09']
  const t0 = Date.now()
  const settled = await Promise.allSettled(days.map(d => checkXkeduleAvailability({ serviceIds: [333], date: d } as never, creds as never, ctx)))
  const ok = settled.filter(r => r.status === 'fulfilled').length
  console.log(`### PARALLEL WARM of ${days.length} days: ${Date.now() - t0}ms wall clock, ${ok}/${days.length} succeeded`)
  for (const d of ['2026-11-04', '2026-11-07']) {
    const t = Date.now()
    await checkXkeduleAvailability({ serviceIds: [333], date: d } as never, creds as never, ctx)
    console.log(`### then asking ${d}: ${Date.now() - t}ms`)
  }
}, 300000)
