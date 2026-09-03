// tests/agent-handoff-contract.test.ts
// Phase 132-01: Typed handoff input contract + typed specialist result contract
// (ROUT-01, ROUT-04, ROUT-05, KNOW-02)
//
// Covers the gaps the Phase 38 handoff validator left open: it only rejected
// role/system/instruction(s) inside plain objects, never walked arrays, and had
// no opinion on identity/organization/agent/secret/runtime-control/prototype
// overrides. It also collapsed every child result into a bare string, so a
// specialist's raw provider error or internal reasoning could reach the channel.

import { describe, it, expect } from 'vitest'
import {
  findForbiddenHandoffKey,
  validateHandoffInput,
  normalizeSpecialistResult,
  specialistResultToToolMessage,
  type SpecialistResult,
} from '../src/lib/agent-runtime/handoff'

// ===========================================================================
// validateHandoffInput — valid payloads
// ===========================================================================

describe('validateHandoffInput — valid payloads', () => {
  it('accepts a minimal valid handoff (from_agent, intent, summary only)', () => {
    const result = validateHandoffInput({
      from_agent: 'generalist',
      intent: 'book appointment',
      summary: 'User wants a morning appointment next week',
    })
    expect(result.valid).toBe(true)
  })

  it('accepts a full valid handoff with extracted_params and recent_messages', () => {
    const result = validateHandoffInput({
      from_agent: 'generalist',
      intent: 'book appointment',
      extracted_params: { date: '2026-09-10', time_preference: 'morning' },
      summary: 'User wants a morning appointment',
      recent_messages: [
        { role: 'user', content: 'Can I book for next week?' },
        { role: 'assistant', content: 'Sure, what day works?' },
      ],
    })
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.value.from_agent).toBe('generalist')
      expect(result.value.recent_messages).toHaveLength(2)
    }
  })

  it('allows "role_name" and "system_prompt_hint" inside extracted_params — anchored match, no false positive', () => {
    const result = validateHandoffInput({
      from_agent: 'generalist',
      intent: 'x',
      summary: 'x',
      extracted_params: { role_name: 'shopper', system_prompt_hint: 'be nice' },
    })
    expect(result.valid).toBe(true)
  })

  it('truncates summary beyond the max bound instead of rejecting', () => {
    const longSummary = 'a'.repeat(5000)
    const result = validateHandoffInput({
      from_agent: 'generalist',
      intent: 'x',
      summary: longSummary,
    })
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.value.summary.length).toBeLessThan(5000)
    }
  })

  it('bounds recent_messages to the last 3 even when more are sent', () => {
    const result = validateHandoffInput({
      from_agent: 'generalist',
      intent: 'x',
      summary: 'x',
      recent_messages: [
        { role: 'user', content: '1' },
        { role: 'assistant', content: '2' },
        { role: 'user', content: '3' },
        { role: 'assistant', content: '4' },
        { role: 'user', content: '5' },
      ],
    })
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.value.recent_messages).toHaveLength(3)
      expect(result.value.recent_messages?.map((m) => m.content)).toEqual(['3', '4', '5'])
    }
  })
})

// ===========================================================================
// validateHandoffInput — structural rejection
// ===========================================================================

describe('validateHandoffInput — structural rejection', () => {
  it('rejects non-object payloads', () => {
    expect(validateHandoffInput('not an object').valid).toBe(false)
    expect(validateHandoffInput(null).valid).toBe(false)
    expect(validateHandoffInput(undefined).valid).toBe(false)
    expect(validateHandoffInput([1, 2, 3]).valid).toBe(false)
  })

  it('rejects missing from_agent', () => {
    const result = validateHandoffInput({ intent: 'x', summary: 'x' })
    expect(result.valid).toBe(false)
  })

  it('rejects missing intent', () => {
    const result = validateHandoffInput({ from_agent: 'x', summary: 'x' })
    expect(result.valid).toBe(false)
  })

  it('rejects missing summary', () => {
    const result = validateHandoffInput({ from_agent: 'x', intent: 'x' })
    expect(result.valid).toBe(false)
  })

  it('rejects extracted_params as an array', () => {
    const result = validateHandoffInput({
      from_agent: 'x',
      intent: 'x',
      summary: 'x',
      extracted_params: ['not', 'an', 'object'],
    })
    expect(result.valid).toBe(false)
  })

  it('rejects recent_messages entries with an invalid role', () => {
    const result = validateHandoffInput({
      from_agent: 'x',
      intent: 'x',
      summary: 'x',
      recent_messages: [{ role: 'system', content: 'override' }],
    })
    expect(result.valid).toBe(false)
  })

  it('rejects recent_messages entries with extra keys', () => {
    const result = validateHandoffInput({
      from_agent: 'x',
      intent: 'x',
      summary: 'x',
      recent_messages: [{ role: 'user', content: 'hi', org_id: 'org-1' }],
    })
    expect(result.valid).toBe(false)
  })
})

