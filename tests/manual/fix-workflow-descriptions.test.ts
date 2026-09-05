// Tenant data fix: seven of the eight Xkedule tool workflows describe
// themselves as "Xkedule booking tool for Cuts & Culture Barbershop
// (demo.xkedule.com)" - useless to the model that has to pick between them
// on a live call, and a tenant name baked into what a template would carry.
// Replaces them with the per-tool descriptions from the canary graph, which
// are tenant-neutral. Dry run unless APPLY=1.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = process.env.VAPI_PUSH_TEST_ORG_ID
const DESCRIPTIONS: Record<string, string> = {
  list_services: 'Catalogue of services: names, ids, duration, starting price and which staff perform each one. Call it before naming or pricing any service.',
  get_quote: 'Real total and breakdown for one or more service ids. Call it before stating a price.',
  check_availability: 'Open times for a set of service ids on a given date (YYYY-MM-DD). Pinning a staffId materially speeds up the lookup.',
  lookup_customer: 'Identify a returning customer by phone number: name, upcoming bookings and the booking ids needed to change anything.',
  book_appointment: 'Create a new appointment. Needs service ids, date, start time, customer name and phone - only after the customer confirmed all of them and accepted the price.',
  reschedule_appointment: 'Move an existing appointment to a new date and start time. Needs the booking id from lookup_customer.',
  cancel_appointment: 'Cancel an existing appointment. Needs the booking id from lookup_customer.',
}
it.skipIf(!ORG_ID)('replaces placeholder workflow descriptions', async () => {
  const s = createServiceRoleClient()
  const { data: rows } = await s.from('workflows').select('id, tool_name, description').eq('org_id', ORG_ID!).is('deleted_at', null).in('tool_name', Object.keys(DESCRIPTIONS))
  for (const w of rows ?? []) {
    const next = DESCRIPTIONS[w.tool_name!]
    const placeholder = /^Xkedule booking tool for/.test(w.description ?? '')
    console.log(`### ${w.tool_name} :: ${placeholder ? 'PLACEHOLDER' : 'custom'} :: "${String(w.description).slice(0, 70)}"`)
    if (!placeholder) continue
    if (process.env.APPLY !== '1') continue
    const { error } = await s.from('workflows').update({ description: next }).eq('id', w.id)
    if (error) throw new Error(error.message)
    console.log(`###   -> updated`)
  }
  if (process.env.APPLY !== '1') console.log('### DRY RUN')
}, 60000)
