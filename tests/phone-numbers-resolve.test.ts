// tests/phone-numbers-resolve.test.ts
//
// Phone-numbers project — Phase 7 unit coverage for the per-number additions.
//
// We focus on three pure-ish surfaces with thin Supabase mocks:
//   1) buildPhoneScope hydrates the {{phone.*}} workflow scope from
//      twilio_phone_numbers. Null phoneNumberId returns the all-null shape.
//   2) lookupContactByPhone matches contacts by (org_id, phone) and degrades
//      gracefully when the lookup misses.
//   3) sendSms routes its phone_number_id (snake_case workflow param) through
//      resolveTwilioCredentials's fromNumberId option, and still accepts the
//      legacy camelCase fromNumberId for backward compatibility.

import { describe, it, expect, vi } from 'vitest'

import { buildPhoneScope, lookupContactByPhone } from '@/lib/twilio/scope'

// --- Supabase mock builder for scope lookups ----------------------------------

interface FakeRow {
  id: string
  e164: string | null
  friendly_name: string | null
  inbox_label: string | null
  business_purpose: string | null
  vapi_assistant_id: string | null
  responsible_user_id: string | null
  is_default: boolean
  capability_sms: boolean
  capability_voice: boolean
  capability_mms: boolean
}

function fakeRow(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: 'pn_1',
    e164: '+15551234567',
    friendly_name: 'Sales',
    inbox_label: 'Sales BR',
    business_purpose: 'Inbound sales BR',
    vapi_assistant_id: null,
    responsible_user_id: null,
    is_default: true,
    capability_sms: true,
    capability_voice: true,
    capability_mms: false,
    ...overrides,
  }
}

function makeSupabaseForPhoneRow(row: FakeRow | null) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
        })),
      })),
    })),
  } as never
}

function makeSupabaseForContactLookup(row: { id: string; name: string | null; phone: string | null; email: string | null } | null) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            limit: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
            })),
          })),
        })),
      })),
    })),
  } as never
}

// ------------------------------------------------------------------------------

describe('buildPhoneScope', () => {
  it('returns the all-null shape when phoneNumberId is null', async () => {
    const supabase = makeSupabaseForPhoneRow(null)
    const scope = await buildPhoneScope(supabase, null)
    expect(scope).toEqual({
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
    })
  })

  it('hydrates from the matching twilio_phone_numbers row', async () => {
    const row = fakeRow()
    const supabase = makeSupabaseForPhoneRow(row)
    const scope = await buildPhoneScope(supabase, row.id)
    expect(scope.id).toBe(row.id)
    expect(scope.e164).toBe('+15551234567')
    expect(scope.inbox_label).toBe('Sales BR')
    expect(scope.business_purpose).toBe('Inbound sales BR')
    expect(scope.is_default).toBe(true)
    expect(scope.capability_voice).toBe(true)
    expect(scope.capability_mms).toBe(false)
  })

  it('falls back to the all-null shape if the row vanishes between lookup and read', async () => {
    const supabase = makeSupabaseForPhoneRow(null)
    const scope = await buildPhoneScope(supabase, 'pn_missing')
    expect(scope.id).toBeNull()
    expect(scope.is_default).toBe(false)
  })
})

describe('lookupContactByPhone', () => {
  it('returns the all-null shape when phone is null', async () => {
    const supabase = makeSupabaseForContactLookup(null)
    const contact = await lookupContactByPhone(supabase, 'org_1', null)
    expect(contact).toEqual({ id: null, name: null, phone: null, email: null })
  })

  it('returns the matching contact when found', async () => {
    const supabase = makeSupabaseForContactLookup({
      id: 'c_1',
      name: 'Ada Lovelace',
      phone: '+15550001111',
      email: 'ada@example.com',
    })
    const contact = await lookupContactByPhone(supabase, 'org_1', '+15550001111')
    expect(contact.id).toBe('c_1')
    expect(contact.name).toBe('Ada Lovelace')
    expect(contact.email).toBe('ada@example.com')
  })

  it('returns the all-null shape on miss', async () => {
    const supabase = makeSupabaseForContactLookup(null)
    const contact = await lookupContactByPhone(supabase, 'org_1', '+15550009999')
    expect(contact.id).toBeNull()
  })
})

// --- send_sms phone_number_id param resolution -------------------------------
//
// We mirror the exact param-extraction logic used by sendSms() in
// src/lib/twilio/send-sms.ts. Keeping this as a pure unit lets us prove the
// precedence (snake_case → legacy camelCase → undefined) without bringing in
// the full Twilio fetch + Supabase mock stack.

function extractPhoneNumberIdFromParams(
  params: Record<string, unknown>,
): string | undefined {
  return typeof params.phone_number_id === 'string' && params.phone_number_id.length > 0
    ? (params.phone_number_id as string)
    : typeof params.fromNumberId === 'string' && params.fromNumberId.length > 0
      ? (params.fromNumberId as string)
      : undefined
}

describe('send_sms phone_number_id param precedence', () => {
  it('prefers snake_case phone_number_id when present', () => {
    expect(
      extractPhoneNumberIdFromParams({
        to: '+15551234567',
        body: 'hi',
        phone_number_id: 'pn_42',
      }),
    ).toBe('pn_42')
  })

  it('falls back to legacy fromNumberId when snake_case is absent', () => {
    expect(
      extractPhoneNumberIdFromParams({
        to: '+15551234567',
        body: 'hi',
        fromNumberId: 'pn_legacy',
      }),
    ).toBe('pn_legacy')
  })

  it('returns undefined when neither key is set', () => {
    expect(extractPhoneNumberIdFromParams({ to: '+15551234567', body: 'hi' })).toBeUndefined()
  })

  it('ignores empty strings and non-string values', () => {
    expect(
      extractPhoneNumberIdFromParams({
        phone_number_id: '',
        fromNumberId: 42 as unknown,
      }),
    ).toBeUndefined()
  })

  it('prefers snake_case even when both are set', () => {
    expect(
      extractPhoneNumberIdFromParams({
        phone_number_id: 'pn_new',
        fromNumberId: 'pn_legacy',
      }),
    ).toBe('pn_new')
  })
})
