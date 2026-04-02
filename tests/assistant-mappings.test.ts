import { describe, it } from 'vitest'

describe('TEN-03: Assistant mapping CRUD', () => {
  it.todo('can link a vapi_assistant_id to an organization')
  it.todo('returns error "This assistant ID is already mapped to an organization." on duplicate vapi_assistant_id')
  it.todo('can remove an assistant mapping')
})

describe('TEN-04: Toggle assistant mapping active/inactive', () => {
  it.todo('can set is_active=true on an assistant mapping without deleting it')
  it.todo('can set is_active=false on an assistant mapping without deleting it')
  it.todo('toggled mapping still exists in the database after toggle')
})
