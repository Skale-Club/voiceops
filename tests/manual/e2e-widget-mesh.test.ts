import { describe, it, vi } from 'vitest'
vi.mock('next/server', () => ({ after: (fn: () => unknown) => { void fn() } }))
import { runAgent } from '@/lib/agent-runtime'

const ORG = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'

async function ask(userMessage: string) {
  const t = Date.now()
  const res = await runAgent({
    orgId: ORG,
    channel: 'web_widget',
    userMessage,
    mode: 'production',
  } as never) as { text?: string; status?: string; errorDetail?: string }
  console.log(`\n### "${userMessage}" — ${Date.now() - t}ms — status=${res.status ?? '?'}${res.errorDetail ? ' err=' + res.errorDetail : ''}\n${String(res.text ?? '').slice(0, 600)}`)
}

describe('widget mesh', () => {
  it('service question is delegated', async () => {
    await ask('What haircuts do you offer and how much is a skin fade?')
  }, 180000)
  it('availability question is delegated', async () => {
    await ask('Do you have anything open on September 8th for a signature haircut?')
  }, 180000)
})
