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
  BUSINESS_HOURS_TOKEN,
  type AssistantConfigSource,
  type BusinessHours,
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

  it('after a live read, a tool with no message stays silent (lookup, prepare calls)', () => {
    const rendered = renderAssistantConfig(
      source({
        workflows,
        existingToolMessages: {
          check_availability: [{ type: 'request-start', content: 'Let me look at the book.' }],
        },
      })
    )
    const services = rendered.toolMessages.find((m) => m.toolName === 'list_services')
    expect(services?.messages).toEqual([])
  })

  it('an explicitly empty message array is a deliberate silence', () => {
    const rendered = renderAssistantConfig(
      source({ workflows, existingToolMessages: { list_services: [] } })
    )
    const services = rendered.toolMessages.find((m) => m.toolName === 'list_services')
    expect(services?.messages).toEqual([])
  })

  it('without any live read, every tool gets the generic fallback', () => {
    const rendered = renderAssistantConfig(source({ workflows }))
    const services = rendered.toolMessages.find((m) => m.toolName === 'list_services')
    expect(services?.messages).toEqual([{ type: 'request-start', content: 'One moment.' }])
  })
})

describe('C: opening hours rendered from businessHours, never invented', () => {
  const fullWeek: BusinessHours = {
    timezone: 'America/New_York',
    days: {
      monday: { open: true, start: '09:00', end: '18:00' },
      tuesday: { open: true, start: '09:00', end: '18:00' },
      wednesday: { open: true, start: '09:00', end: '18:00' },
      thursday: { open: true, start: '09:00', end: '18:00' },
      friday: { open: true, start: '09:00', end: '18:00' },
      saturday: { open: true, start: '09:00', end: '17:00' },
      sunday: { open: false },
    },
  }

  it('groups identical consecutive days into one spoken range', () => {
    const rendered = renderAssistantConfig(source({ businessHours: fullWeek }))
    expect(rendered.systemPrompt).toContain(
      'Monday to Friday 9 AM to 6 PM, Saturday 9 AM to 5 PM, Sunday closed'
    )
  })

  it('states the open/closed-comes-only-from-hours-and-clock rule, and that availability comes only from the tool', () => {
    const rendered = renderAssistantConfig(source({ businessHours: fullWeek }))
    expect(rendered.systemPrompt).toContain('comes ONLY from')
    expect(rendered.systemPrompt).toContain("these hours combined with today's date and time")
    expect(rendered.systemPrompt).toContain('Availability for booking comes ONLY from check_availability')
  })

  it('formats a non-hour boundary without a leading zero', () => {
    const rendered = renderAssistantConfig(
      source({
        businessHours: {
          timezone: 'UTC',
          days: { monday: { open: true, start: '09:30', end: '17:15' } },
        },
      })
    )
    expect(rendered.systemPrompt).toContain('9:30 AM to 5:15 PM')
    expect(rendered.systemPrompt).not.toContain('09:30')
  })

  it('places the block at the token when the prompt declares one', () => {
    const rendered = renderAssistantConfig(
      source({
        systemPrompt: `## Hours\n${BUSINESS_HOURS_TOKEN}\n\n## Voice\nShort sentences.`,
        businessHours: fullWeek,
      })
    )
    expect(rendered.systemPrompt).not.toContain(BUSINESS_HOURS_TOKEN)
    expect(rendered.systemPrompt).toContain('## Hours\nOpening hours:')
    expect(rendered.systemPrompt).toContain('## Voice\nShort sentences.')
  })

  it('appends the block as its own section when the prompt declares no token', () => {
    const rendered = renderAssistantConfig(
      source({ systemPrompt: 'You are the front desk.', businessHours: fullWeek })
    )
    expect(rendered.systemPrompt).toContain('You are the front desk.')
    expect(rendered.systemPrompt).toContain('## Opening hours\nOpening hours:')
  })

  it('states plainly that it does not know the hours, and never guesses, when none were resolved', () => {
    const rendered = renderAssistantConfig(source({}))
    expect(rendered.systemPrompt).toContain('you do not know them')
    expect(rendered.systemPrompt).toContain('business_info')
    expect(rendered.systemPrompt).not.toContain('Monday to Friday')
  })
})

describe('C: todayLineForVapi carries both the date and the time', () => {
  it('emits a date filter and a time filter, both in the tenant timezone', async () => {
    const { todayLineForVapi } = await import('../src/lib/vapi/render-assistant-config')
    const line = todayLineForVapi('America/New_York')
    expect(line).toContain('"now" | date: "%A, %Y-%m-%d", "America/New_York"')
    expect(line).toContain('"now" | date: "%I:%M %p", "America/New_York"')
    expect(line).toContain('and the time is')
  })

  it('falls back to UTC for an invalid or missing timezone', async () => {
    const { todayLineForVapi } = await import('../src/lib/vapi/render-assistant-config')
    expect(todayLineForVapi('not-a-real-zone')).toContain('"UTC"')
    expect(todayLineForVapi(undefined)).toContain('"UTC"')
  })
})

describe('spokenName: the opening line is read aloud', () => {
  it('turns an ampersand into "and" and leaves everything else alone', async () => {
    const { spokenName } = await import('../src/lib/vapi/render-assistant-config')
    expect(spokenName('Cuts & Culture Barbershop')).toBe('Cuts and Culture Barbershop')
    expect(spokenName('Cuts&Culture')).toBe('Cuts and Culture')
    expect(spokenName("Maria's Cleaning Co.")).toBe("Maria's Cleaning Co.")
  })
})
