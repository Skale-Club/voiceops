// Gives the demo org the platform's shared notifications number for SENDING:
// copies Skale Club's Twilio integration row (ciphertext only - never
// decrypted here) and registers +1 866 724 0005 as the org's default SMS
// number. Inbound to that number keeps going to its oldest owner (Skale
// Club) - see resolveTwilioOrgByToNumber. Dry run unless APPLY=1.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const SOURCE_ORG = 'b27e99cf-efcb-4b6b-a369-5a0d3ca7ffe5' // Skale Club
const TARGET_ORG = process.env.VAPI_PUSH_TEST_ORG_ID
const E164 = '+18667240005'
it.skipIf(!TARGET_ORG)('shares the notifications number', async () => {
  const s = createServiceRoleClient()
  const { data: src } = await s.from('integrations').select('name, encrypted_api_key, config, key_hint').eq('organization_id', SOURCE_ORG).eq('provider', 'twilio').eq('is_active', true).single()
  const { data: srcNum } = await s.from('twilio_phone_numbers').select('phone_sid, capability_sms, capability_mms, capability_voice').eq('organization_id', SOURCE_ORG).eq('e164', E164).single()
  const { data: existingInt } = await s.from('integrations').select('id').eq('organization_id', TARGET_ORG!).eq('provider', 'twilio').maybeSingle()
  const { data: existingNum } = await s.from('twilio_phone_numbers').select('id').eq('organization_id', TARGET_ORG!).eq('e164', E164).maybeSingle()
  console.log(`### PLAN integration=${existingInt ? 'exists' : 'copy (cipher ' + src!.encrypted_api_key.length + ' chars, hint ' + src!.key_hint + ')'} number=${existingNum ? 'exists' : 'insert ' + E164 + ' sms=' + srcNum!.capability_sms}`)
  if (process.env.APPLY !== '1') { console.log('### DRY RUN'); return }
  if (!existingInt) {
    const { error } = await s.from('integrations').insert({ organization_id: TARGET_ORG!, provider: 'twilio', name: src!.name ?? 'Twilio (shared notifications)', encrypted_api_key: src!.encrypted_api_key, config: src!.config, key_hint: src!.key_hint, is_active: true })
    if (error) throw new Error(error.message)
  }
  if (!existingNum) {
    const { error } = await s.from('twilio_phone_numbers').insert({ organization_id: TARGET_ORG!, e164: E164, provider: 'twilio', phone_sid: srcNum!.phone_sid, friendly_name: 'Cuts & Culture | Notifications (shared 866-724-0005)', capability_sms: true, capability_mms: srcNum!.capability_mms, capability_voice: false, is_default: false, is_active: true, business_purpose: 'notifications', notes: 'Shared platform notifications number; outbound only for this org. Inbound routes to its oldest owner.' })
    if (error) throw new Error(error.message)
  }
  console.log('### APPLIED')
}, 60000)
