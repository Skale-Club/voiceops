import Link from 'next/link'
import { redirect } from 'next/navigation'
import { MessageSquare } from 'lucide-react'

import { createClient, getUser } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { WidgetSettingsForm } from '@/components/widget/widget-settings-form'
import { WidgetPlayground } from '@/components/widget/widget-playground'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { getActiveAgents, getChannelDefaults } from '@/app/(dashboard)/agents/actions'
import { normalizeWidgetUrlMode, normalizeWidgetUrlRules } from '@/lib/widget/url-rules'
import { normalizeWidgetOffset, normalizeWidgetPosition } from '@/lib/widget/position'

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

export default async function SettingsWidgetPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const supabase = await createClient()
  const { data: activeOrgId } = await supabase.rpc('get_current_org_id')

  if (!activeOrgId) {
    return (
      <PageContainer size="narrow">
        <Card>
          <CardHeader>
            <CardTitle>No active organization selected</CardTitle>
            <CardDescription>
              Choose an organization before configuring its widget settings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/organizations" className="text-sm font-medium text-accent underline-offset-4 hover:underline">
              Go to organizations
            </Link>
          </CardContent>
        </Card>
      </PageContainer>
    )
  }

  const [orgResult, agents, channelDefaults] = await Promise.all([
    supabase
      .from('organizations')
      .select('id, name, widget_display_name, widget_primary_color, widget_welcome_message, widget_token, widget_avatar_url, accent_color, widget_greeting_enabled, widget_greeting_message, widget_greeting_delay_seconds, widget_url_mode, widget_url_rules, widget_position, widget_offset_x, widget_offset_y')
      .eq('id', activeOrgId)
      .single(),
    getActiveAgents(),
    getChannelDefaults(),
  ])

  if (orgResult.error || !orgResult.data) {
    throw new Error(orgResult.error?.message ?? 'Failed to load widget settings.')
  }

  const organization = orgResult.data
  const currentAgentId = channelDefaults.web_widget ?? null

  const widgetConfig = {
    displayName: normalizeWidgetValue(organization.widget_display_name, DEFAULT_WIDGET_SETTINGS.displayName),
    primaryColor: normalizeWidgetValue(
      organization.widget_primary_color,
      normalizeWidgetValue(organization.accent_color, DEFAULT_WIDGET_SETTINGS.primaryColor),
    ),
    welcomeMessage: normalizeWidgetValue(organization.widget_welcome_message, DEFAULT_WIDGET_SETTINGS.welcomeMessage),
    avatarUrl: organization.widget_avatar_url || '',
    greetingEnabled: organization.widget_greeting_enabled !== false,
    greetingMessage: organization.widget_greeting_message || '',
    greetingDelaySeconds: typeof organization.widget_greeting_delay_seconds === 'number' ? organization.widget_greeting_delay_seconds : 3,
    urlMode: normalizeWidgetUrlMode(organization.widget_url_mode),
    urlRules: normalizeWidgetUrlRules(organization.widget_url_rules),
    position: normalizeWidgetPosition(organization.widget_position),
    offsetX: normalizeWidgetOffset(organization.widget_offset_x),
    offsetY: normalizeWidgetOffset(organization.widget_offset_y),
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Embed"
        eyebrowIcon={MessageSquare}
        title="Widget"
        description={`Configure the public chat widget for ${organization.name}.`}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Settings */}
        <WidgetSettingsForm
          initialSettings={widgetConfig}
          widgetToken={organization.widget_token}
          agents={agents}
          currentAgentId={currentAgentId}
        />

        {/* Playground */}
        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <WidgetPlayground
            widgetToken={organization.widget_token}
            displayName={widgetConfig.displayName}
            primaryColor={widgetConfig.primaryColor}
            welcomeMessage={widgetConfig.welcomeMessage}
            avatarUrl={widgetConfig.avatarUrl}
            greetingEnabled={widgetConfig.greetingEnabled}
            greetingMessage={widgetConfig.greetingMessage || widgetConfig.welcomeMessage}
            greetingDelaySeconds={widgetConfig.greetingDelaySeconds}
          />
        </div>
      </div>
    </PageContainer>
  )
}
