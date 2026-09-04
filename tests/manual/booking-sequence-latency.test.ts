import { it } from 'vitest'
import { getXkeduleCredentialsForOrg } from '@/lib/xkedule/credentials'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { getXkeduleServices } from '@/lib/xkedule/actions/get-services'
import { checkXkeduleAvailability } from '@/lib/xkedule/actions/check-availability'
import { getXkeduleQuote } from '@/lib/xkedule/actions/quote'
import { lookupXkeduleCustomer } from '@/lib/xkedule/actions/lookup-customer'
const ORG = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
it('tool time a real booking conversation spends (reads only, no write)', async () => {
  const s = createServiceRoleClient()
  const creds = await getXkeduleCredentialsForOrg(ORG, s)
  const ctx = { organizationId: ORG, supabase: s } as never
  let total = 0
  const step = async (label: string, fn: () => Promise<unknown>) => {
    const t = Date.now(); try { await fn() } catch { /* time it anyway */ }
    const ms = Date.now() - t; total += ms
    console.log(`### ${label.padEnd(40)} ${String(ms).padStart(6)}ms   running total ${String(total).padStart(6)}ms`)
  }
  // A caller who has never phoned before, asks about one day, then changes their mind.
  await step('1. lookup_customer (who is calling)', () => lookupXkeduleCustomer({ phone: '+15559990000' } as never, creds as never, ctx))
  await step('2. list_services (what do you offer)', () => getXkeduleServices({} as never, creds as never, ctx))
  await step('3. get_quote (how much)', () => getXkeduleQuote({ serviceIds: [333] } as never, creds as never, ctx))
  await step('4. check_availability Tue 6 Oct', () => checkXkeduleAvailability({ serviceIds: [333], date: '2026-10-06' } as never, creds as never, ctx))
  await step('5. "what about Wednesday?" 7 Oct', () => checkXkeduleAvailability({ serviceIds: [333], date: '2026-10-07' } as never, creds as never, ctx))
  await step('6. "and Thursday?" 8 Oct', () => checkXkeduleAvailability({ serviceIds: [333], date: '2026-10-08' } as never, creds as never, ctx))
  console.log(`### TOTAL TOOL TIME (no model inference, no write) ${total}ms`)
}, 300000)
