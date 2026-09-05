// Makes the shared notifications number the demo org's default SMS sender
// (the org's other number is the Vapi line, not a Twilio SMS number) and
// sends ONE test SMS to the operator's own phone through the real send_sms
// action, exactly as a workflow would. Dry run unless APPLY=1.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { executeAction } from '@/lib/action-engine/execute-action'
const ORG_ID = process.env.VAPI_PUSH_TEST_ORG_ID
const E164 = '+18667240005'
const TO = process.env.TEST_SMS_TO
it.skipIf(!ORG_ID)('sets the sms default and sends a test', async () => {
  const s = createServiceRoleClient()
  const { data: rows } = await s.from('twilio_phone_numbers').select('id, e164, provider, capability_sms, is_default, is_active').eq('organization_id', ORG_ID!)
  for (const r of rows ?? []) console.log('### ROW ' + JSON.stringify(r))
  const shared = rows?.find((r) => r.e164 === E164)
  const others = (rows ?? []).filter((r) => r.e164 !== E164 && r.is_default)
  console.log('### PLAN make ' + E164 + ' default; unset default on ' + others.map((o) => o.e164).join(',') + ' (provider ' + others.map((o) => o.provider).join(',') + ')')
  if (process.env.APPLY !== '1') { console.log('### DRY RUN'); return }
  for (const o of others) { const { error } = await s.from('twilio_phone_numbers').update({ is_default: false }).eq('id', o.id); if (error) throw new Error(error.message) }
  const { error } = await s.from('twilio_phone_numbers').update({ is_default: true }).eq('id', shared!.id); if (error) throw new Error(error.message)
  console.log('### DEFAULT SET')
  if (!TO) { console.log('### no TEST_SMS_TO, not sending'); return }
  const result = await executeAction('send_sms', { to: TO, phone: TO, message: 'Cuts & Culture: this is a test of booking confirmations from Xphere. Reply STOP to opt out.' }, { apiKey: '', locationId: '' }, { organizationId: ORG_ID!, supabase: s } as never)
  console.log('### SEND_RESULT ' + String(result).slice(0, 200))
}, 60000)
