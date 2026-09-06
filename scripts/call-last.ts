#!/usr/bin/env node
// "Listen to the last call" without listening to it — the post-call report
// probe from VOICE-CALL-4-PLAN.md item M, promoted to a real command so every
// real call is judged in minutes instead of by re-reading a transcript by
// hand. Prints: the call header, a timeline (every user/bot/tool line with
// seconds-from-start), Vapi's own per-turn latency metrics, our persisted
// tool timings for the call, every server refusal (the voice consent gate's
// "NOT BOOKED/MOVED/CANCELLED YET" and ownership's "That appointment isn't"
// strings), and the same humanity lint the rehearsal matrix runs on every
// bot line. Saves the artifact (messages only — no recording/pcap/log URLs)
// to tests/fixtures/calls/<id>.json unless --no-save.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/call-last.ts              # latest call
//   npx tsx --env-file=.env.local scripts/call-last.ts <callId>      # a specific call
//   npx tsx --env-file=.env.local scripts/call-last.ts --count 2      # latest two calls
//   npx tsx --env-file=.env.local scripts/call-last.ts --download-audio # save audio under the OS temp directory
//   npx tsx --env-file=.env.local scripts/call-last.ts --no-save      # don't write fixtures
//   npm run call:last                                                # same, latest call
//
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_SECRET
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'
import { decrypt } from '../src/lib/crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const ASSISTANT_ID = '99518fa7-09f1-4c76-b7c8-58cd8a92105c'

