import { describe, it } from 'vitest'

describe('AUTH-04: Unauthenticated redirect', () => {
  it.todo('unauthenticated request to /dashboard redirects to /login')
  it.todo('unauthenticated request to /dashboard/organizations redirects to /login')
  it.todo('authenticated request to /dashboard passes through')
  it.todo('request to /login does not redirect (no auth loop)')
  it.todo('request to /api/vapi/tools bypasses auth middleware')
})
