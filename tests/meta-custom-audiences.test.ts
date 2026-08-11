import { describe, it, expect, vi, beforeEach } from 'vitest'
import { META_ADS_GRAPH_VERSION } from '@/lib/ads/meta-oauth'

// Mock global fetch before importing the module under test.
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function okBatch() {
  return {
    ok: true,
    json: async () => ({ num_received: 1, num_invalid_entries: 0 }),
  }
}

describe('META-audiences: syncUsersToAudience ADD/REMOVE HTTP method', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("ADD issues an HTTP POST to /{audience_id}/users with the hashed payload", async () => {
    mockFetch.mockResolvedValueOnce(okBatch())
    const { syncUsersToAudience } = await import('@/lib/meta/custom-audiences')

    const result = await syncUsersToAudience(
      'aud_123',
      'tok',
      [{ email: 'a@b.com', phone: null }],
      'ADD',
    )

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toBe(`https://graph.facebook.com/${META_ADS_GRAPH_VERSION}/aud_123/users`)
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body.payload.schema).toEqual(['EMAIL_SHA256', 'PHONE_SHA256'])
    expect(body.payload.data).toHaveLength(1)
    expect(body.payload.data[0]).toEqual([
      'fb98d44ad7501a959f3f4f4a3f004fe2d9e581ea6207e218c4b02c08a4d75adf',
      '',
    ])
    expect(body.access_token).toBe('tok')
    expect(result).toEqual({ sent: 1, invalid: 0 })
  })

  it("REMOVE issues an HTTP DELETE (not POST) to /{audience_id}/users with the same hashed payload", async () => {
    mockFetch.mockResolvedValueOnce(okBatch())
    const { syncUsersToAudience } = await import('@/lib/meta/custom-audiences')

    await syncUsersToAudience(
      'aud_123',
      'tok',
      [{ email: 'opted-out@b.com', phone: null }],
      'REMOVE',
    )

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toContain('/aud_123/users')
    // The compliance fix: REMOVE must DELETE, otherwise opted-out contacts are
    // silently re-ADDed to the ad audience.
    expect(init.method).toBe('DELETE')
    const body = JSON.parse(init.body as string)
    expect(body.payload.schema).toEqual(['EMAIL_SHA256', 'PHONE_SHA256'])
    expect(body.payload.data).toHaveLength(1)
  })

  it('returns early without any HTTP call when there is nothing hashable to sync', async () => {
    const { syncUsersToAudience } = await import('@/lib/meta/custom-audiences')

    const result = await syncUsersToAudience('aud_123', 'tok', [{ email: null, phone: null }], 'REMOVE')

    expect(mockFetch).not.toHaveBeenCalled()
    expect(result).toEqual({ sent: 0, invalid: 0 })
  })

  it('creates a v26 CUSTOM audience using the current CustomerFileSource enum', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'aud_new' }) })
    const { createCustomAudience } = await import('@/lib/meta/custom-audiences')

    await createCustomAudience('act_123', 'tok', { name: 'Skale Club - Xcraper Prospects' })

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toBe(
      `https://graph.facebook.com/${META_ADS_GRAPH_VERSION}/act_123/customaudiences`,
    )
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      subtype: 'CUSTOM',
      customer_file_source: 'USER_PROVIDED_ONLY',
    })
  })

  it('maps Graph errors to safe typed metadata and redacts tokens and hashes', async () => {
    const token = 'fixture-super-secret-token'
    const requestHash = 'a'.repeat(64)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          code: 190,
          message: `Invalid token ${token}; rejected identifier ${requestHash}`,
        },
      }),
    })
    const { syncHashedUsersToAudience } = await import('@/lib/meta/custom-audiences')
    const { MetaGraphRequestError } = await import('@/lib/meta/graph')

    let caught: unknown
    try {
      await syncHashedUsersToAudience(
        'aud_123',
        token,
        [{ emailHash: requestHash, phoneHash: null }],
        'ADD',
      )
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(MetaGraphRequestError)
    expect(caught).toMatchObject({ status: 400, code: 190 })
    expect(String(caught)).toContain('Meta Graph error 190')
    expect(String(caught)).not.toContain(token)
    expect(String(caught)).not.toContain(requestHash)
  })

  it('maps network failures without exposing a token-bearing URL', async () => {
    const token = 'fixture-network-token'
    mockFetch.mockRejectedValueOnce(new Error(`failed URL access_token=${token}`))
    const { getAudienceStatus } = await import('@/lib/meta/custom-audiences')

    let caught: unknown
    try {
      await getAudienceStatus('aud_123', token)
    } catch (error) {
      caught = error
    }
    expect(caught).toMatchObject({
      status: 0,
      code: null,
      message: 'Meta Graph network request failed',
    })
    expect(String(caught)).not.toContain(token)
  })
})
