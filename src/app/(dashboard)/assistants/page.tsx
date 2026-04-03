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
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Assistants</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Link Vapi assistant IDs to this organization to route webhooks correctly.
        </p>
      </div>
      <AssistantMappingsTable mappings={mappings ?? []} />
    </div>
  )
}
