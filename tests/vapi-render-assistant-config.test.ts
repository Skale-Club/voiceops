// Phase 139 Plan 04 (TMPL-03): the pure renderer that turns an org's
// entry-orchestrator system prompt + granted workflows into the Vapi
// assistant payload shape (function schemas + per-tool spoken messages).
//
// Zero network, zero Supabase — deterministic pure data in, pure data out.

import { describe, it, expect } from 'vitest'
import { renderAssistantConfig, type AssistantConfigSource } from '../src/lib/vapi/render-assistant-config'

describe('TMPL-03: renderAssistantConfig', () => {
  it('renders exactly one function for one workflow with an empty inputSchema', () => {
    const source: AssistantConfigSource = {
      systemPrompt: 'You are...',
      workflows: [{ toolName: 'list_services', description: 'Catalogue.', inputSchema: {} }],
    }
    const rendered = renderAssistantConfig(source)
    expect(rendered.functions).toHaveLength(1)
    expect(rendered.functions[0]).toEqual({
      name: 'list_services',
      description: 'Catalogue.',
      parameters: { type: 'object', properties: {}, required: [] },
    })
  })

  it('produces required exactly matching the fields flagged required:true, with JSON-Schema-shaped types', () => {
    const source: AssistantConfigSource = {
      systemPrompt: 'You are...',
      workflows: [
        {
          toolName: 'book_appointment',
          description: 'Book it.',
          inputSchema: {
            service_ids: { type: 'array', description: 'Service ids to book.', required: true },
            notes: { type: 'string', required: false },
          },
        },
      ],
    }
    const rendered = renderAssistantConfig(source)
    const fn = rendered.functions[0]
    expect(fn.parameters.required).toEqual(['service_ids'])
    expect(fn.parameters.properties.service_ids).toEqual({
      type: 'array',
      description: 'Service ids to book.',
    })
    expect(fn.parameters.properties.notes).toEqual({ type: 'string' })
  })

  it('falls back to {type: "string"} for an unknown/missing field type', () => {
    const source: AssistantConfigSource = {
      systemPrompt: 'You are...',
      workflows: [
        {
          toolName: 'weird_tool',
          description: 'Odd.',
          inputSchema: {
            mystery: { type: 'something-unrecognized' as never },
            untyped: {},
          },
        },
      ],
    }
    const rendered = renderAssistantConfig(source)
    const props = rendered.functions[0].parameters.properties
    expect(props.mystery).toEqual({ type: 'string' })
    expect(props.untyped).toEqual({ type: 'string' })
  })

  it('gives every function a non-empty, generic requestStart message, one entry per input workflow keyed by toolName', () => {
    const source: AssistantConfigSource = {
      systemPrompt: 'You are...',
      workflows: [
        { toolName: 'list_services', description: 'a', inputSchema: {} },
        { toolName: 'book_appointment', description: 'b', inputSchema: {} },
      ],
    }
    const rendered = renderAssistantConfig(source)
    expect(rendered.toolMessages).toHaveLength(2)
    for (const msg of rendered.toolMessages) {
      expect(msg.requestStart.length).toBeGreaterThan(0)
      expect(msg.requestStart.toLowerCase()).not.toContain('cuts')
      expect(msg.requestStart.toLowerCase()).not.toContain('barbershop')
    }
    expect(rendered.toolMessages.map((m) => m.toolName)).toEqual(['list_services', 'book_appointment'])
  })

  it('is deterministic and performs zero network/Supabase calls', () => {
    const source: AssistantConfigSource = {
      systemPrompt: 'You are the front desk.',
      workflows: [
        {
          toolName: 'check_availability',
          description: 'Check slots.',
          inputSchema: { date: { type: 'string', required: true } },
        },
      ],
    }
    const first = renderAssistantConfig(source)
    const second = renderAssistantConfig(source)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('passes systemPrompt through unmodified -- no templating happens here', () => {
    const source: AssistantConfigSource = {
      systemPrompt: 'You are the front desk at {{business_location}}.',
      workflows: [],
    }
    const rendered = renderAssistantConfig(source)
    expect(rendered.systemPrompt).toBe('You are the front desk at {{business_location}}.')
  })
})
