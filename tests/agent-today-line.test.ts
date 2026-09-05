// Every agent is told what day it is in the tenant's timezone, so no model has
// to guess a year for "September 8th" (it guessed 2024 in production).
import { describe, it, expect } from 'vitest'
import { formatTodayLine } from '../src/lib/agent-runtime/run-agent'

describe('formatTodayLine', () => {
  it('renders weekday, ISO date and zone in the tenant timezone', () => {
    // 2026-09-05T03:30Z is still Friday 2026-09-04 in New York.
    const line = formatTodayLine(new Date('2026-09-05T03:30:00Z'), 'America/New_York')
    expect(line).toContain('Today is Friday, 2026-09-04 (America/New_York).')
    expect(line).toContain('YYYY-MM-DD')
  })
  it('falls back to UTC on an invalid zone instead of throwing', () => {
    const line = formatTodayLine(new Date('2026-09-05T03:30:00Z'), 'Not/AZone')
    expect(line).toContain('2026-09-05 (UTC)')
  })
})