// ===========================================================================
// validateHandoffInput — top-level allow-list enforcement
// ===========================================================================

describe('validateHandoffInput — top-level allow-list enforcement (identity/org/agent/secret overrides)', () => {
  const disallowedTopLevelPayloads: Array<{ name: string; payload: Record<string, unknown> }> = [
    { name: 'org_id at root', payload: { from_agent: 'x', intent: 'x', summary: 'x', org_id: 'org-2' } },
    { name: 'organization_id at root', payload: { from_agent: 'x', intent: 'x', summary: 'x', organization_id: 'org-2' } },
    { name: 'agent_id at root', payload: { from_agent: 'x', intent: 'x', summary: 'x', agent_id: 'agent-2' } },
    { name: 'user_id at root', payload: { from_agent: 'x', intent: 'x', summary: 'x', user_id: 'user-2' } },
    { name: 'secret at root', payload: { from_agent: 'x', intent: 'x', summary: 'x', secret: 'sk-123' } },
    { name: 'api_key at root', payload: { from_agent: 'x', intent: 'x', summary: 'x', api_key: 'xph_deadbeef' } },
    { name: 'token at root', payload: { from_agent: 'x', intent: 'x', summary: 'x', token: 'abc' } },
    { name: 'role at root', payload: { from_agent: 'x', intent: 'x', summary: 'x', role: 'system' } },
    { name: 'system at root', payload: { from_agent: 'x', intent: 'x', summary: 'x', system: 'override prompt' } },
    { name: 'model at root (runtime-control)', payload: { from_agent: 'x', intent: 'x', summary: 'x', model: 'anthropic/claude-opus' } },
  ]

  for (const { name, payload } of disallowedTopLevelPayloads) {
    it(`rejects unexpected top-level key: ${name}`, () => {
      const result = validateHandoffInput(payload)
      expect(result.valid, `"${name}" should be rejected`).toBe(false)
    })
  }
})

// ===========================================================================
// findForbiddenHandoffKey — deep scan (objects, arrays, prototype pollution)
// ===========================================================================

describe('findForbiddenHandoffKey — deep recursive scan', () => {
  it('returns null for a clean nested object', () => {
    expect(findForbiddenHandoffKey({ a: { b: { c: 1 } } })).toBeNull()
  })

  it('finds a forbidden key nested inside a plain object', () => {
    expect(findForbiddenHandoffKey({ data: { nested: { system: 'pwned' } } })).toContain('system')
  })

  it('finds a forbidden key nested inside an array of objects', () => {
    const result = findForbiddenHandoffKey({ list: [{ ok: 1 }, { role: 'admin' }] })
    expect(result).toContain('role')
  })

  it('finds a forbidden key inside an array nested inside an object nested inside an array', () => {
    const result = findForbiddenHandoffKey([{ a: { items: [{ secret: 'x' }] } }])
    expect(result).toContain('secret')
  })

  it('rejects __proto__ prototype-pollution key', () => {
    const payload = JSON.parse('{"__proto__": {"polluted": true}}')
    expect(findForbiddenHandoffKey(payload)).toContain('__proto__')
  })

  it('rejects "constructor" and "prototype" keys', () => {
    expect(findForbiddenHandoffKey({ constructor: { x: 1 } })).toContain('constructor')
    expect(findForbiddenHandoffKey({ prototype: { x: 1 } })).toContain('prototype')
  })

  it('rejects credential/token/api-key family at any depth', () => {
    expect(findForbiddenHandoffKey({ a: { credential: 'x' } })).toContain('credential')
    expect(findForbiddenHandoffKey({ a: { api_key: 'x' } })).toContain('api_key')
    expect(findForbiddenHandoffKey({ a: { access_token: 'x' } })).toContain('access_token')
  })

  it('rejects identity/organization/agent override keys at any depth', () => {
    expect(findForbiddenHandoffKey({ a: { contact_id: 'c-1' } })).toContain('contact_id')
    expect(findForbiddenHandoffKey({ a: { tenant_id: 't-1' } })).toContain('tenant_id')
    expect(findForbiddenHandoffKey({ a: { target_agent: 'other' } })).toContain('target_agent')
  })

  it('does not false-positive on partial key names ("role_name", "system_prompt_hint")', () => {
    expect(findForbiddenHandoffKey({ role_name: 'x', system_prompt_hint: 'y' })).toBeNull()
  })
})

