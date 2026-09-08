// tests/action-engine-sms-undeliverable.test.ts
//
// The send_sms action turns a permanently undeliverable destination into a
// structured skip (same shape as the DND gate) instead of a thrown error, so
// a nightly "stale opportunity nudge" to a bad number stops producing a
// failed workflow run every single night. Transient errors still throw.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/dnd', () => ({
  checkDnd: vi.fn(async () => ({ blocked: false })),
  dndBlockedMessage: vi.fn(() => 'blocked'),
}))
vi.mock('@/lib/logger', () => ({ log: vi.fn(async () => {}) }))
vi.mock('@/lib/twilio/send-sms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/twilio/send-sms')>()
  return {
    ...actual,
    sendSms: vi.fn(),
    noteTwilioAccountProblem: vi.fn(async () => {}),
  }
})

import { executeAction } from '@/lib/action-engine/execute-action'
import { sendSms, noteTwilioAccountProblem, SmsUndeliverableError } from '@/lib/twilio/send-sms'

function makeContext(withConversation = true) {
  const insert = vi.fn(async () => ({ error: null }))
  return {
    context: {
      organizationId: 'org-1',
      contactId: 'contact-1',
      ...(withConversation ? { conversationId: 'conversation-1' } : {}),
      supabase: { from: vi.fn(() => ({ insert })) },
    },
    insert,
  }
}

describe('send_sms: undeliverable destination → structured skip', () => {
  beforeEach(() => vi.clearAllMocks())

  it('invalid number: returns ok:false/sms_undeliverable, writes a timeline event, does not touch integration health', async () => {
    vi.mocked(sendSms).mockRejectedValueOnce(
      new SmsUndeliverableError({
        kind: 'invalid_number',
        to: '+11443926128',
        twilioCode: 21211,
        message: 'SMS not sent: +1144392XXXX is not a valid phone number (Twilio 21211).',
        hint: 'Fix the contact phone number.',
      }),
    )
    const { context, insert } = makeContext()

    const result = await executeAction('send_sms', { to: '+11443926128', body: 'hi' }, {} as never, context as never)
    await Promise.resolve()

    expect(JSON.parse(result)).toEqual({
      ok: false,
      reason: 'sms_undeliverable',
      kind: 'invalid_number',
      channel: 'sms',
      to: '+11443926128',
      twilio_code: 21211,
      message: 'SMS not sent: +1144392XXXX is not a valid phone number (Twilio 21211).',
      hint: 'Fix the contact phone number.',
    })
    expect(result).not.toContain('\n')
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: 'conversation-1',
        role: 'system',
        metadata: expect.objectContaining({ type: 'sms_undeliverable', kind: 'invalid_number', twilio_code: 21211 }),
      }),
    )
    expect(noteTwilioAccountProblem).not.toHaveBeenCalled()
  })

  it('region not enabled (account problem): skips AND marks the Twilio integration degraded', async () => {
    const err = new SmsUndeliverableError({
      kind: 'region_not_enabled',
      to: '+5511953482575',
      twilioCode: 21408,
      message: 'SMS not sent: this Twilio account cannot send SMS to the country of +551195348XXXX (Twilio 21408).',
      hint: 'Enable SMS for that country in the Twilio Console.',
      accountConfig: true,
    })
    vi.mocked(sendSms).mockRejectedValueOnce(err)
    const { context, insert } = makeContext(false)

    const result = await executeAction('send_sms', { to: '+5511953482575', body: 'hi' }, {} as never, context as never)
    await Promise.resolve()

    expect(JSON.parse(result)).toMatchObject({ ok: false, reason: 'sms_undeliverable', kind: 'region_not_enabled', twilio_code: 21408 })
    expect(noteTwilioAccountProblem).toHaveBeenCalledWith(context, err)
    // No conversation on a workflow run → no timeline row, and no crash.
    expect(insert).not.toHaveBeenCalled()
  })

  it('a transient Twilio failure still throws so the run fails and alerts', async () => {
    vi.mocked(sendSms).mockRejectedValueOnce(new Error('Twilio error 503: {"code":20503}'))
    const { context } = makeContext()
    await expect(
      executeAction('send_sms', { to: '+14155552671', body: 'hi' }, {} as never, context as never),
    ).rejects.toThrow('Twilio error 503')
  })

  it('a successful send passes the executor result through unchanged', async () => {
    vi.mocked(sendSms).mockResolvedValueOnce('SMS sent. SID: SM1')
    const { context } = makeContext()
    await expect(
      executeAction('send_sms', { to: '+14155552671', body: 'hi' }, {} as never, context as never),
    ).resolves.toBe('SMS sent. SID: SM1')
  })
})
