// tests/vapi-payload-shape.test.ts
//
// Regression for the first real tool call ever to reach production
// (2026-09-04, call 01a06de4-7c3f-7000-89bc-4f8adb241ff7). Vapi sent every
// toolCallList item as {id, type:'function', function:{name, arguments:"…"}},
// the flat-only schema rejected it, the route answered {results: []} before
// logging anything, and Vapi told the caller it could not pull up the menu.
//
// These tests pin that BOTH shapes parse and normalise to the same flat
// VapiToolCall, that string-encoded arguments are decoded, and that a payload
// which is neither shape still fails closed.

import { describe, it, expect } from 'vitest'
import { VapiToolCallMessageSchema, normalizeVapiToolCall, getToolArguments } from '@/types/vapi'

const call = { id: 'call_1', assistantId: 'asst_1' }
const envelope = (toolCallList: unknown[]) => ({ message: { type: 'tool-calls', call, toolCallList } })

describe('Vapi tool-call wire shapes', () => {
  it('accepts the flattened shape (older reference) unchanged', () => {
    const r = VapiToolCallMessageSchema.safeParse(envelope([{ id: 'tc1', name: 'list_services', arguments: { a: 1 } }]))
    expect(r.success).toBe(true)
    const tc = normalizeVapiToolCall(r.success ? r.data.message.toolCallList[0] : (null as never))
    expect(tc).toEqual({ id: 'tc1', name: 'list_services', arguments: { a: 1 }, parameters: undefined })
  })

  it('accepts the nested OpenAI-style shape Vapi actually sends, with string arguments', () => {
    const r = VapiToolCallMessageSchema.safeParse(envelope([
      { id: 'toolu_bdrk_01Go', type: 'function', function: { name: 'lookup_customer', arguments: '{"phone": "+15088018190"}' } },
    ]))
    expect(r.success).toBe(true)
    const tc = normalizeVapiToolCall(r.success ? r.data.message.toolCallList[0] : (null as never))
    expect(tc.id).toBe('toolu_bdrk_01Go')
    expect(tc.name).toBe('lookup_customer')
    expect(getToolArguments(tc)).toEqual({ phone: '+15088018190' })
  })

  it('normalises both shapes to the same downstream view', () => {
    const flat = normalizeVapiToolCall({ id: 'x', name: 'get_quote', arguments: { service_ids: [333] } })
    const nested = normalizeVapiToolCall({ id: 'x', type: 'function', function: { name: 'get_quote', arguments: JSON.stringify({ service_ids: [333] }) } })
    expect(getToolArguments(flat)).toEqual(getToolArguments(nested))
    expect(flat.name).toBe(nested.name)
  })

  it('treats an empty or absent argument string as no arguments', () => {
    expect(getToolArguments(normalizeVapiToolCall({ id: 'a', type: 'function', function: { name: 'list_services', arguments: '' } }))).toEqual({})
    expect(getToolArguments(normalizeVapiToolCall({ id: 'c', type: 'function', function: { name: 'list_services' } }))).toEqual({})
  })

  it('rejects malformed or non-object argument JSON instead of silently executing with {}', () => {
    const malformed = normalizeVapiToolCall({ id: 'b', type: 'function', function: { name: 'book_appointment', arguments: 'not json' } })
    const array = normalizeVapiToolCall({ id: 'd', type: 'function', function: { name: 'book_appointment', arguments: '[]' } })
    expect(() => getToolArguments(malformed)).toThrow('malformed JSON')
    expect(() => getToolArguments(array)).toThrow('JSON object')
  })

  it('still fails closed on a shape that is neither', () => {
    expect(VapiToolCallMessageSchema.safeParse(envelope([{ id: 'tc1' }])).success).toBe(false)
    expect(VapiToolCallMessageSchema.safeParse(envelope([{ id: 'tc1', function: {} }])).success).toBe(false)
  })
})
