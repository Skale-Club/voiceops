// The answer to Vapi's `assistant-request`: which assistant takes this inbound
// call, and what it says first.
//
// Why this exists. On a phone call the customer lookup used to be the model's
// first tool call: the caller heard a tool filler at ~3s and the greeting at
// ~9s (call 4, 2026-09-05). Vapi asks the server *while the call is being set
// up* when the number has no fixed assistant, and the response may carry
// `assistantOverrides` with a `firstMessage` and `variableValues`. So the
// lookup happens while the phone is still ringing, the greeting is spoken the
// instant the call connects, already personalised, and the model's first turn
// starts with the caller's facts in its prompt — no lookup tool on the line.
//
// Budget. Vapi gives the server 7.5s end to end; this module targets well
// under that: the lookup is raced against `lookupBudgetMs` and the response is
// always produced. Any failure degrades to the plain `assistantId` (today's
// behaviour), never to an error response and never to a dead line.
//
// Identity. The number on the line is the only identity used; nothing in the
// request body chooses which customer is looked up.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { memoTtl, clearMemo } from '@/lib/cache/ttl-memo'
import { customerLookupKey, CUSTOMER_LOOKUP_TTL_MS, warmCustomerLookup } from './customer-lookup-cache'
import { spokenName } from './render-assistant-config'

export interface AssistantRequestCall {
  id?: string
  phoneNumberId?: string | null
  customer?: { number?: string | null } | null
  phoneNumber?: { number?: string | null } | null
}

export interface AssistantRequestAnswer {
  assistantId: string
  assistantOverrides?: {
    firstMessage?: string
    variableValues?: Record<string, string>
  }
}

/** The facts the prompt may reference as {{caller_facts}} and {{caller_first_name}}. */
export interface CallerFacts {
  known: boolean
  firstName: string
  fullName: string
  /** The lookup tool's own text (name and upcoming appointments), or an explanation. */
  facts: string
}

const ORG_TTL_MS = 5 * 60_000

interface NumberResolution {
  organizationId: string
  assistantId: string
  businessName: string
}

/**
 * Which tenant and assistant answer this number. The number row is the
 * source (twilio_phone_numbers.vapi_phone_number_id); the assistant comes from
 * the number row when it names one, else from the org's active mapping.
 */
export async function resolveNumber(
  phoneNumberId: string,
  supabase: SupabaseClient<Database>,
): Promise<NumberResolution | null> {
  const key = `vapi:assistant-request:number:${phoneNumberId}`
  const resolved = await memoTtl(key, ORG_TTL_MS, () => readNumber(phoneNumberId, supabase))
  // A miss is not worth five minutes: the operator registering the number
  // must take effect on the next call, not after the memo expires.
  if (!resolved) clearMemo(key)
  return resolved
}

async function readNumber(
  phoneNumberId: string,
  supabase: SupabaseClient<Database>,
): Promise<NumberResolution | null> {
  {
    const { data: row } = await supabase
      .from('twilio_phone_numbers')
      .select('organization_id, vapi_assistant_id')
      .eq('vapi_phone_number_id', phoneNumberId)
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (!row?.organization_id) return null
    let assistantId = row.vapi_assistant_id ?? null
    if (!assistantId) {
      const { data: mapping } = await supabase
        .from('assistant_mappings')
        .select('vapi_assistant_id')
        .eq('organization_id', row.organization_id)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      assistantId = mapping?.vapi_assistant_id ?? null
    }
    if (!assistantId) return null
    const { data: org } = await supabase.from('organizations').select('name').eq('id', row.organization_id).maybeSingle()
    return { organizationId: row.organization_id, assistantId, businessName: org?.name ?? '' }
  }
}

/** "Found customer: Vanildo Teste\n#471 on …" → the facts block and the names. */
export function callerFactsFromLookup(result: string | null | undefined): CallerFacts {
  const text = (result ?? '').trim()
  const m = /^Found customer:\s*(.+?)\s*(?:\n|$)/.exec(text)
  if (!m) return { known: false, firstName: '', fullName: '', facts: 'No record for the number calling. Ask who you are speaking with before the service.' }
  const fullName = m[1].trim()
  const firstName = fullName.split(/\s+/)[0] ?? ''
  const rest = text.slice(m[0].length).trim()
  const upcoming = rest && !/^No upcoming bookings\.?$/i.test(rest) ? `Upcoming appointments:\n${rest}` : 'No upcoming appointments.'
  return { known: true, firstName, fullName, facts: `Returning customer: ${fullName}.\n${upcoming}` }
}

export function greetingFor(businessName: string, facts: CallerFacts): string {
  const business = spokenName(businessName)
  return facts.known
    ? `Hi ${facts.firstName}! Thanks for calling ${business}. Which service would you like to book?`
    : `Hi there! Thanks for calling ${business}. Who am I speaking with?`
}

/** Races the cached lookup against the budget; a miss is a plain greeting. */
async function lookupWithin(
  organizationId: string,
  phone: string,
  budgetMs: number,
  supabase: SupabaseClient<Database>,
): Promise<string | null> {
  const key = customerLookupKey(organizationId, phone)
  const started = warmCustomerLookup(organizationId, phone, supabase).then(() =>
    // The warm memoised the result under the same key the tool route reads;
    // a second memoTtl call returns it without another provider round trip.
    memoTtl(key, CUSTOMER_LOOKUP_TTL_MS, async () => ''),
  )
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), budgetMs))
  try {
    const result = await Promise.race([started, timeout])
    return typeof result === 'string' && result ? result : null
  } catch {
    return null
  }
}

export interface AnswerOptions {
  lookupBudgetMs?: number
}

/**
 * Builds the response body for an `assistant-request`. Never throws: an
 * unresolvable number yields null (the route answers with an error message
 * Vapi speaks), and every other failure yields the bare assistantId.
 */
export async function answerAssistantRequest(
  call: AssistantRequestCall,
  supabase: SupabaseClient<Database>,
  options: AnswerOptions = {},
): Promise<AssistantRequestAnswer | null> {
  if (!call.phoneNumberId) return null
  const resolved = await resolveNumber(call.phoneNumberId, supabase).catch(() => null)
  if (!resolved) return null
  const phone = call.customer?.number?.trim() || ''
  try {
    const lookup = phone ? await lookupWithin(resolved.organizationId, phone, options.lookupBudgetMs ?? 4_000, supabase) : null
    const facts = callerFactsFromLookup(lookup)
    return {
      assistantId: resolved.assistantId,
      assistantOverrides: {
        firstMessage: greetingFor(resolved.businessName, facts),
        variableValues: {
          caller_known: facts.known ? 'yes' : 'no',
          caller_first_name: facts.firstName,
          caller_full_name: facts.fullName,
          caller_facts: facts.facts,
        },
      },
    }
  } catch {
    return { assistantId: resolved.assistantId }
  }
}
