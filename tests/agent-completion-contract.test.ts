import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { finalizeAssistantCompletion } from '@/lib/agent-runtime/completion'

describe('agent completion contract', () => {
  it('turns an abort that ended without throwing into an observable timeout with fallback text', () => {
    expect(finalizeAssistantCompletion({
      text: '',
      status: 'success',
      signalAborted: true,
      fallbackMessage: 'Please try again.',
    })).toEqual({
      text: 'Please try again.',
      status: 'aborted',
      errorDetail: 'turn_timeout',
      usedFallback: true,
    })
  })

  it('turns a successful tool-only/step-exhausted completion into a visible error reply', () => {
    expect(finalizeAssistantCompletion({
      text: '  ',
      status: 'success',
      signalAborted: false,
      fallbackMessage: 'Please try again.',
    })).toEqual({
      text: 'Please try again.',
      status: 'error',
      errorDetail: 'empty_assistant_reply',
      usedFallback: true,
    })
  })

  it('preserves a real reply unchanged', () => {
    expect(finalizeAssistantCompletion({
      text: 'I found three times for you.',
      status: 'success',
      signalAborted: false,
      fallbackMessage: 'Please try again.',
    })).toEqual({
      text: 'I found three times for you.',
      status: 'success',
      errorDetail: undefined,
      usedFallback: false,
    })
  })

  it('propagates the parent trace and conversation identity into recursive specialists', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/agent-runtime/run-agent.ts'), 'utf8')
    const start = source.indexOf('partnerResult = await runAgentBlocking({')
    const end = source.indexOf('})', start)
    const recursiveCall = source.slice(start, end)

    expect(start).toBeGreaterThan(-1)
    expect(recursiveCall).toContain('traceId,')
    expect(recursiveCall).toContain('conversationId,')
    expect(recursiveCall).toContain('sessionId,')
  })
})
