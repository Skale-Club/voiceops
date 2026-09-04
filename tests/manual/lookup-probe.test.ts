import { it, vi } from 'vitest'
vi.mock('next/server', () => ({ after: (fn: () => unknown) => { void fn() } }))
import { POST } from '@/app/api/vapi/tools/route'
it('lookup_customer by caller number', async () => {
  const num = process.env.PROBE_NUMBER!
  const res = await POST(new Request('https://xphere.app/api/vapi/tools', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-vapi-secret': 'probe' },
    body: JSON.stringify({ message: { type: 'tool-calls', call: { id: 'p-' + Date.now(), assistantId: '99518fa7-09f1-4c76-b7c8-58cd8a92105c', customer: { number: num } }, toolCallList: [{ id: 'tc1', name: 'lookup_customer', arguments: { phone: num } }] } }),
  }))
  const j = await res.json() as any
  console.log('### lookup_customer(' + num + ') -> HTTP', res.status, '\n' + String(j.results?.[0]?.result).slice(0, 300))
}, 60000)
