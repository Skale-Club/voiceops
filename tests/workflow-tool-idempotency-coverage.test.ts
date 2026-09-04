// tests/workflow-tool-idempotency-coverage.test.ts
//
// SAFE-02 coverage for the path the specialist mesh actually books through.
//
// build-workflow-tools.ts guarded only kind='flow', on a comment asserting that
// "kind='tool' already routes through executeAction which has its own
// idempotency gate". executeAction has no such gate, and book_appointment,
// reschedule_appointment and cancel_appointment are all kind='tool'. So the
// booking path had no replay protection, and it took a real booking landing
// twice-over-able in production on 2026-09-04 to surface it.
//
// This is a coverage test, not a mechanism test — that distinction is the whole
// lesson of the phase.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { requiresIdempotency, SIDE_EFFECTING_ACTIONS } from '@/lib/agent-runtime/idempotency'
import { extractActionTypeFromDefinition } from '@/lib/workflows/derive-action-type'

const src = readFileSync(join(process.cwd(), 'src/lib/agent-runtime/build-workflow-tools.ts'), 'utf8').replace(/\r\n/g, '\n')

const toolWorkflow = (actionType: string) => ({
  nodes: [
    { id: 'trigger', kind: 'trigger' },
    { id: 'action', type: 'action', data: { kind: 'action', action_type: actionType, config: {} } },
  ],
})

describe('workflow tool idempotency coverage', () => {
  it('the three Xkedule mutations require the guard', () => {
    for (const a of ['xkedule_create_booking', 'xkedule_cancel_booking', 'xkedule_reschedule_booking']) {
      expect(SIDE_EFFECTING_ACTIONS.has(a)).toBe(true)
      expect(requiresIdempotency(a)).toBe(true)
    }
  })

  it('a kind=tool booking workflow resolves to a side-effecting action type', () => {
    const t = extractActionTypeFromDefinition(toolWorkflow('xkedule_create_booking'))
    expect(t).toBe('xkedule_create_booking')
    expect(requiresIdempotency(t)).toBe(true)
  })

  it('a kind=tool availability workflow does not, so reads stay unguarded', () => {
    const t = extractActionTypeFromDefinition(toolWorkflow('xkedule_check_availability'))
    expect(requiresIdempotency(t)).toBe(false)
  })

  it('the builder no longer gates on kind alone', () => {
    expect(src).not.toMatch(/if \(capturedKind === 'flow' && invocationId/)
    expect(src).toMatch(/const needsIdempotency =/)
    expect(src).toMatch(/if \(needsIdempotency && invocationId/)
  })

  it('the builder decides from the action type for a tool, and unconditionally for a flow', () => {
    expect(src).toMatch(/capturedKind === 'tool' \? extractActionTypeFromDefinition\(capturedDefinition\)/)
    expect(src).toMatch(/capturedKind === 'flow' \|\|/)
    expect(src).toMatch(/requiresIdempotency\(capturedActionType\)/)
  })

  it('the false claim about executeAction is gone, and executeAction still has no gate', () => {
    expect(src).not.toMatch(/already routes through executeAction which has its own\n\s*\/\/ idempotency gate/)
    const ea = readFileSync(join(process.cwd(), 'src/lib/action-engine/execute-action.ts'), 'utf8')
    expect(ea).not.toMatch(/checkIdempotency|recordIdempotency/)
  })
})
