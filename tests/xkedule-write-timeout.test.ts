// tests/xkedule-write-timeout.test.ts
//
// On 2026-09-04 a real booking through the mesh took longer than the 15s read
// timeout. Our client aborted, the tool reported failure, the Booking
// specialist told the customer the appointment had not gone through — and
// Xkedule had already created it (booking #471, pending). The customer had an
// appointment and was told they did not.
//
// These pin that the three mutations get a longer budget than the reads, and
// that the read default is untouched.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_TIMEOUT_MS, WRITE_TIMEOUT_MS } from '@/lib/xkedule/client'

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')

describe('Xkedule write timeout', () => {
  it('gives writes a longer budget than reads', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(15000)
    expect(WRITE_TIMEOUT_MS).toBeGreaterThan(DEFAULT_TIMEOUT_MS)
  })

  it.each([
    'src/lib/xkedule/actions/create-booking.ts',
    'src/lib/xkedule/actions/cancel-booking.ts',
    'src/lib/xkedule/actions/reschedule-booking.ts',
  ])('%s passes WRITE_TIMEOUT_MS to its fetch', (path) => {
    const s = src(path)
    expect(s).toMatch(/import \{[^}]*WRITE_TIMEOUT_MS[^}]*\} from '\.\.\/client'/)
    expect(s).toMatch(/xkeduleFetchJson<[^>]+>\([\s\S]{0,300}?WRITE_TIMEOUT_MS,\s*\n\s*\)/)
  })

  it('leaves the read actions on the default budget', () => {
    for (const p of [
      'src/lib/xkedule/actions/check-availability.ts',
      'src/lib/xkedule/actions/get-services.ts',
      'src/lib/xkedule/actions/business-info.ts',
    ]) {
      expect(src(p)).not.toMatch(/WRITE_TIMEOUT_MS/)
    }
  })

  it('the client still defaults to the read budget when no timeout is passed', () => {
    const s = src('src/lib/xkedule/client.ts')
    expect(s).toMatch(/AbortSignal\.timeout\(timeoutMs \?\? DEFAULT_TIMEOUT_MS\)/)
  })
})
