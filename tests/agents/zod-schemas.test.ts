import { describe, expect, it } from 'vitest'
import { agentSchema, channelOverrideSchema } from '@/lib/agents/zod-schemas'
import { AVAILABLE_MODELS } from '@/lib/agents/models'
import {
  AGENT_CHANNELS,
  AGENT_CHANNEL_LABELS,
  PUBLIC_AGENT_CHANNELS,
} from '@/lib/agents/channels'

const validPayload = {
  name: 'Sales Bot',
  slug: 'sales-bot',
  description: null,
  system_prompt: 'You are helpful.',
  model: 'anthropic/claude-sonnet-4-6' as const,
  fallback_message: 'Sorry.',
  max_history: 20,
  temperature: null,
  max_tokens: null,
  is_active: true,
  allowed_channels: ['web_widget'] as const,
  channel_overrides: {},
  tool_ids: [] as string[],
}

describe('AVAILABLE_MODELS', () => {
  it('contains the default model', () => {
    expect(AVAILABLE_MODELS).toContain('anthropic/claude-sonnet-4-6')
  })
  it('lists only Anthropic models (pricing catalog is Anthropic-only, not a provider limitation)', () => {
    expect(AVAILABLE_MODELS.length).toBeGreaterThan(0)
    for (const model of AVAILABLE_MODELS) {
      expect(model).toMatch(/^anthropic\//)
    }
  })
})

describe('AGENT_CHANNELS', () => {
  it('mirrors the agent_channel enum', () => {
    // Full domain = public picker channels + server-initiated 'workflow'
    // (added in migration 1132). Assert structurally so new channels only
    // need updating in channels.ts.
    expect(AGENT_CHANNELS).toEqual([...PUBLIC_AGENT_CHANNELS, 'workflow'])
    expect(AGENT_CHANNELS).toContain('web_widget')
    expect(AGENT_CHANNELS).toContain('whatsapp')
    expect(AGENT_CHANNELS).toContain('zernio')
    expect(PUBLIC_AGENT_CHANNELS).toContain('voice')
    expect(PUBLIC_AGENT_CHANNELS).not.toContain('workflow')
  })
  it('has a label for every channel', () => {
    expect(Object.keys(AGENT_CHANNEL_LABELS).sort()).toEqual(
      [...AGENT_CHANNELS].sort()
    )
  })
})

describe('agentSchema', () => {
  it('accepts a minimal valid payload', () => {
    const r = agentSchema.safeParse(validPayload)
    expect(r.success).toBe(true)
  })
  it('rejects empty name', () => {
    const r = agentSchema.safeParse({ ...validPayload, name: '' })
    expect(r.success).toBe(false)
  })
  it('rejects malformed slug', () => {
    const r = agentSchema.safeParse({ ...validPayload, slug: 'Bad Slug!' })
    expect(r.success).toBe(false)
  })
  it('rejects empty allowed_channels', () => {
    const r = agentSchema.safeParse({ ...validPayload, allowed_channels: [] })
    expect(r.success).toBe(false)
  })
  it('accepts voice with a voice-specific channel override', () => {
    const r = agentSchema.safeParse({
      ...validPayload,
      allowed_channels: ['voice'],
      channel_overrides: {
        voice: {
          system_prompt_suffix: 'Keep spoken answers concise.',
          model: 'anthropic/claude-haiku-4-5',
          max_history: 6,
        },
      },
    })
    expect(r.success).toBe(true)
  })
})

describe('channelOverrideSchema', () => {
  it('strips empty/undefined fields', () => {
    const r = channelOverrideSchema.parse({
      system_prompt_suffix: '',
      model: undefined,
      temperature: undefined,
      max_tokens: undefined,
      max_history: undefined,
    })
    expect(Object.keys(r)).toHaveLength(0)
  })
  it('preserves non-empty fields', () => {
    const r = channelOverrideSchema.parse({
      temperature: 0.5,
      model: 'anthropic/claude-haiku-4-5' as const,
    })
    expect(r).toEqual({ temperature: 0.5, model: 'anthropic/claude-haiku-4-5' })
  })
  it('rejects temperature out of range', () => {
    const r = channelOverrideSchema.safeParse({ temperature: 3 })
    expect(r.success).toBe(false)
  })
})
