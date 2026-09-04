import { it } from 'vitest'
import { getXkeduleCredentialsForOrg } from '@/lib/xkedule/credentials'
import { checkXkeduleAvailability } from '@/lib/xkedule/actions/check-availability'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const looksReal = (s: string) => /\d{2}:\d{2}/.test(s) || /no availability|fully booked/i.test(s)
it('inspect what parallel warming actually returns', async () => {
  const s = createServiceRoleClient()
  const creds = await getXkeduleCredentialsForOrg(ORG, s)
  const ctx = { organizationId: ORG, supabase: s } as never
  const days = ['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-07', '2026-12-08', '2026-12-09']
  const t0 = Date.now()
  const out = await Promise.all(days.map(async d => {
    const t = Date.now()
    const r = String(await checkXkeduleAvailability({ serviceIds: [333], date: d } as never, creds as never, ctx))
    return { d, ms: Date.now() - t, ok: looksReal(r), snippet: r.slice(0, 70) }
  }))
  console.log(`### parallel batch wall clock: ${Date.now() - t0}ms`)
  for (const o of out) console.log(`###  ${o.d}  ${String(o.ms).padStart(6)}ms  real=${o.ok}  ${o.snippet.replace(/\n/g, ' ')}`)
  console.log('### --- now re-ask each, sequentially ---')
  for (const d of days) {
    const t = Date.now()
    await checkXkeduleAvailability({ serviceIds: [333], date: d } as never, creds as never, ctx)
    console.log(`###  re-ask ${d}: ${Date.now() - t}ms`)
  }
}, 300000)
