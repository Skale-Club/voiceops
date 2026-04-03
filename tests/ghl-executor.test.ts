import { describe, it } from 'vitest'

describe('ACTN-09: GHL createContact executor', () => {
  it.todo('sends POST to https://services.leadconnectorhq.com/contacts/ with Bearer token and Version header')
  it.todo('returns success string containing GHL contact ID on 201 response')
  it.todo('throws on non-2xx GHL response — caller handles fallback')
  it.todo('AbortController cancels request after 400ms timeout')
})

describe('ACTN-09: GHL getAvailability executor', () => {
  it.todo('sends GET to /calendars/:calendarId/free-slots with startDate and endDate query params')
  it.todo('returns formatted availability string (single line, no newlines)')
  it.todo('throws on non-2xx GHL response')
})

describe('ACTN-09: GHL createAppointment executor', () => {
  it.todo('sends POST to /calendars/events/appointments with calendarId, contactId, startTime, endTime')
  it.todo('returns success string containing appointment ID on 200 response')
  it.todo('throws on non-2xx GHL response')
})
