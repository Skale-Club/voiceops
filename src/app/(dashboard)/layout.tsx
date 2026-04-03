import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { OrgSwitcher } from '@/components/layout/org-switcher'
import { AppBreadcrumb } from '@/components/layout/app-breadcrumb'
import { createClient, getUser } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/login')

  // Read active org from cookie — no DB call on normal navigation
  const jar = await cookies()
  const raw = jar.get('vo_active_org')?.value
  let activeOrgId: string | null = null
  let activeOrgName: string | null = null

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { id: string; name: string }
      activeOrgId = parsed.id ?? null
      activeOrgName = parsed.name ?? null
    } catch {
      // malformed cookie — ignore, will fall back to DB below
    }
  }

  // First load (no cookie): seed from DB
  if (!activeOrgId) {
    const supabase = await createClient()
    const { data: orgId } = await supabase.rpc('get_current_org_id')
    if (orgId) {
      const { data: org } = await supabase
        .from('organizations')
        .select('id, name')
        .eq('id', orgId as string)
        .single()
      if (org) {
        activeOrgId = org.id
        activeOrgName = org.name
      }
    }
  }

  return (
    <SidebarProvider>
      <AppSidebar user={user} />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger className="-ml-0.5" />
          <div className="h-4 w-px bg-border mx-0.5" />
          <AppBreadcrumb />
          <div className="ml-auto flex items-center gap-2">
            <OrgSwitcher currentOrgId={activeOrgId} currentOrgName={activeOrgName} />
          </div>
        </header>
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
