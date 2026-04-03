import { describe, it } from 'vitest'

describe('mapEndedReasonToStatus: status mapping', () => {
  it.todo('customer-ended-call maps to completed')
  it.todo('assistant-ended-call maps to completed')
  it.todo('exceeded-max-duration maps to completed')
  it.todo('customer-did-not-answer maps to no_answer')
  it.todo('customer-busy maps to no_answer')
  it.todo('voicemail maps to no_answer')
  it.todo('pipeline-error maps to failed')
  it.todo('unknown reason maps to failed')
})

describe('campaign webhook route', () => {
  it.todo('returns 200 and updates contact status when end-of-call-report received for outbound call')
  it.todo('returns 200 without update when call.type is not outboundPhoneCall')
  it.todo('returns 200 without update when metadata.campaign_contact_id is missing')
  it.todo('returns 200 for non-end-of-call-report event types')
})
