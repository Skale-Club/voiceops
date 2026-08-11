'use server'

import { revalidatePath } from 'next/cache'

import { createClient, getUser } from '@/lib/supabase/server'
import {
  normalizeWidgetUrlMode,
  normalizeWidgetUrlRules,
  type WidgetUrlMode,
} from '@/lib/widget/url-rules'
import {
  normalizeWidgetOffset,
  normalizeWidgetPosition,
  type WidgetPosition,
} from '@/lib/widget/position'


export interface WidgetSettingsInput {
  displayName: string
  welcomeMessage: string
  avatarUrl?: string | null
  greetingEnabled?: boolean
  greetingMessage?: string | null
  greetingDelaySeconds?: number
  // Where the widget may run. `urlRules` accepts an array or a
  // newline/comma-separated string (as typed in the settings textarea).
  urlMode?: WidgetUrlMode
  urlRules?: string[] | string | null
  // Screen anchor + the gap from the two edges the bubble hugs (px).
  position?: WidgetPosition
  offsetX?: number
  offsetY?: number
}

export interface WidgetActionResult {
  error?: string
}

function normalizeWidgetSettings(input: WidgetSettingsInput): WidgetSettingsInput | null {
  const displayName = input.displayName.trim()
  const welcomeMessage = input.welcomeMessage.trim()
  const avatarUrl = input.avatarUrl?.trim() || null

  if (!displayName || !welcomeMessage) return null

  const greetingEnabled = input.greetingEnabled ?? true
  const greetingMessage = input.greetingMessage?.trim().slice(0, 160) || null
  const rawDelay = typeof input.greetingDelaySeconds === 'number' ? input.greetingDelaySeconds : 3
  const greetingDelaySeconds = Math.max(0, Math.min(30, Math.round(rawDelay)))

  const urlMode = normalizeWidgetUrlMode(input.urlMode)
  // In 'all' mode the rules are irrelevant; keep what was entered so toggling
  // back to allow/block doesn't lose the list.
  const urlRules = normalizeWidgetUrlRules(input.urlRules)

  // Placement. offsetY is kept as entered even for the middle-* anchors (which
  // ignore it) so switching back to a top/bottom anchor restores the old gap.
  const position = normalizeWidgetPosition(input.position)
  const offsetX = normalizeWidgetOffset(input.offsetX)
  const offsetY = normalizeWidgetOffset(input.offsetY)

  return {
    displayName,
    welcomeMessage,
    avatarUrl,
    greetingEnabled,
    greetingMessage,
    greetingDelaySeconds,
    urlMode,
    urlRules,
    position,
    offsetX,
    offsetY,
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
    return { error: 'Enter a display name and welcome message.' }
  }

  const { error: orgError, supabase, orgId } = await getActiveOrgId()

  if (orgError || !supabase || !orgId) {
    return { error: orgError ?? 'Unable to resolve the active organization.' }
  }

  const { error } = await supabase
    .from('organizations')
    .update({
      widget_display_name: settings.displayName,
      widget_primary_color: null, // always use the org's accent_color from Company info
      widget_welcome_message: settings.welcomeMessage,
      widget_avatar_url: settings.avatarUrl || null,
      widget_greeting_enabled: settings.greetingEnabled ?? true,
      widget_greeting_message: settings.greetingMessage || null,
      widget_greeting_delay_seconds: settings.greetingDelaySeconds ?? 3,
      widget_url_mode: settings.urlMode ?? 'all',
      widget_url_rules: Array.isArray(settings.urlRules) ? settings.urlRules : [],
      widget_position: settings.position ?? 'bottom-right',
      widget_offset_x: settings.offsetX ?? 20,
      widget_offset_y: settings.offsetY ?? 20,
    })
    .eq('id', orgId)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/widget')

  return { settings }
}

// ─── Avatar upload ────────────────────────────────────────────────────────────

const AVATAR_MAX_BYTES = 4 * 1024 * 1024
const AVATAR_ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'])

export async function uploadWidgetAvatar(
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const file = formData.get('file')
  if (!(file instanceof File)) return { ok: false, error: 'Missing file' }
  if (file.size === 0) return { ok: false, error: 'Empty file' }
  if (file.size > AVATAR_MAX_BYTES) return { ok: false, error: 'File too large (max 4 MB)' }
  if (!AVATAR_ALLOWED_MIME.has(file.type)) return { ok: false, error: 'Unsupported image type' }

  const arrayBuffer = await file.arrayBuffer()
  const sharp = (await import('sharp')).default
  let processed: Buffer
  try {
    processed = await sharp(Buffer.from(arrayBuffer))
      .rotate()
      .resize(128, 128, { fit: 'cover', position: 'attention' })
      .webp({ quality: 86 })
      .toBuffer()
  } catch {
    return { ok: false, error: 'Could not process image' }
  }

  const nonce = Math.random().toString(36).slice(2, 10)
  const objectPath = `${user.id}/widget-avatar-${nonce}.webp`

  const { error: uploadErr } = await supabase.storage
    .from('avatars')
    .upload(objectPath, processed, { contentType: 'image/webp', upsert: false, cacheControl: '3600' })
  if (uploadErr) return { ok: false, error: uploadErr.message }

  const { data } = supabase.storage.from('avatars').getPublicUrl(objectPath)
  if (!data.publicUrl) return { ok: false, error: 'Could not resolve public URL' }
  return { ok: true, url: data.publicUrl }
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
