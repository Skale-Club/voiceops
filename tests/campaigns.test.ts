import { describe, it } from 'vitest'

describe('createCampaign: server action', () => {
  it.todo('inserts a campaign row with status=draft and returns the new id')
  it.todo('stores calls_per_minute from input (CAMP-03)')
  it.todo('stores scheduled_start_at as ISO string when provided')
  it.todo('rejects if organization_id is missing from session')
})

describe('startCampaign: state transition', () => {
  it.todo('transitions campaign status from draft to in_progress (CAMP-04)')
  it.todo('uses optimistic locking: UPDATE WHERE status=draft, rejects if already in_progress')
  it.todo('fires one POST /call per pending contact up to calls_per_minute concurrency (CAMP-05)')
  it.todo('sets campaign_contacts.status to calling after call is fired')
  it.todo('stores returned vapi_call_id on campaign_contacts row')
})

describe('pauseCampaign: state transition', () => {
  it.todo('transitions campaign status from in_progress to paused (CAMP-04)')
  it.todo('does not fire new calls while status is paused')
})

describe('stopCampaign: state transition', () => {
  it.todo('transitions campaign status from in_progress or paused to stopped (CAMP-04)')
})

describe('campaign deduplication', () => {
  it.todo('inserting duplicate phone for same campaign_id returns unique constraint error (CAMP-07)')
})

describe('outbound call payload', () => {
  it.todo('createOutboundCall sends POST to https://api.vapi.ai/call with assistantId, phoneNumberId, customer, metadata')
  it.todo('metadata includes campaign_contact_id for webhook roundtrip (CAMP-05)')
  it.todo('returns vapi_call_id from Vapi response')
})
