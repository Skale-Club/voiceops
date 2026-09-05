// Phase 139 Plan 04 (TMPL-03): the pure renderer that turns an org's
// entry-orchestrator system prompt + granted workflows into the Vapi
// assistant payload shape (function schemas + per-tool spoken messages).
//
// Zero network, zero Supabase — deterministic pure data in, pure data out.
//
// Extended for MODAL-03: the renderer now places the engine-rendered service
// location rule into the prompt, so the voice channel stops carrying "do not
// ask for an address" as static text inside Vapi, and preserves an
// assistant's already-tuned per-tool spoken lines instead of flattening them.

import { describe, it, expect } from 'vitest'
import {
  renderAssistantConfig,
  SERVICE_LOCATION_TOKEN,
  type AssistantConfigSource,
} from '../src/lib/vapi/render-assistant-config'

/** Every source needs a mode; these tests default to the safest one. */
function source(partial: Partial<AssistantConfigSource>): AssistantConfigSource {
  return {
    systemPrompt: 'You are...',
    workflows: [],
    serviceLocationMode: 'on_premises',
    ...partial,
  }
}

describe('TMPL-03: renderAssistantConfig', () => {
  it('renders exactly one function for one workflow with an empty inputSchema', () => {
    const rendered = renderAssistantConfig(
      source({ workflows: [{ toolName: 'list_services', description: 'Catalogue.', inputSchema: {} }] })
    )
    expect(rendered.functions).toHaveLength(1)
    expect(rendered.functions[0]).toEqual({
      name: 'list_services',
      description: 'Catalogue.',
      parameters: { type: 'object', properties: {}, required: [] },
    })
  })

  it('produces required exactly matching the fields flagged required:true, with JSON-Schema-shaped types', () => {
    const rendered = renderAssistantConfig(
      source({
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
      })
    )
    const fn = rendered.functions[0]
    expect(fn.parameters.required).toEqual(['service_ids'])
    expect(fn.parameters.properties.service_ids).toEqual({
      type: 'array',
      description: 'Service ids to book.',
    })
    expect(fn.parameters.properties.notes).toEqual({ type: 'string' })
  })

  it('falls back to {type: "string"} for an unknown/missing field type', () => {
    const rendered = renderAssistantConfig(
      source({
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
      })
    )
    const props = rendered.functions[0].parameters.properties
    expect(props.mystery).toEqual({ type: 'string' })
    expect(props.untyped).toEqual({ type: 'string' })
  })

  it('gives every function a non-empty, generic request-start message when the assistant has none', () => {
    const rendered = renderAssistantConfig(
      source({
        workflows: [
          { toolName: 'list_services', description: 'a', inputSchema: {} },
          { toolName: 'book_appointment', description: 'b', inputSchema: {} },
        ],
      })
    )
    expect(rendered.toolMessages).toHaveLength(2)
    for (const msg of rendered.toolMessages) {
      expect(msg.messages).toHaveLength(1)
      expect(msg.messages[0].type).toBe('request-start')
      expect(msg.messages[0].content.length).toBeGreaterThan(0)
      expect(msg.messages[0].content.toLowerCase()).not.toContain('cuts')
      expect(msg.messages[0].content.toLowerCase()).not.toContain('barbershop')
    }
    expect(rendered.toolMessages.map((m) => m.toolName)).toEqual(['list_services', 'book_appointment'])
  })

  it('is deterministic and performs zero network/Supabase calls', () => {
    const src = source({
      systemPrompt: 'You are the front desk.',
      workflows: [
        {
          toolName: 'check_availability',
          description: 'Check slots.',
          inputSchema: { date: { type: 'string', required: true } },
        },
      ],
    })
    expect(JSON.stringify(renderAssistantConfig(src))).toBe(JSON.stringify(renderAssistantConfig(src)))
  })

  it('does not template tenant facts -- those are frozen at install time, not at push time', () => {
    const rendered = renderAssistantConfig(
      source({ systemPrompt: 'You are the front desk at {{business_location}}.' })
    )
    expect(rendered.systemPrompt).toContain('You are the front desk at {{business_location}}.')
  })
})

