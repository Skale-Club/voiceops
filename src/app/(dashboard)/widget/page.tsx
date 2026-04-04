import Link from 'next/link'
import { redirect } from 'next/navigation'

import { createClient, getUser } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { WidgetSettingsForm } from '@/components/widget/widget-settings-form'

const DEFAULT_WIDGET_SETTINGS = {
  displayName: 'AI Assistant',
  primaryColor: '#18181B',
  welcomeMessage: 'Hi! How can I help?',
} as const

function normalizeWidgetValue(value: string | null | undefined, fallback: string): string {
  if (typeof value !== 'string') return fallback

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

export default async function WidgetPage() {
  const user = await getUser()

  if (!user) {
    redirect('/login')
  }

  const supabase = await createClient()
  const { data: activeOrgId } = await supabase.rpc('get_current_org_id')

  if (!activeOrgId) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>No active organization selected</CardTitle>
            <CardDescription>
              Choose an organization before configuring its widget settings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/organizations" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              Go to organizations
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  const { data: organization, error } = await supabase
    .from('organizations')
    .select(
      'id, name, widget_display_name, widget_primary_color, widget_welcome_message, widget_token'
    )
    .eq('id', activeOrgId)
    .single()

  if (error || !organization) {
    throw new Error(error?.message ?? 'Failed to load widget settings.')
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Widget</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Configure the public chat widget for {organization.name}.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <WidgetSettingsForm
          initialSettings={{
            displayName: normalizeWidgetValue(
              organization.widget_display_name,
              DEFAULT_WIDGET_SETTINGS.displayName
            ),
            primaryColor: normalizeWidgetValue(
              organization.widget_primary_color,
              DEFAULT_WIDGET_SETTINGS.primaryColor
            ),
            welcomeMessage: normalizeWidgetValue(
              organization.widget_welcome_message,
              DEFAULT_WIDGET_SETTINGS.welcomeMessage
            ),
          }}
          widgetToken={organization.widget_token}
        />

        <Card>
          <CardHeader>
            <CardTitle>Active organization</CardTitle>
            <CardDescription>
              Widget settings always apply to the current org selection in the dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="font-medium">Organization</p>
              <p className="text-muted-foreground">{organization.name}</p>
            </div>
            <div>
              <p className="font-medium">Current token</p>
              <code className="mt-1 block overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs">
                {organization.widget_token}
              </code>
            </div>
            <div className="rounded-lg border border-dashed p-4 text-muted-foreground">
              Save changes here first, then Phase 5 Plan 03 will hydrate the live embed with this
              config on public sites.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
