// SEED-044+ (phone-numbers Phase 3): builds the {{phone.*}} variable scope
// consumed by inbound-to-number workflow triggers.
// Mirrors src/lib/pipeline/scope.ts (buildOpportunityScope) and
// src/lib/calendar/scope.ts (buildMeetingScope).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export interface PhoneScopePhone {
  id: string | null
  e164: string | null
  provider: string | null
  friendly_name: string | null
  inbox_label: string | null
  business_purpose: string | null
  vapi_assistant_id: string | null
  /** Transfer/forward target. For Vapi numbers this is the human hand-off number. */
  forward_to_number: string | null
  responsible_user_id: string | null
  is_default: boolean
  capability_sms: boolean
  capability_voice: boolean
  capability_mms: boolean
}

export interface ContactScopeMinimal {
  id: string | null
  name: string | null
  phone: string | null
  email: string | null
}

const NULL_PHONE: PhoneScopePhone = {
  id: null,
  e164: null,
  provider: null,
  friendly_name: null,
  inbox_label: null,
  business_purpose: null,
  vapi_assistant_id: null,
  forward_to_number: null,
  responsible_user_id: null,
  is_default: false,
  capability_sms: false,
  capability_voice: false,
  capability_mms: false,
}

const NULL_CONTACT: ContactScopeMinimal = {
  id: null,
  name: null,
  phone: null,
  email: null,
}

export async function buildPhoneScope(
  supabase: SupabaseClient<Database>,
  phoneNumberId: string | null,
): Promise<PhoneScopePhone> {
  if (!phoneNumberId) return { ...NULL_PHONE }

  const { data } = await supabase
    .from('twilio_phone_numbers')
    .select('id,e164,provider,friendly_name,inbox_label,business_purpose,vapi_assistant_id,forward_to_number,responsible_user_id,is_default,capability_sms,capability_voice,capability_mms')
    .eq('id', phoneNumberId)
    .maybeSingle()

  if (!data) return { ...NULL_PHONE }

  return {
    id: data.id,
    e164: data.e164,
    provider: data.provider,
    friendly_name: data.friendly_name,
    inbox_label: data.inbox_label,
    business_purpose: data.business_purpose,
    vapi_assistant_id: data.vapi_assistant_id,
    forward_to_number: data.forward_to_number,
    responsible_user_id: data.responsible_user_id,
    is_default: data.is_default,
    capability_sms: data.capability_sms,
    capability_voice: data.capability_voice,
    capability_mms: data.capability_mms,
  }
}

export async function lookupContactByPhone(
  supabase: SupabaseClient<Database>,
  orgId: string,
  phone: string | null,
): Promise<ContactScopeMinimal> {
  if (!phone) return { ...NULL_CONTACT }
  const { data } = await supabase
    .from('contacts')
    .select('id, name, phone, email')
    .eq('org_id', orgId)
    .eq('phone', phone)
    .limit(1)
    .maybeSingle()
  if (!data) return { ...NULL_CONTACT }
  return {
    id: data.id,
    name: data.name,
    phone: data.phone,
    email: data.email,
  }
}
