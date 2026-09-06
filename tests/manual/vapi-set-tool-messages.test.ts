// tests/manual/vapi-set-tool-messages.test.ts
//
// VOICE-CALL-4-PLAN.md item J: tool messages without fillers or promises.
// Vapi speaks these itself the instant a tool call fires — this is NOT a
// prompt instruction, and the 2026-09-04/05 calls went silent or spoke a
// filler/promise ("Alright, let me get that booked for you" — fired on the
// *prepare* call, before anything was decided) precisely because this
// depended on the model remembering to speak, or spoke the wrong thing.
//
// Canary doc: .planning/workstreams/omnichannel-agent-orchestration/canary/vapi-tool-messages.md
//
// Rules this table encodes (see VOICE-CALL-4-PLAN.md item J and the
// 2026-09-06 re-plan):
//   - lookup_customer: SILENT request-start. Pickup already pays ~2s of tool
//     latency before the greeting; "One moment."/"Let me look you up." was
//     the first thing a caller heard on the 2026-09-05 call.
//   - book_appointment / reschedule_appointment / cancel_appointment: SILENT
//     request-start too. Each of these tools is called twice in a
//     conversation (a "prepare" call that only assembles a confirmation, and
//     a "confirmed" call that actually writes) — a request-start message
//     fires on BOTH, which is exactly how "Alright, let me get that booked
//     for you" fired before the server had decided anything on 2026-09-05.
//     The model itself is expected to say something ("Give me a moment
//     while I book that") before the confirmed call — that is prompt work,
//     not a tool message, and out of scope here.
//   - No message may open with Alright / Sure / Great / Perfect / Got it /
//     No problem — every one of those reads as a promise or an agreement to
//     something the server hasn't done yet.
//   - request-failed messages are kept (so a failed write is never mistaken
//     for a completed one) but rewritten without an "I'm sorry" or "Alright"
//     opener.
//
// Dry run unless APPLY=1 (same convention as tune-voice-tools.test.ts in
// this directory). Prints the full current-vs-desired diff either way, and
// after a real APPLY re-fetches the assistant to confirm what actually
// landed, per tool.

import { it, expect } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'

interface VapiMessage {
  type: string
  content: string
  timingMilliseconds?: number
}

// Every message content in this file, start to finish — checked below before
// anything is even considered for a PATCH, dry run or not.
const BANNED_OPENERS = /^(alright|sure|great|perfect|got it|no problem)\b/i

// The empty array for lookup_customer/book_appointment/reschedule_appointment/
// cancel_appointment is deliberate and load-bearing, not "no opinion" — see
// the file header. `messages: []` must be sent to Vapi EXPLICITLY (not the
// field omitted) so an existing spoken line on the live assistant is
// actually cleared rather than left untouched by a partial PATCH.
const DESIRED: Record<string, VapiMessage[]> = {
  lookup_customer: [],
  business_info: [{ type: 'request-start', content: 'Let me check.' }],
  list_services: [{ type: 'request-start', content: 'Let me pull up what we offer.' }],
  get_quote: [
    { type: 'request-start', content: 'Let me get the exact price.' },
    { type: 'request-response-delayed', content: 'Just working that out.', timingMilliseconds: 6000 },
  ],
  check_availability: [
    { type: 'request-start', content: 'Let me look at the book.' },
    { type: 'request-response-delayed', content: 'Still looking, one moment.', timingMilliseconds: 6000 },
  ],
  book_appointment: [
    { type: 'request-response-delayed', content: 'Still working on that.', timingMilliseconds: 8000 },
    {
      type: 'request-failed',
      content: "I couldn't get that booked just now — nothing was changed. Would you like me to take a message?",
    },
  ],
  reschedule_appointment: [
    { type: 'request-response-delayed', content: 'Still working on that.', timingMilliseconds: 8000 },
    {
      type: 'request-failed',
      content: "I couldn't move that appointment — it's unchanged. Shall I take a message?",
    },
  ],
  cancel_appointment: [
    { type: 'request-response-delayed', content: 'Still working on that.', timingMilliseconds: 8000 },
    {
      type: 'request-failed',
      content: "I couldn't cancel that — it's still on the book. Shall I take a message?",
    },
  ],
}

// Same env-var convention as tests/manual/vapi-push-dry-run.test.ts and
// tests/manual/tune-voice-tools.test.ts, falling back to the org/assistant
// this canary has always targeted so the script still runs with no env set.
const ORG_ID = process.env.VAPI_PUSH_TEST_ORG_ID ?? '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const ASSISTANT_ID = process.env.VAPI_PUSH_TEST_ASSISTANT_ID ?? '99518fa7-09f1-4c76-b7c8-58cd8a92105c'

