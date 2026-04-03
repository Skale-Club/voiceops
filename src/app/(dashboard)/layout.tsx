import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { OrgSwitcher } from '@/components/layout/org-switcher'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const [{ data: memberships }, { data: currentOrgId }] = await Promise.all([
    supabase
      .from('org_members')
      .select('organization_id, organizations(id, name)')
      .eq('user_id', user.id),
    supabase.rpc('get_current_org_id'),
  ])

  const orgs = (memberships ?? [])
    .map(m => m.organizations as { id: string; name: string } | null)
    .filter((o): o is { id: string; name: string } => o !== null)

  return (
    <SidebarProvider>
      <AppSidebar user={user} />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger className="-ml-0.5" />
          <div className="h-4 w-px bg-border mx-0.5" />
          <OrgSwitcher orgs={orgs} currentOrgId={(currentOrgId as string) ?? null} />
        </header>
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
