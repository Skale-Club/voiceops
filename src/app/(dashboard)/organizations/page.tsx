import { createClient, getUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { OrganizationsTable } from '@/components/organizations/organizations-table'

export default async function OrganizationsPage() {
  const user = await getUser()
  if (!user) redirect('/login')
  const supabase = await createClient()

  const { data: organizations, error } = await supabase
    .from('organizations')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Organizations</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage tenants and their Vapi assistant mappings.
        </p>
      </div>
      <OrganizationsTable organizations={organizations ?? []} />
    </div>
  )
}
