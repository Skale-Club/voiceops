import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))

import { createServiceRoleClient } from '@/lib/supabase/admin'

const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(),
}

describe('GET /api/widget/[token]/config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    ;(createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabase)
    mockSupabase.from.mockReturnThis()
    mockSupabase.select.mockReturnThis()
    mockSupabase.eq.mockReturnThis()
  })

  it('returns configured public widget fields for a valid active token', async () => {
    mockSupabase.single.mockResolvedValue({
      data: {
        is_active: true,
        widget_display_name: 'Support Bot',
        widget_primary_color: '#0F172A',
        widget_welcome_message: 'How can we help today?',
      },
      error: null,
    })

    const { GET } = await import('@/app/api/widget/[token]/config/route')
    const response = await GET(new Request('http://localhost/api/widget/valid-token/config'), {
      params: Promise.resolve({ token: 'valid-token' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      displayName: 'Support Bot',
      primaryColor: '#0F172A',
      welcomeMessage: 'How can we help today?',
    })
    expect(mockSupabase.select).toHaveBeenCalledWith(
      'is_active, widget_display_name, widget_primary_color, widget_welcome_message'
    )
  })

  it('returns 401 for an invalid token', async () => {
    mockSupabase.single.mockResolvedValue({ data: null, error: { message: 'not found' } })

    const { GET } = await import('@/app/api/widget/[token]/config/route')
    const response = await GET(new Request('http://localhost/api/widget/bad-token/config'), {
      params: Promise.resolve({ token: 'bad-token' }),
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Invalid or inactive token' })
  })

  it('returns 401 for an inactive org', async () => {
    mockSupabase.single.mockResolvedValue({
      data: {
        is_active: false,
        widget_display_name: 'Support Bot',
        widget_primary_color: '#0F172A',
        widget_welcome_message: 'How can we help today?',
      },
      error: null,
    })

    const { GET } = await import('@/app/api/widget/[token]/config/route')
    const response = await GET(new Request('http://localhost/api/widget/inactive-token/config'), {
      params: Promise.resolve({ token: 'inactive-token' }),
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Invalid or inactive token' })
  })

  it('normalizes null and blank values to widget defaults', async () => {
    mockSupabase.single.mockResolvedValue({
      data: {
        is_active: true,
        widget_display_name: '   ',
        widget_primary_color: null,
        widget_welcome_message: '',
      },
      error: null,
    })

    const { GET, DEFAULT_WIDGET_CONFIG } = await import('@/app/api/widget/[token]/config/route')
    const response = await GET(new Request('http://localhost/api/widget/defaults-token/config'), {
      params: Promise.resolve({ token: 'defaults-token' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(DEFAULT_WIDGET_CONFIG)
  })
})
