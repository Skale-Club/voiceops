import { createServiceRoleClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

const DEFAULT_WIDGET_CONFIG = {
  displayName: 'AI Assistant',
  primaryColor: '#18181B',
  welcomeMessage: 'Hi! How can I help?',
} as const

function normalizeWidgetValue(value: string | null | undefined, fallback: string): string {
  if (typeof value !== 'string') return fallback

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
): Promise<Response> {
  const { token } = await params

  const supabase = createServiceRoleClient()
  const { data: org, error } = await supabase
    .from('organizations')
    .select('is_active, widget_display_name, widget_primary_color, widget_welcome_message')
    .eq('widget_token', token)
    .single()

  if (error || !org || !org.is_active) {
    return Response.json({ error: 'Invalid or inactive token' }, { status: 401 })
  }

  return Response.json({
    displayName: normalizeWidgetValue(org.widget_display_name, DEFAULT_WIDGET_CONFIG.displayName),
    primaryColor: normalizeWidgetValue(org.widget_primary_color, DEFAULT_WIDGET_CONFIG.primaryColor),
    welcomeMessage: normalizeWidgetValue(org.widget_welcome_message, DEFAULT_WIDGET_CONFIG.welcomeMessage),
  })
}
