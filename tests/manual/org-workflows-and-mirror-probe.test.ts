// Read-only: every workflow of the demo org (trigger + active), the bookings
// mirror rows Xkedule's webhook has written for it, and whether the
// platform's "Booking confirmation" seed exists anywhere.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
it('dumps workflows and mirror', async () => {
  const s = createServiceRoleClient()
  const { data: wfs } = await s.from('workflows').select('name, tool_name, kind, trigger_type, trigger_config, is_active').eq('org_id', ORG_ID).is('deleted_at', null).order('name')
  for (const w of wfs ?? []) console.log('### WF ' + JSON.stringify({ name: w.name, tool: w.tool_name, kind: w.kind, trigger: w.trigger_type, cfg: JSON.stringify(w.trigger_config ?? {}).slice(0, 80), active: w.is_active }))
  const { count, error } = await s.from('bookings').select('id', { count: 'exact', head: true }).eq('org_id', ORG_ID)
  console.log('### BOOKINGS_MIRROR ' + (error ? 'ERR ' + error.message : count))
  const { data: lastB } = await s.from('bookings').select('*').eq('org_id', ORG_ID).order('created_at', { ascending: false }).limit(2)
  for (const b of lastB ?? []) { const o = b as Record<string, unknown>; console.log('### B ' + JSON.stringify({ created_at: o.created_at, status: o.status, external_id: o.external_id ?? o.xkedule_booking_id, starts_at: o.starts_at, contact: o.contact_id, phone: o.customer_phone ?? o.attendee_phone }).slice(0, 300)) }
  const { data: seeds } = await s.from('workflows').select('org_id, is_active').ilike('name', 'Booking confirmation').limit(5)
  console.log('### SEED_INSTALLS ' + JSON.stringify(seeds))
  const { data: ev } = await s.from('workflows').select('name, org_id, trigger_config').eq('org_id', ORG_ID).eq('trigger_type', 'event').limit(10)
  console.log('### EVENT_WFS ' + JSON.stringify(ev))
}, 60000)
