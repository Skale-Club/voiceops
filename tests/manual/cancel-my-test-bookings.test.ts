// Cancels the bookings this session created as notification proofs (#480,
// #481, #482) directly through the provider action - no engine, no events,
// no cancellation texts. Leaves the operator's own test bookings alone.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { getXkeduleCredentialsForOrg } from '@/lib/xkedule/credentials'
import { cancelXkeduleBooking } from '@/lib/xkedule/actions/cancel-booking'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
it.skipIf(process.env.APPLY !== '1')('cancels 480-482', async () => {
  const s = createServiceRoleClient()
  const creds = await getXkeduleCredentialsForOrg(ORG_ID, s)
  for (const bookingId of [480, 481, 482]) {
    try { console.log('### ' + bookingId + ' ' + String(await cancelXkeduleBooking({ bookingId }, creds!)).slice(0, 80)) } catch (e) { console.log('### ' + bookingId + ' ERR ' + String(e).slice(0, 80)) }
  }
}, 180000)
