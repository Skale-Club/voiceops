'use server'

import { revalidatePath } from 'next/cache'

import { createClient, getUser } from '@/lib/supabase/server'

const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/

export interface WidgetSettingsInput {
  displayName: string
  primaryColor: string
  welcomeMessage: string
  avatarUrl?: string | null
}

export interface WidgetActionResult {
  error?: string
}

function normalizeWidgetSettings(input: WidgetSettingsInput): WidgetSettingsInput | null {
  const displayName = input.displayName.trim()
  const primaryColor = input.primaryColor.trim().toUpperCase()
  const welcomeMessage = input.welcomeMessage.trim()
  const avatarUrl = input.avatarUrl?.trim() || null

  if (!displayName) {
    return null
  }

  if (!welcomeMessage) {
    return null
  }

  if (!HEX_COLOR_REGEX.test(primaryColor)) {
    return null
  }

  return {
    displayName,
    primaryColor,
    welcomeMessage,
    avatarUrl,
  }
}

async function getActiveOrgId() {
  const supabase = await createClient()
  const { data: orgId, error } = await supabase.rpc('get_current_org_id')

  if (error) {
    return { error: error.message, supabase: null, orgId: null }
  }

  if (!orgId) {
    return { error: 'No active organization selected.', supabase: null, orgId: null }
  }

  return { error: null, supabase, orgId }
}

export async function saveWidgetSettings(
  input: WidgetSettingsInput
): Promise<(WidgetActionResult & { settings?: WidgetSettingsInput }) | void> {
  const user = await getUser()

  if (!user) {
    return { error: 'Not authenticated.' }
  }

  const settings = normalizeWidgetSettings(input)

  if (!settings) {
    return { error: 'Enter a display name, welcome message, and a valid hex color like #18181B.' }
  }

  const { error: orgError, supabase, orgId } = await getActiveOrgId()

  if (orgError || !supabase || !orgId) {
    return { error: orgError ?? 'Unable to resolve the active organization.' }
  }

  const { error } = await supabase
    .from('organizations')
    .update({
      widget_display_name: settings.displayName,
      widget_primary_color: settings.primaryColor,
      widget_welcome_message: settings.welcomeMessage,
      widget_avatar_url: settings.avatarUrl || null,
    })
    .eq('id', orgId)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/widget')

  return { settings }
}

export async function regenerateWidgetToken(): Promise<
  (WidgetActionResult & { widgetToken?: string }) | void
> {
  const user = await getUser()

  if (!user) {
    return { error: 'Not authenticated.' }
  }

  const { error: orgError, supabase, orgId } = await getActiveOrgId()

  if (orgError || !supabase || !orgId) {
    return { error: orgError ?? 'Unable to resolve the active organization.' }
  }

  const widgetToken = crypto.randomUUID()
  const { error } = await supabase
    .from('organizations')
    .update({ widget_token: widgetToken })
    .eq('id', orgId)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/widget')

  return { widgetToken }
}