// ── The same humanity lint the rehearsal matrix runs (tests/manual/voice-call-matrix.test.ts).
// Kept as a plain copy rather than a shared import: the matrix is a test file
// and this is a script that must run standalone with `tsx`, and the two are
// small enough that duplication is cheaper than a shared module neither side
// can evolve alone. If one changes, check the other.
const FILLERS = /^(perfect|great|sure thing|sure|absolutely|got it|awesome|no problem|no worries|alright|okay so|ok so)\b/i
function lintHuman(text: string): string[] {
  const out: string[] = []
  const t = text.trim()
  if (!t) return ['EMPTY REPLY']
  if (FILLERS.test(t)) out.push('filler opener')
  const questions = (t.match(/\?/g) ?? []).length
  if (questions > 1) out.push(`${questions} questions in one turn`)
  const words = t.split(/\s+/).length
  if (words > 45) out.push(`${words} words (long for a phone line)`)
  if (/\b(tool|system|api|assistant|ai|model|database|prompt)\b/i.test(t)) out.push('mentions tool/system/prompt')
  if (/[*#_\[\]]/.test(t)) out.push('markdown characters')
  let sawDigital1323 = false
  let sawLeadingZero = false
  for (const m of t.matchAll(/\b(\d{1,2}):(\d{2})\b/g)) {
    const hour = parseInt(m[1], 10)
    if (hour >= 13 && hour <= 23) sawDigital1323 = true
    if (/^0\d$/.test(m[1])) sawLeadingZero = true
  }
  if (/\bo(?:h)? (?:one|two|three|four|five|six|seven|eight|nine)\b/i.test(t)) sawLeadingZero = true
  if (sawDigital1323) out.push('digital time (13:00) spoken')
  if (sawLeadingZero) out.push('leading-zero time spoken (09:45 / "oh nine")')
  if (/\$\d/.test(t)) out.push('$ sign spoken')
  const sentences = t.split(/(?<=[.!?])\s+/).map((x) => x.trim().toLowerCase()).filter((x) => x.length > 12)
  if (new Set(sentences).size !== sentences.length) out.push('repeated sentence')
  return out
}

const REFUSAL_RE = /^(NOT BOOKED YET\.|NOT MOVED YET\.|NOT CANCELLED YET\.|That appointment isn't)/

interface VapiMessage {
  role: string
  message?: string
  secondsFromStart?: string | number
  toolCalls?: Array<{ id: string; function: { name: string; arguments: string } }>
  name?: string
  result?: string
  toolCallId?: string
}

function fmtSeconds(v: unknown): string {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n.toFixed(1).padStart(6) : '   0.0'
}

async function main() {
  const args = process.argv.slice(2)
  const noSave = args.includes('--no-save')
  const downloadAudio = args.includes('--download-audio')
  const countIndex = args.indexOf('--count')
  const requestedCount = countIndex >= 0 ? Number(args[countIndex + 1]) : 1
  if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 10) {
    throw new Error('--count must be an integer from 1 to 10')
  }
  const callIdArg = args.find((a, index) => !a.startsWith('--') && index !== countIndex + 1)

  const supabase = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

  const { data: vapiIntegration, error: intError } = await supabase
    .from('integrations')
    .select('encrypted_api_key')
    .eq('organization_id', ORG_ID)
    .eq('provider', 'vapi')
    .eq('is_active', true)
    .maybeSingle()
  if (intError || !vapiIntegration) {
    console.error('Could not load the Vapi integration for this org.', intError?.message ?? '')
    process.exit(1)
  }
  const vapiKey = await decrypt(vapiIntegration.encrypted_api_key)

  let calls: any[]
  if (callIdArg) {
    const r = await fetch(`https://api.vapi.ai/call/${callIdArg}`, { headers: { Authorization: `Bearer ${vapiKey}` } })
    if (!r.ok) { console.error(`Vapi returned HTTP ${r.status} for call ${callIdArg}`); process.exit(1) }
    calls = [await r.json()]
  } else {
    const r = await fetch(`https://api.vapi.ai/call?assistantId=${ASSISTANT_ID}&limit=${requestedCount}`, { headers: { Authorization: `Bearer ${vapiKey}` } })
    if (!r.ok) { console.error(`Vapi returned HTTP ${r.status} listing calls`); process.exit(1) }
    calls = (await r.json()) as any[]
    if (!calls.length) { console.error('No calls found for this assistant.'); process.exit(1) }
  }

  for (const [index, call] of calls.entries()) {
    if (index) console.log('\n')
    await printCall(call, supabase, noSave, downloadAudio, vapiKey)
  }
}

async function printCall(call: any, supabase: ReturnType<typeof createClient<Database>>, noSave: boolean, downloadAudio: boolean, vapiKey: string) {

  // ── Header ──────────────────────────────────────────────────────────────
  const started = call.startedAt ? new Date(call.startedAt) : null
  const ended = call.endedAt ? new Date(call.endedAt) : null
  const durationSec = started && ended ? (ended.getTime() - started.getTime()) / 1000 : null
  console.log('='.repeat(78))

  if (downloadAudio) {
    // Artifact URLs are private storage references, not download links. Vapi's
    // authenticated endpoint returns a fresh short-lived redirect every time.
    const url = `https://api.vapi.ai/call/${call.id}/stereo-recording`
    const candidate = await fetch(url, { headers: { Authorization: `Bearer ${vapiKey}` }, redirect: 'follow' })
    const response = candidate.ok ? candidate : undefined
    if (response) {
      const type = response.headers.get('content-type') ?? ''
      const extension = type.includes('wav') ? 'wav' : type.includes('ogg') ? 'ogg' : 'mp3'
      const dir = join(tmpdir(), 'xphere-call-audio')
      mkdirSync(dir, { recursive: true })
      const path = join(dir, `${call.id}.${extension}`)
      writeFileSync(path, Buffer.from(await response.arrayBuffer()))
      console.log(`  audio:       ${path}`)
    } else {
      console.log('  audio:       download failed')
    }
  }
  console.log(`Call ${call.id}`)
  console.log(`  started:     ${call.startedAt ?? 'unknown'}`)
  console.log(`  duration:    ${durationSec != null ? `${durationSec.toFixed(1)}s` : 'unknown'}`)
  console.log(`  endedReason: ${call.endedReason ?? 'unknown'}`)
  console.log(`  cost:        $${typeof call.cost === 'number' ? call.cost.toFixed(4) : 'unknown'}`)
  console.log(`  caller:      ${call.customer?.number ?? 'unknown'}`)
  console.log('='.repeat(78))

  // ── Timeline ────────────────────────────────────────────────────────────
  const messages: VapiMessage[] = Array.isArray(call.messages) ? call.messages : (call.artifact?.messages ?? [])
  console.log('\n--- Timeline ---')
  const refusals: string[] = []
  const lintFindings: string[] = []
  for (const m of messages) {
    const t = fmtSeconds(m.secondsFromStart)
    if (m.role === 'user') {
      console.log(`[${t}s] USER  ${m.message ?? ''}`)
    } else if (m.role === 'bot') {
      const text = m.message ?? ''
      console.log(`[${t}s] BOT   ${text}`)
      const l = lintHuman(text)
      if (l.length) lintFindings.push(`[${t}s] ${l.join(', ')} — "${text.slice(0, 80)}"`)
    } else if (m.role === 'tool_calls') {
      for (const tc of m.toolCalls ?? []) {
        console.log(`[${t}s] CALL  ${tc.function.name}(${tc.function.arguments.slice(0, 200)})`)
      }
    } else if (m.role === 'tool_call_result') {
      const result = m.result ?? ''
      console.log(`[${t}s] TOOL  ${m.name ?? '?'} :: ${result.slice(0, 160).replace(/\n/g, ' ')}`)
      if (REFUSAL_RE.test(result)) refusals.push(`[${t}s] ${m.name ?? '?'}: ${result.slice(0, 200)}`)
    }
    // 'system' entries are skipped — the prompt is long and not the point of this report.
  }

  // ── Vapi's own per-turn latency metrics ────────────────────────────────
  const pm = call.artifact?.performanceMetrics
  console.log('\n--- Vapi turn latency (ms) ---')
  if (pm?.turnLatencies?.length) {
    const fields = ['modelLatency', 'voiceLatency', 'transcriberLatency', 'endpointingLatency', 'turnLatency'] as const
    for (const f of fields) {
      const vals = pm.turnLatencies.map((x: any) => Number(x[f]) || 0)
      const avg = vals.reduce((a: number, b: number) => a + b, 0) / vals.length
      const max = Math.max(...vals)
      console.log(`  ${f.padEnd(20)} avg ${avg.toFixed(0).padStart(5)}  max ${max.toFixed(0).padStart(5)}  (n=${vals.length})`)
    }
    if (typeof pm.numAssistantInterrupted === 'number') console.log(`  numAssistantInterrupted: ${pm.numAssistantInterrupted}`)
  } else {
    console.log('  (no performanceMetrics on this call)')
  }

  // ── Our persisted tool timings ─────────────────────────────────────────
  console.log('\n--- Our tool timings ---')
  await printToolTimings(supabase, call.id)

  // ── Server refusals ─────────────────────────────────────────────────────
  console.log('\n--- Server refusals (consent / ownership gates) ---')
  if (refusals.length) refusals.forEach((r) => console.log(`  ${r}`))
  else console.log('  (none)')

  // ── Lint ─────────────────────────────────────────────────────────────────
  console.log('\n--- Humanity lint (bot lines) ---')
  if (lintFindings.length) lintFindings.forEach((l) => console.log(`  ${l}`))
  else console.log('  (clean)')

  // ── Save fixture (messages only — never a recording/pcap/log URL) ──────
  if (!noSave) {
    const dir = join(process.cwd(), 'tests', 'fixtures', 'calls')
    mkdirSync(dir, { recursive: true })
    const fixture = {
      id: call.id,
      assistantId: call.assistantId ?? ASSISTANT_ID,
      startedAt: call.startedAt,
      endedAt: call.endedAt,
      endedReason: call.endedReason,
      customer: call.customer?.number ? { number: call.customer.number } : undefined,
      messages,
    }
    const path = join(dir, `${call.id}.json`)
    writeFileSync(path, JSON.stringify(fixture, null, 2))
    console.log(`\nSaved fixture: ${path}`)
  }
}

/**
 * VOICE-CALL-4-PLAN.md item F persists per-call tool timings into a table
 * named `vapi_tool_timings`; as of this script, that table does not exist
 * yet — `vapi_tool_timings` is currently only a structured *log* event name
 * (see src/app/api/vapi/tools/route.ts, `obs.info('vapi_tool_timings', ...)`
 * with resolveMs/idempotencyMs/executeMs/totalMs), not a persisted row. The
 * one thing that IS persisted today per call is `workflow_tool_logs`
 * (kind='tool', keyed by vapi_call_id, migration 1249/1255) — tool name,
 * status and one total `execution_ms` (no resolve/idempotency/execute
 * split). Try the future table first so this script needs no edit once item
 * F ships; fall back to what's real today; say plainly which one answered.
 */
async function printToolTimings(supabase: ReturnType<typeof createClient<Database>>, callId: string) {
  const direct = await (supabase as any).from('vapi_tool_timings').select('*').eq('call_id', callId)
  if (!direct.error) {
    const rows = direct.data ?? []
    if (!rows.length) { console.log('  (vapi_tool_timings: no rows for this call)'); return }
    for (const row of rows) {
      console.log(`  ${String(row.name ?? row.tool_name ?? '?').padEnd(22)} execute ${String(row.execute_ms ?? row.executeMs ?? '?').padStart(6)}ms  total ${String(row.total_ms ?? row.totalMs ?? '?').padStart(6)}ms`)
    }
    return
  }
  const fallback = await supabase
    .from('workflow_tool_logs')
    .select('tool_name, status, execution_ms, created_at')
    .eq('vapi_call_id', callId)
    .order('created_at', { ascending: true })
  if (fallback.error) {
    console.log(`  (neither vapi_tool_timings nor workflow_tool_logs could be read: ${fallback.error.message})`)
    return
  }
  const rows = fallback.data ?? []
  console.log('  (item F not shipped yet: no vapi_tool_timings table. Showing workflow_tool_logs instead —')
  console.log('   total ms only, no resolve/idempotency/execute breakdown.)')
  if (!rows.length) { console.log('  (workflow_tool_logs: no rows for this call)'); return }
  for (const row of rows) {
    console.log(`  ${row.tool_name.padEnd(22)} total ${String(row.execution_ms).padStart(6)}ms  status ${row.status}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
