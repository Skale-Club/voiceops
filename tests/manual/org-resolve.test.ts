import { describe, it } from 'vitest'
import { resolveOrgForCall } from '@/lib/vapi/end-of-call'
import { createServiceRoleClient } from '@/lib/supabase/admin'

describe('resolveOrgForCall stability', () => {
  it('resolves the demo assistant repeatedly', async () => {
    const s = createServiceRoleClient()
    for (let i = 0; i < 5; i++) {
      const t = Date.now()
      const r = await resolveOrgForCall({ assistantId: '99518fa7-09f1-4c76-b7c8-58cd8a92105c' }, s)
      console.log(`run ${i + 1}: orgId=${r.organizationId ?? 'NULL'} (${Date.now() - t}ms)`)
    }
  }, 180000)
})
