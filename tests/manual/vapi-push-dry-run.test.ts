// Dry run of pushAssistantConfig(): resolves the org's voice entry agent,
// its granted workflows, the live assistant's tuned tool messages and the
// org's booking modality, renders the full payload — and does NOT PATCH.
//
// This is the inspection step before any write reaches an assistant that may
// be answering a real phone number. Excluded from the default vitest glob.

import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { pushAssistantConfig } from '@/lib/vapi/sync-assistant-config'

const ORG_ID = process.env.VAPI_PUSH_TEST_ORG_ID
const ASSISTANT_ID = process.env.VAPI_PUSH_TEST_ASSISTANT_ID

it.skipIf(!ORG_ID || !ASSISTANT_ID)(
  'renders the assistant config without pushing it',
  async () => {
    const supabase = createServiceRoleClient()
    const result = await pushAssistantConfig(supabase, ORG_ID!, ASSISTANT_ID!, { dryRun: true })

    if (!result.ok) throw new Error(result.error)
    const rendered = result.rendered!

    console.log('### RENDERED PROMPT START >>>')
    console.log(rendered.systemPrompt)
    console.log('<<< RENDERED PROMPT END')

    console.log('### FUNCTION COUNT: ' + rendered.functions.length)
    for (const fn of rendered.functions) {
      console.log(
        '### FN ' +
          fn.name +
          ' :: params=' +
          Object.keys(fn.parameters.properties).join(',') +
          ' :: required=' +
          JSON.stringify(fn.parameters.required)
      )
    }
    for (const m of rendered.toolMessages) {
      console.log('### MSG ' + m.toolName + ' :: ' + JSON.stringify(m.messages))
    }
  },
  120000
)
