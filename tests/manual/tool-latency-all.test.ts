import { it } from 'vitest'
import { getXkeduleCredentialsForOrg } from '@/lib/xkedule/credentials'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { getXkeduleServices } from '@/lib/xkedule/actions/get-services'
import { getXkeduleBusinessInfo } from '@/lib/xkedule/actions/business-info'
import { checkXkeduleAvailability } from '@/lib/xkedule/actions/check-availability'
import { getXkeduleQuote } from '@/lib/xkedule/actions/quote'
import { lookupXkeduleCustomer } from '@/lib/xkedule/actions/lookup-customer'
const ORG = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
it('latency of every read tool, 3 runs each', async () => {
  const s = createServiceRoleClient()
  const creds = await getXkeduleCredentialsForOrg(ORG, s)
  const ctx = { organizationId: ORG, supabase: s } as never
  const cases: Array<[string, () => Promise<unknown>]> = [
    ['business_info', () => getXkeduleBusinessInfo({} as never, creds as never, ctx)],
    ['list_services', () => getXkeduleServices({} as never, creds as never, ctx)],
    ['get_quote', () => getXkeduleQuote({ serviceIds: [333] } as never, creds as never, ctx)],
    ['lookup_customer', () => lookupXkeduleCustomer({ phone: '+15088018190' } as never, creds as never, ctx)],
    ['check_availability', () => checkXkeduleAvailability({ serviceIds: [333], date: '2026-09-08' } as never, creds as never, ctx)],
    ['check_availability+staff', () => checkXkeduleAvailability({ serviceIds: [333], date: '2026-09-08', staffId: 1 } as never, creds as never, ctx)],
  ]
  for (const [name, fn] of cases) {
    const ms: number[] = []
    for (let i = 0; i < 3; i++) { const t = Date.now(); try { await fn() } catch { /* record time anyway */ } ms.push(Date.now() - t) }
    console.log(`### ${name.padEnd(26)} ${ms.map(m => String(m).padStart(6)).join(' ')}  ms   median=${ms.sort((a, b) => a - b)[1]}`)
  }
}, 300000)