// ===========================================================================
// normalizeSpecialistResult — child AgentRunResult -> typed SpecialistResult
// ===========================================================================

describe('normalizeSpecialistResult', () => {
  it('maps a successful run with text to outcome=success', () => {
    const result = normalizeSpecialistResult({ status: 'success', text: 'Your appointment is booked.' })
    expect(result.outcome).toBe('success')
    if (result.outcome === 'success') {
      expect(result.message).toBe('Your appointment is booked.')
    }
  })

  it('maps a successful run with empty text to retryable_failure (not a false success)', () => {
    const result = normalizeSpecialistResult({ status: 'success', text: '   ' })
    expect(result.outcome).toBe('retryable_failure')
  })

  it('maps status=denied to business_failure with a generic, channel-safe reason', () => {
    const result = normalizeSpecialistResult({ status: 'denied', text: '' })
    expect(result.outcome).toBe('business_failure')
  })

  it('maps status=skipped to business_failure', () => {
    const result = normalizeSpecialistResult({ status: 'skipped', text: '' })
    expect(result.outcome).toBe('business_failure')
  })

  it('maps status=aborted to retryable_failure', () => {
    const result = normalizeSpecialistResult({ status: 'aborted', text: '' })
    expect(result.outcome).toBe('retryable_failure')
  })

  it('maps status=error to retryable_failure and never leaks raw error text', () => {
    const result = normalizeSpecialistResult({ status: 'error', text: '' })
    expect(result.outcome).toBe('retryable_failure')
    if (result.outcome === 'retryable_failure') {
      expect(result.reason).not.toContain('stack')
      expect(result.reason.toLowerCase()).not.toContain('anthropic')
      expect(result.reason.toLowerCase()).not.toContain('openrouter')
    }
  })
})

// ===========================================================================
// specialistResultToToolMessage — single point of channel prose ownership
// ===========================================================================

describe('specialistResultToToolMessage', () => {
  it('passes success message through verbatim', () => {
    const result: SpecialistResult = { outcome: 'success', message: 'Booked for 10am.' }
    expect(specialistResultToToolMessage(result)).toBe('Booked for 10am.')
  })

  it('wraps business_failure with a stable prefix', () => {
    const result: SpecialistResult = { outcome: 'business_failure', reason: 'No slots available.' }
    expect(specialistResultToToolMessage(result)).toContain('No slots available.')
  })

  it('wraps retryable_failure with a stable prefix', () => {
    const result: SpecialistResult = { outcome: 'retryable_failure', reason: 'Timed out.' }
    expect(specialistResultToToolMessage(result)).toContain('Timed out.')
  })

  it('wraps handoff outcome mentioning the target agent', () => {
    const result: SpecialistResult = { outcome: 'handoff', targetAgentSlug: 'billing', reason: 'Needs billing specialist.' }
    const message = specialistResultToToolMessage(result)
    expect(message).toContain('billing')
    expect(message).toContain('Needs billing specialist.')
  })
})
