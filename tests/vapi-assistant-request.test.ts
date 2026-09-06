// The greeting that already knows the caller: built from the number on the
// line before the call connects, within a budget, never a dead line.
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/vapi/customer-lookup-cache', async (original) => {
  const real = await original<typeof import('@/lib/vapi/customer-lookup-cache')>()
  return { ...real, warmCustomerLookup: vi.fn() }
})
import { memoTtl, clearMemo } from '@/lib/cache/ttl-memo'
import { warmCustomerLookup, customerLookupKey, CUSTOMER_LOOKUP_TTL_MS } from '@/lib/vapi/customer-lookup-cache'
import { answerAssistantRequest, callerFactsFromLookup, greetingFor } from '@/lib/vapi/assistant-request'

const ORG = 'org-1'
const ASSISTANT = 'asst-1'
const NUMBER_ID = 'num-1'

function supabaseWith(rows: { number?: Record<string, unknown> | null; mapping?: Record<string, unknown> | null; org?: Record<string, unknown> | null }) {
  const table = (name: string) => {
    const data = name === 'twilio_phone_numbers' ? rows.number : name === 'assistant_mappings' ? rows.mapping : name === 'organizations' ? rows.org : null
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order', 'limit']) chain[m] = () => chain
    chain.maybeSingle = async () => ({ data: data ?? null })
    return chain
  }
  return { from: table } as never
}

beforeEach(() => { clearMemo(); vi.mocked(warmCustomerLookup).mockReset() })

describe('caller facts from the lookup text', () => {
  it('reads the name and the appointments', () => {
    const f = callerFactsFromLookup('Found customer: Vanildo Teste\n#471 on 2026-09-08 at 10:30 (pending): Signature Haircut (service id 333) with Nina Alvarez (staff id 1), $38.00')
    expect(f).toMatchObject({ known: true, firstName: 'Vanildo', fullName: 'Vanildo Teste' })
    expect(f.facts).toContain('Returning customer: Vanildo Teste')
    expect(f.facts).toContain('#471')
  })
  it('an unknown number asks for the name', () => {
    const f = callerFactsFromLookup("I don't have a record for that phone number yet.")
    expect(f.known).toBe(false)
    expect(greetingFor('Cuts & Culture Barbershop', f)).toBe('Hi there! Thanks for calling Cuts and Culture Barbershop. Who am I speaking with?')
  })
  it('a known caller is greeted by first name and asked for the service', () => {
    const f = callerFactsFromLookup('Found customer: Vanildo Teste\nNo upcoming bookings.')
    expect(greetingFor('Cuts & Culture Barbershop', f)).toBe('Hi Vanildo! Thanks for calling Cuts and Culture Barbershop. Which service would you like to book?')
    expect(f.facts).toContain('No upcoming appointments')
  })
})

describe('answerAssistantRequest', () => {
  const call = { id: 'call-1', phoneNumberId: NUMBER_ID, customer: { number: '+15088018190' } }

  it('returns null for a number that maps to no tenant, and does not remember the miss', async () => {
    expect(await answerAssistantRequest(call, supabaseWith({ number: null }))).toBeNull()
    const answer = await answerAssistantRequest({ phoneNumberId: NUMBER_ID }, supabaseWith({ number: { organization_id: ORG, vapi_assistant_id: ASSISTANT }, org: { name: 'Shop' } }))
    expect(answer?.assistantId).toBe(ASSISTANT)
  })

  it('personalises the greeting when the lookup answers within budget', async () => {
    vi.mocked(warmCustomerLookup).mockImplementation(async (org, phone) => {
      await memoTtl(customerLookupKey(org, phone), CUSTOMER_LOOKUP_TTL_MS, async () => 'Found customer: Vanildo Teste\nNo upcoming bookings.')
    })
    const answer = await answerAssistantRequest(call, supabaseWith({ number: { organization_id: ORG, vapi_assistant_id: ASSISTANT }, org: { name: 'Cuts & Culture Barbershop' } }))
    expect(answer?.assistantId).toBe(ASSISTANT)
    expect(answer?.assistantOverrides?.firstMessage).toMatch(/^Hi Vanildo!/)
    expect(answer?.assistantOverrides?.variableValues).toMatchObject({ caller_known: 'yes', caller_first_name: 'Vanildo', caller_full_name: 'Vanildo Teste' })
  })

  it('falls back to the plain greeting when the lookup is slower than the budget', async () => {
    vi.mocked(warmCustomerLookup).mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 200)))
    const answer = await answerAssistantRequest(call, supabaseWith({ number: { organization_id: ORG, vapi_assistant_id: null }, mapping: { vapi_assistant_id: ASSISTANT }, org: { name: 'Shop' } }), { lookupBudgetMs: 20 })
    expect(answer?.assistantId).toBe(ASSISTANT)
    expect(answer?.assistantOverrides?.firstMessage).toMatch(/Who am I speaking with\?$/)
    expect(answer?.assistantOverrides?.variableValues?.caller_known).toBe('no')
    // A timeout is not "no record": the model must still look the caller up.
    expect(answer?.assistantOverrides?.variableValues?.caller_facts).toBe('Not looked up yet.')
  })

  it('a call without a number still gets the assistant and the generic greeting', async () => {
    const answer = await answerAssistantRequest({ phoneNumberId: NUMBER_ID }, supabaseWith({ number: { organization_id: ORG, vapi_assistant_id: ASSISTANT }, org: { name: 'Shop' } }))
    expect(answer?.assistantId).toBe(ASSISTANT)
    expect(warmCustomerLookup).not.toHaveBeenCalled()
  })
})
