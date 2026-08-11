import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 99, resetAt: 0 }),
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
        widget_avatar_url: 'https://example.com/avatar.png',
        widget_position: 'top-left',
        widget_offset_x: 48,
        widget_offset_y: 64,
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
      avatarUrl: 'https://example.com/avatar.png',
      greetingEnabled: true,
      greetingMessage: 'How can we help today?',
      greetingDelaySeconds: 3,
      position: 'top-left',
      offsetX: 48,
      offsetY: 64,
    })
    expect(mockSupabase.select).toHaveBeenCalledWith(
      'is_active, widget_display_name, widget_primary_color, widget_welcome_message, widget_avatar_url, accent_color, widget_greeting_enabled, widget_greeting_message, widget_greeting_delay_seconds, widget_url_mode, widget_url_rules, widget_position, widget_offset_x, widget_offset_y'
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
        widget_avatar_url: null,
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
        widget_avatar_url: null,
      },
      error: null,
    })

    const { GET } = await import('@/app/api/widget/[token]/config/route')
    const response = await GET(new Request('http://localhost/api/widget/defaults-token/config'), {
      params: Promise.resolve({ token: 'defaults-token' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      displayName: 'AI Assistant',
      primaryColor: '#18181B',
      welcomeMessage: 'Hi! How can I help?',
      avatarUrl: null,
      greetingEnabled: true,
      greetingMessage: 'Hi! How can I help?',
      greetingDelaySeconds: 3,
      // Placement columns absent (pre-1269 row) → the historical hardcoded anchor.
      position: 'bottom-right',
      offsetX: 20,
      offsetY: 20,
    })
  })

  it('rejects an unknown position and clamps out-of-range spacing', async () => {
    mockSupabase.single.mockResolvedValue({
      data: {
        is_active: true,
        widget_display_name: 'Bot',
        widget_welcome_message: 'Hello',
        widget_position: 'diagonal-somewhere',
        widget_offset_x: 9999,
        widget_offset_y: -40,
      },
      error: null,
    })

    const { GET } = await import('@/app/api/widget/[token]/config/route')
    const response = await GET(new Request('http://localhost/api/widget/odd-token/config'), {
      params: Promise.resolve({ token: 'odd-token' }),
    })

    const body = await response.json()
    expect(body.position).toBe('bottom-right')
    expect(body.offsetX).toBe(200)
    expect(body.offsetY).toBe(0)
  })

  it('zeroes vertical spacing for a middle anchor, which centers on the viewport', async () => {
    mockSupabase.single.mockResolvedValue({
      data: {
        is_active: true,
        widget_display_name: 'Bot',
        widget_welcome_message: 'Hello',
        widget_position: 'middle-left',
        widget_offset_x: 32,
        widget_offset_y: 80,
      },
      error: null,
    })

    const { GET } = await import('@/app/api/widget/[token]/config/route')
    const response = await GET(new Request('http://localhost/api/widget/middle-token/config'), {
      params: Promise.resolve({ token: 'middle-token' }),
    })

    const body = await response.json()
    expect(body.position).toBe('middle-left')
    expect(body.offsetX).toBe(32)
    expect(body.offsetY).toBe(0)
  })
})