function fmt(messages: VapiMessage[]): string {
  if (messages.length === 0) return 'NONE (silent)'
  return messages
    .map((m) => `${m.type}:"${m.content}"${m.timingMilliseconds ? ` @${m.timingMilliseconds}ms` : ''}`)
    .join(' | ')
}

it('gives every tool the tuned request-start/delayed/failed lines, silent where the plan calls for silence', async () => {
  // Fails loudly, before any network call, if this file's own table would
  // ship a filler/promise opener.
  for (const [name, messages] of Object.entries(DESIRED)) {
    for (const m of messages) {
      expect(BANNED_OPENERS.test(m.content), `${name} "${m.type}" opens with a banned filler: "${m.content}"`).toBe(
        false,
      )
    }
  }

  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('integrations')
    .select('encrypted_api_key')
    .eq('organization_id', ORG_ID)
    .eq('provider', 'vapi')
    .eq('is_active', true)
    .maybeSingle()
  if (!data?.encrypted_api_key) throw new Error(`No active Vapi integration for org ${ORG_ID}`)
  const key = await decrypt(data.encrypted_api_key)
  const H = { Authorization: `Bearer ${key}`, 'content-type': 'application/json' }
  const url = `https://api.vapi.ai/assistant/${ASSISTANT_ID}`

  const current = (await (await fetch(url, { headers: H })).json()) as {
    model?: { tools?: Array<{ function?: { name?: string }; messages?: VapiMessage[]; server?: unknown }> }
  }
  const currentTools = current.model?.tools ?? []

  console.log('### CURRENT vs DESIRED (before any write)')
  for (const t of currentTools) {
    const name = t.function?.name ?? '(unnamed)'
    const desired = DESIRED[name]
    console.log(`### ${name.padEnd(24)} current: ${fmt(t.messages ?? [])}`)
    if (desired) console.log(`### ${''.padEnd(24)} desired: ${fmt(desired)}`)
    else console.log(`###   ${''.padEnd(22)} (not in DESIRED table — left untouched)`)
  }

  // Every tool this canary is responsible for must actually be present on
  // the live assistant, or a typo'd tool name here would silently apply to
  // nothing while looking like it succeeded.
  const currentNames = new Set(currentTools.map((t) => t.function?.name).filter(Boolean))
  for (const name of Object.keys(DESIRED)) {
    expect(currentNames.has(name), `expected tool "${name}" on the live assistant, none found`).toBe(true)
  }

  const nextTools = currentTools.map((t) => {
    const name = t.function?.name
    const desired = name ? DESIRED[name] : undefined
    // `desired` may be [] (lookup_customer, the three writes' request-start):
    // that must still replace `messages` on the PATCH body with an explicit
    // empty array, never with the field left off (which some APIs treat as
    // "don't touch this field" instead of "clear it").
    return desired !== undefined ? { ...t, messages: desired } : t
  })

  if (process.env.APPLY !== '1') {
    console.log('### DRY RUN — no PATCH sent. Set APPLY=1 to push the table above.')
    return
  }

  const patchRes = await fetch(url, {
    method: 'PATCH',
    headers: H,
    body: JSON.stringify({ model: { ...current.model, tools: nextTools } }),
  })
  const patched = (await patchRes.json()) as { model?: { tools?: Array<{ function?: { name?: string } }> } }
  console.log('### PATCH HTTP ' + patchRes.status)
  if (!patchRes.ok) {
    console.log(JSON.stringify(patched).slice(0, 1000))
    throw new Error(`PATCH failed: ${patchRes.status}`)
  }
  expect(patched.model?.tools?.length).toBe(currentTools.length)

  // Re-fetch (not just trust the PATCH response) so what's printed below is
  // what Vapi actually persisted, not what we asked it to persist.
  const after = (await (await fetch(url, { headers: H })).json()) as {
    model?: { tools?: Array<{ function?: { name?: string }; messages?: VapiMessage[] }> }
  }
  console.log('### APPLIED — live assistant read back after the PATCH:')
  for (const t of after.model?.tools ?? []) {
    console.log(`### ${String(t.function?.name).padEnd(24)} ${fmt(t.messages ?? [])}`)
  }

  expect((after.model?.tools ?? []).length).toBe(currentTools.length)
  for (const [name, desired] of Object.entries(DESIRED)) {
    const live = (after.model?.tools ?? []).find((t) => t.function?.name === name)
    expect(live, `tool "${name}" missing after PATCH`).toBeTruthy()
    expect((live?.messages ?? []).length).toBe(desired.length)
  }
}, 60000)
