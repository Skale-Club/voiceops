// Restores the per-tool `server` block (URL + webhook secret) on the Cuts &
// Culture assistant - the first real pushAssistantConfig() run replaced the
// tools array without it, leaving eight functions with nowhere to send their
// calls. The secret is read from the account's sibling assistants, which
// carry the same value at assistant level (fingerprint 0a3d5b262a02, the one
// production /api/vapi/tools accepts). timeoutSeconds is set to 30 to match
// WRITE_TIMEOUT_MS, closing FINDINGS-OUTSIDE-SCOPE item 5. Dry run unless APPLY=1.
import { it } from 'vitest'
import { createHash } from 'node:crypto'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const ASSISTANT_ID = '99518fa7-09f1-4c76-b7c8-58cd8a92105c'
const TOOLS_URL = 'https://xphere.app/api/vapi/tools'
const fp = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 12)
it('restores per-tool routing', async () => {
  const s = createServiceRoleClient()
  const { data } = await s.from('integrations').select('encrypted_api_key').eq('organization_id', ORG_ID).eq('provider', 'vapi').eq('is_active', true).maybeSingle()
  const key = await decrypt(data!.encrypted_api_key)
  const H = { Authorization: `Bearer ${key}`, 'content-type': 'application/json' }
  const list = (await (await fetch('https://api.vapi.ai/assistant', { headers: H })).json()) as any[]
  const secret: string | undefined = list.map((a) => a.server?.headers?.['x-vapi-secret']).find(Boolean)
  if (!secret || fp(secret) !== '0a3d5b262a02') throw new Error('account-level secret missing or unexpected: ' + (secret ? fp(secret) : 'none'))
  const cur = list.find((a) => a.id === ASSISTANT_ID)
  const tools = (cur.model?.tools ?? []) as any[]
  console.log('### BEFORE withServer=' + tools.filter((t) => t.server).length + '/' + tools.length)
  const next = tools.map((t) => ({ ...t, server: { url: TOOLS_URL, secret, timeoutSeconds: 30 } }))
  if (process.env.APPLY !== '1') { console.log('### DRY RUN'); return }
  const r = await fetch(`https://api.vapi.ai/assistant/${ASSISTANT_ID}`, { method: 'PATCH', headers: H, body: JSON.stringify({ model: { ...cur.model, tools: next } }) })
  console.log('### PATCH HTTP ' + r.status)
  if (!r.ok) throw new Error(await r.text())
  const after = (await (await fetch(`https://api.vapi.ai/assistant/${ASSISTANT_ID}`, { headers: H })).json()) as any
  const at = (after.model?.tools ?? []) as any[]
  console.log('### AFTER withServer=' + at.filter((t) => t.server?.url === TOOLS_URL && t.server?.secret && fp(String(t.server.secret)) === '0a3d5b262a02').length + '/' + at.length + ' timeouts=' + JSON.stringify([...new Set(at.map((t) => t.server?.timeoutSeconds))]))
}, 120000)
