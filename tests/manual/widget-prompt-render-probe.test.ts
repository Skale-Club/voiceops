// Read-only: resolves the live mesh agents through the real resolveAgent()
// and reports whether any tenant-fact token survives into the prompt the
// model would see. Excluded from the default glob.
import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { resolveAgent } from '@/lib/agent-runtime/resolve-agent'

const ORG_ID = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'

it('renders every live agent prompt without leftover tokens', async () => {
  const s = createServiceRoleClient()
  const { data: agents } = await s.from('agents').select('id, slug').eq('organization_id', ORG_ID).eq('is_active', true)
  for (const a of agents ?? []) {
    const r = await resolveAgent(a.id, ORG_ID, 'web_widget')
    const p = r?.systemPrompt ?? '(null)'
    const leftover = (p.match(/{{business_[a-z_]+}}/g) ?? []).join(',') || 'none'
    console.log(`### ${a.slug} :: leftover=${leftover} :: head=${p.slice(0, 90).replace(/\n/g, ' ')}`)
  }
}, 120000)
