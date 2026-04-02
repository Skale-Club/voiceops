import { describe, it } from 'vitest'

describe('AUTH-01: Sign-in with email and password', () => {
  it.todo('returns a session when valid credentials are provided')
  it.todo('returns an error when credentials are invalid')
  it.todo('returns an error when account does not exist')
})

describe('AUTH-03: Sign-out from any page', () => {
  it.todo('clears the session and redirects to /login')
})

describe('AUTH-05: User account linked to organization and role', () => {
  it.todo('newly created user has a corresponding org_members record')
  it.todo('user role is admin or member — no other values allowed')
})