describe('MODAL-03: the service location rule is rendered, never hardcoded', () => {
  it('substitutes the token in place, leaving the rest of the prompt untouched', () => {
    const rendered = renderAssistantConfig(
      source({
        systemPrompt: `## Where\n${SERVICE_LOCATION_TOKEN}\n\n## Voice\nShort sentences.`,
        serviceLocationMode: 'at_customer',
      })
    )
    expect(rendered.systemPrompt).not.toContain(SERVICE_LOCATION_TOKEN)
    expect(rendered.systemPrompt).toContain('travels to the customer')
    expect(rendered.systemPrompt).toContain('## Voice\nShort sentences.')
  })

  it('appends the rule as its own section when the prompt declares no token', () => {
    const rendered = renderAssistantConfig(
      source({ systemPrompt: 'You are the front desk.', serviceLocationMode: 'at_customer' })
    )
    expect(rendered.systemPrompt).toContain('You are the front desk.')
    expect(rendered.systemPrompt).toContain('## Service location')
    expect(rendered.systemPrompt).toContain('travels to the customer')
  })

  it('renders each mode with its own rule', () => {
    const on = renderAssistantConfig(source({ serviceLocationMode: 'on_premises' })).systemPrompt
    const at = renderAssistantConfig(source({ serviceLocationMode: 'at_customer' })).systemPrompt
    const either = renderAssistantConfig(source({ serviceLocationMode: 'either' })).systemPrompt

    expect(on).toContain('Never ask for, collect, or record a customer address')
    expect(at).toContain('book_appointment requires this address')
    expect(either).toContain('Is this at the shop, or are we coming to you?')
  })

  it('fails closed: an unrecognised, null or missing mode renders the on_premises rule, never no rule', () => {
    for (const mode of ['ON_PREMISES', 'travelling', '', null, undefined, 42]) {
      const rendered = renderAssistantConfig(source({ serviceLocationMode: mode }))
      expect(rendered.systemPrompt).toContain('Never ask for, collect, or record a customer address')
      expect(rendered.systemPrompt).not.toContain('travels to the customer')
    }
  })

  it('a prompt can never come out with no location rule at all', () => {
    for (const prompt of ['', 'x', 'ends with newline\n', `token: ${SERVICE_LOCATION_TOKEN}`]) {
      const rendered = renderAssistantConfig(source({ systemPrompt: prompt }))
      expect(rendered.systemPrompt).toContain('Service location:')
    }
  })
})

describe('MODAL-03: tuned per-tool lines survive a push', () => {
  const workflows = [
    { toolName: 'check_availability', description: 'a', inputSchema: {} },
    { toolName: 'list_services', description: 'b', inputSchema: {} },
  ]

  it('keeps every existing message verbatim, including delayed and failed lines', () => {
    const existing = {
      check_availability: [
        { type: 'request-start', content: 'Let me look at the book for you, one moment.' },
        { type: 'request-response-delayed', content: 'Still checking, bear with me.', timingMilliseconds: 4000 },
      ],
    }
    const rendered = renderAssistantConfig(source({ workflows, existingToolMessages: existing }))
    const availability = rendered.toolMessages.find((m) => m.toolName === 'check_availability')
    expect(availability?.messages).toEqual(existing.check_availability)
  })

  it('uses the generic fallback only for a tool the assistant has no message for', () => {
    const rendered = renderAssistantConfig(
      source({
        workflows,
        existingToolMessages: {
          check_availability: [{ type: 'request-start', content: 'Let me look at the book.' }],
        },
      })
    )
    const services = rendered.toolMessages.find((m) => m.toolName === 'list_services')
    expect(services?.messages).toEqual([{ type: 'request-start', content: 'One moment.' }])
  })

  it('treats an empty message array as absent rather than as a deliberate silence', () => {
    const rendered = renderAssistantConfig(
      source({ workflows, existingToolMessages: { list_services: [] } })
    )
    const services = rendered.toolMessages.find((m) => m.toolName === 'list_services')
    expect(services?.messages[0].content).toBe('One moment.')
  })
})
