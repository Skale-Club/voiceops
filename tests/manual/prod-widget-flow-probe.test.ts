// Drives the PRODUCTION widget through the demo's booking conversation up to
// the availability question, carrying the session across turns, and reports
// each turn's latency and reply head. The price turn is what triggers the
// availability prefetch, so the day turn afterwards should be fast.
// Costs a few inferences. Excluded from the default glob.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const TURNS = (process.env.WIDGET_TURNS ? JSON.parse(process.env.WIDGET_TURNS) : [
  "Hi, I'd like to book a haircut.",
  'Just the signature haircut, how much is it?',
  'Ok. What do you have open on September 8th?',
]) as string[]
it('production widget booking flow', async () => {
  const s = createServiceRoleClient()
  const { data: org } = await s.from('organizations').select('widget_token').eq('id', ORG_ID).maybeSingle()
  let sessionId: string | undefined
  for (const message of TURNS) {
    const t = Date.now()
    const r = await fetch(`https://xphere.app/api/chat/${org!.widget_token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, ...(sessionId ? { sessionId } : {}) }) })
    const text = await r.text()
    const events = text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) as any[]
    const returned = events.find((e) => e.event === 'session')?.sessionId
    console.log(`### session sent=${sessionId ?? '-'} returned=${returned ?? '-'} same=${!!sessionId && sessionId === returned}`)
    sessionId = returned ?? sessionId
    const tools = events.filter((e) => e.event === 'tool_call').map((e) => e.name)
    const reply = events.filter((e) => e.event === 'token').map((e) => e.text).join('')
    const err = events.find((e) => e.event === 'error')
    console.log(`### "${message}" -> HTTP ${r.status} | ${Date.now() - t}ms | tools=${JSON.stringify(tools)}${err ? ' | ERROR ' + JSON.stringify(err).slice(0, 120) : ''}`)
    console.log('###   ' + reply.slice(0, 220).replace(/\n/g, ' '))
  }
}, 240000)
