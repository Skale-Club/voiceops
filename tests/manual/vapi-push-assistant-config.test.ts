// Manual probe for pushAssistantConfig() — the one piece of Phase 139 Plan 04
// that is allowed to touch a real Vapi account. Excluded from the default
// `npx vitest run` glob (see vitest.config.ts's `exclude: ['tests/manual/**']`)
// -- run only via `npm run test:manual`, and only after setting BOTH env
// vars below. Absent either one, this test skips itself; it never fails
// silently and never runs against a live assistant unless explicitly asked.
//
// This plan's own execution NEVER ran this file — see the SUMMARY for how
// pushAssistantConfig() and renderAssistantConfig() were verified without
// touching the live assistant.

import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { pushAssistantConfig } from '@/lib/vapi/sync-assistant-config'

const ORG_ID = process.env.VAPI_PUSH_TEST_ORG_ID
const VAPI_ASSISTANT_ID = process.env.VAPI_PUSH_TEST_ASSISTANT_ID

it.skipIf(!ORG_ID || !VAPI_ASSISTANT_ID)(
  'pushes the rendered assistant config onto a real Vapi assistant',
  async () => {
    const supabase = createServiceRoleClient()
    const result = await pushAssistantConfig(supabase, ORG_ID!, VAPI_ASSISTANT_ID!)
    console.log('### pushAssistantConfig result:', JSON.stringify(result))
    if (!result.ok) throw new Error(result.error)
  },
  60000
)
