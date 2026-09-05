// The warm customer lookup on the voice path: the calls route starts it when
// the call is answered, the tools route reads through the same key, so the
// robot's first reply is not waiting on the provider.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/action-engine/resolve-tool', () => ({ resolveTool: vi.fn() }))
vi.mock('@/lib/action-engine/execute-action', () => ({ executeAction: vi.fn() }))
vi.mock('@/lib/crypto', () => ({ decrypt: vi.fn(async (v: string) => `dec:${v}`) }))

import { resolveTool } from '@/lib/action-engine/resolve-tool'
import { executeAction } from '@/lib/action-engine/execute-action'
import { memoTtl, clearMemo } from '@/lib/cache/ttl-memo'
import {
  customerLookupKey,
  normalisePhone,
  warmCustomerLookup,
  CUSTOMER_LOOKUP_TTL_MS,
} from '@/lib/vapi/customer-lookup-cache'

const supabase = {} as never

beforeEach(() => {
  clearMemo()
  vi.mocked(resolveTool).mockReset()
  vi.mocked(executeAction).mockReset()
})

describe('customer lookup key', () => {
  it('normalises the phone so Vapi and the model agree on one key', () => {
    expect(normalisePhone('+1 (224) 551-6131')).toBe('+12245516131')
    expect(normalisePhone('2245516131')).toBe('2245516131')
    expect(customerLookupKey('org-1', '+1 (224) 551-6131')).toBe(customerLookupKey('org-1', '+12245516131'))
  })

  it('never lets two organizations share a caller', () => {
    expect(customerLookupKey('org-1', '+12245516131')).not.toBe(customerLookupKey('org-2', '+12245516131'))
  })
})

describe('warmCustomerLookup', () => {
  it('runs the real lookup action once and the tool route finds it waiting under the same key', async () => {
    vi.mocked(resolveTool).mockResolvedValue({
      action_type: 'xkedule_lookup_customer',
      config: {},
      integrations: { encrypted_api_key: 'k', location_id: 'https://demo', provider: 'xkedule' },
    } as never)
    vi.mocked(executeAction).mockResolvedValue('Found customer: Paulo')

    await warmCustomerLookup('org-1', '+1 (224) 551-6131', supabase)

    const fromToolRoute = await memoTtl(customerLookupKey('org-1', '+12245516131'), CUSTOMER_LOOKUP_TTL_MS, async () => {
      throw new Error('the tool route should not have to run the lookup itself')
    })
    expect(fromToolRoute).toBe('Found customer: Paulo')
    expect(executeAction).toHaveBeenCalledTimes(1)
    expect(vi.mocked(executeAction).mock.calls[0][0]).toBe('xkedule_lookup_customer')
    expect(vi.mocked(executeAction).mock.calls[0][1]).toEqual({ phone: '+1 (224) 551-6131' })
  })

  it('swallows every failure and caches nothing for it', async () => {
    vi.mocked(resolveTool).mockResolvedValue(null)
    await expect(warmCustomerLookup('org-1', '+12245516131', supabase)).resolves.toBeUndefined()

    vi.mocked(resolveTool).mockResolvedValue({ action_type: 'xkedule_lookup_customer', config: {}, integrations: null } as never)
    vi.mocked(executeAction).mockRejectedValueOnce(new Error('provider down')).mockResolvedValueOnce('Found customer: later')
    await expect(warmCustomerLookup('org-1', '+12245516131', supabase)).resolves.toBeUndefined()

    const later = await memoTtl(customerLookupKey('org-1', '+12245516131'), CUSTOMER_LOOKUP_TTL_MS, () =>
      executeAction('xkedule_lookup_customer', { phone: '+12245516131' }, { apiKey: '', locationId: '' }, {} as never)
    )
    expect(later).toBe('Found customer: later')
  })

  it('refuses to warm through a tool that is not the customer lookup', async () => {
    vi.mocked(resolveTool).mockResolvedValue({ action_type: 'xkedule_create_booking', config: {}, integrations: null } as never)
    await warmCustomerLookup('org-1', '+12245516131', supabase)
    expect(executeAction).not.toHaveBeenCalled()
  })
})
