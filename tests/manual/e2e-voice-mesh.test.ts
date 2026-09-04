// Manual end-to-end probe. Hits the REAL database, OpenRouter and Xkedule.
// Not part of the release gate. Run explicitly:
//   npx vitest run tests/manual/e2e-voice-mesh.test.ts
import { describe, it, expect, vi } from 'vitest'

// next/server's after() needs a real request scope; in this harness it throws and
// the route's per-call catch turns every result into 'Service unavailable.', hiding
// what we came to measure. Run the deferred callback inline instead.
vi.mock('next/server', () => ({ after: (fn: () => unknown) => { void fn() } }))
import { POST } from '@/app/api/vapi/tools/route'

const ASSISTANT = '99518fa7-09f1-4c76-b7c8-58cd8a92105c'

async function call(name: string, args: Record<string, unknown>) {
  const body = {
    message: {
      type: 'tool-calls',
      call: { id: 'e2e-' + Date.now(), assistantId: ASSISTANT },
      toolCallList: [{ id: 'tc-' + Math.floor(Math.random() * 1e6), name, arguments: args }],
    },
  }
  const started = Date.now()
  const res = await POST(new Request('https://xphere.app/api/vapi/tools', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-vapi-secret': process.env.VAPI_WEBHOOK_SECRET ?? '' },
    body: JSON.stringify(body),
  }))
  const json = await res.json() as { results?: Array<{ result: string }> }
  const ms = Date.now() - started
  console.log(`\n### ${name} — HTTP ${res.status} — ${ms}ms\n${String(json.results?.[0]?.result ?? '(empty)').slice(0, 500)}`)
  return { status: res.status, result: json.results?.[0]?.result ?? '', ms }
}

describe('voice mesh end to end', () => {
  it('list_services', async () => {
    const r = await call('list_services', {})
    expect(r.status).toBe(200)
  }, 120000)

  it('check_availability', async () => {
    const r = await call('check_availability', { serviceIds: [333], startDate: '2026-09-08', endDate: '2026-09-08' })
    expect(r.status).toBe(200)
  }, 120000)
})
