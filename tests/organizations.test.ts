import { describe, it } from 'vitest'

describe('TEN-01: Organization CRUD', () => {
  it.todo('can create an organization with name and slug')
  it.todo('can update organization name')
  it.todo('can deactivate an organization (set is_active=false)')
  it.todo('cannot create organization with duplicate slug')
})

describe('TEN-05: Organization list', () => {
  it.todo('returns all organizations scoped to the current user org')
  it.todo('returns organizations sorted by created_at descending')
})
