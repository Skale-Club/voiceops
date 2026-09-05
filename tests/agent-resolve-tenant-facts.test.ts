// resolveAgent() is the one seam every runtime path resolves an agent
// through, and it must render a templated prompt's tenant-fact tokens before
// the model sees them. This exists because of a real regression: the
// tokenisation script (139-06) was run against the live Cuts & Culture org,
// and for about an hour the widget mesh introduced itself as "the front desk
// at {{business_name}}" — install-time rendering covered a TARGET org, and
// nothing covered the SOURCE org whose rows had just become templates.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))

vi.mock('@/lib/org-templates/prompt-template', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org-templates/prompt-template')>()
  return {
    ...actual,
    resolveTenantFacts: vi.fn(),
  }
})

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { resolveTenantFacts } from '@/lib/org-templates/prompt-template'
import { resolveAgent } from '@/lib/agent-runtime/resolve-agent'

function clientReturningPrompt(systemPrompt: string) {
  const agentRow = {
    id: 'agent-1',
    name: 'Front desk',
    model: 'anthropic/claude-sonnet-4.6',
    temperature: 0.3,
    max_tokens: 1024,
    max_history: 20,
    fallback_message: null,
    allowed_channels: ['web_widget', 'voice'],
    channel_overrides: null,
    is_active: true,
    active_prompt_version_id: 'v1',
    kb_scope: null,
    agent_prompt_versions: { id: 'v1', system_prompt: systemPrompt },
  }
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: agentRow, error: null }),
    })),
  }
}

beforeEach(() => {
  vi.mocked(resolveTenantFacts).mockReset()
  vi.mocked(resolveTenantFacts).mockResolvedValue({
    businessName: 'Acme Cuts',
    businessAddress: '1 Main Street, Springfield',
  })
})

describe('resolveAgent renders tenant-fact tokens at runtime', () => {
  it('replaces {{business_location}} and {{business_name}} with the tenant facts on every channel', async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue(
      clientReturningPrompt('You are the front desk at {{business_location}}. Say {{business_name}} when you answer.') as never
    )

    for (const channel of ['web_widget', 'voice'] as const) {
      const resolved = await resolveAgent('agent-1', 'org-1', channel)
      expect(resolved?.systemPrompt).toBe(
        'You are the front desk at Acme Cuts, 1 Main Street, Springfield. Say Acme Cuts when you answer.'
      )
      expect(resolved?.systemPrompt).not.toContain('{{')
    }
  })

  it('does not look up tenant facts for a prompt that carries no token', async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue(
      clientReturningPrompt('You are the front desk at Acme Cuts.') as never
    )

    const resolved = await resolveAgent('agent-1', 'org-1', 'web_widget')
    expect(resolved?.systemPrompt).toBe('You are the front desk at Acme Cuts.')
    expect(resolveTenantFacts).not.toHaveBeenCalled()
  })

  it("leaves Vapi's own call-time variables alone", async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue(
      clientReturningPrompt('{{business_name}}: call lookup_customer with {{customer.number}}; it is {{now}}.') as never
    )

    const resolved = await resolveAgent('agent-1', 'org-1', 'voice')
    expect(resolved?.systemPrompt).toBe('Acme Cuts: call lookup_customer with {{customer.number}}; it is {{now}}.')
  })
})
