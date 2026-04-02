import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AssistantMappingsTable } from '@/components/assistants/assistant-mappings-table'

export default async function AssistantsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: mappings, error } = await supabase
    .from('assistant_mappings')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Assistant Mappings</h1>
          <p className="text-sm text-muted-foreground">Link Vapi assistant IDs to this organization. Active mappings route Vapi tool-call webhooks to the correct tenant.</p>
        </div>
      </div>
      <AssistantMappingsTable mappings={mappings ?? []} />
    </div>
  )
}
