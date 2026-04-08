# Operator — Testing Strategy

**Last updated:** 2026-04-03

## Framework

- **Vitest 4.1.2** — test runner (`vitest.config.ts`)
- **Environment**: `node` (not jsdom — no browser APIs)
- **Globals**: `true` — no need to import `describe`/`it`/`expect`
- **Timeout**: 10 seconds per test
- **JSX support**: `@vitejs/plugin-react`

Run tests: `npm test` or `npm run test`

## Test File Locations

All tests live in `tests/` at the project root, named `*.test.ts`:

| File | What It Tests |
|------|--------------|
| `tests/action-engine.test.ts` | Org resolution, tool dispatch (ACTN-XX test IDs) |
| `tests/ghl-executor.test.ts` | GoHighLevel API integration |
| `tests/crypto.test.ts` | AES-256-GCM encrypt/decrypt round-trips |
| `tests/campaigns.test.ts` | Campaign lifecycle (create, start, pause, stop) |
| `tests/knowledge-base.test.ts` | Knowledge base queries, embedding flow |
| `tests/call-detail.test.ts` | Call detail page/data |
| `tests/call-ingestion.test.ts` | End-of-call webhook ingestion |
| `tests/calls-actions.test.ts` | Call server actions |
| `tests/campaign-webhook.test.ts` | Campaign webhook handler |
| `tests/csv-parser.test.ts` | CSV parsing, phone normalization |
| `tests/integrations.test.ts` | Integration CRUD |
| `tests/auth.test.ts` | Authentication flows |
| `tests/middleware.test.ts` | Auth middleware routing |
| `tests/rls-isolation.test.ts` | Multi-tenant data isolation |
| `tests/assistant-mappings.test.ts` | Assistant mapping CRUD |
| `tests/dashboard-metrics.test.ts` | Dashboard metric calculations |
| `tests/organizations.test.ts` | Organization management |

## Test Patterns

### Grouping
```ts
describe('ACTN-01: Org resolution', () => {
  it('resolves org from known assistant ID', async () => { ... })
  it('returns null for unknown assistant ID', async () => { ... })
})
```

### Setup/Teardown
```ts
beforeEach(() => {
  vi.clearAllMocks()
  // Reset stubs
})
```

### Mocking External Services
```ts
// Stub global fetch for HTTP calls
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ contacts: [{ id: 'c1' }] })
}))

// Mock Supabase client
const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: mockOrg, error: null })
}
```

### Mock Builders
```ts
// Helper functions for realistic test data
function makeVapiPayload(overrides = {}): VapiToolCallMessage {
  return { type: 'tool-calls', toolCallList: [...], ...overrides }
}

function makeSingleChain(toolName: string): VapiToolCallMessage {
  return makeVapiPayload({ toolCallList: [{ function: { name: toolName } }] })
}
```

### Error Condition Testing
```ts
it('throws on org not found', async () => {
  mockSupabase.single.mockResolvedValue({ data: null, error: { message: 'Not found' } })
  await expect(resolveOrg('unknown-id', mockSupabase)).rejects.toThrow()
})
```

### Dynamic Imports (for module isolation)
```ts
// Isolate modules to test different env var states
const { encrypt } = await import('@/lib/crypto')
```

## Coverage Approach

- Business logic in `src/lib/` is the primary focus
- Action engine has feature-code test IDs (ACTN-01, etc.) mapping requirements to tests
- No coverage thresholds configured currently (no `coverage` in vitest config)
- No browser/E2E tests (no Playwright or Cypress)
- No snapshot tests

## What's NOT Tested

- React components (no jsdom, no testing-library)
- Full HTTP route handlers (no supertest/fetch mocking at route level)
- Database migrations (integration tests would require real Supabase instance)

## Test ID Naming Convention

Tests use requirement-code prefixes in `describe()` blocks:
- `ACTN-XX` — Action engine requirements
- Flat `it()` descriptions for other tests

This maps tests to specific acceptance criteria from the project spec.
