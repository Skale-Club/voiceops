'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt, encrypt } from '@/lib/crypto'
import type { WhatsAppProvider, WhatsAppProviderStatus } from '@/lib/whatsapp/types'
import { BUSINESS_TYPES, deriveServiceLocationModeFromBusinessType } from '@/lib/org/business-type'

const HEX_RE = /^#[0-9a-fA-F]{6}$/

const updateSchema = z.object({
  // The org the form was loaded for — used to bind the write (see resolveTargetOrg).
  orgId: z.string().uuid().optional(),
  logo_url: z
    .string()
    .trim()
    .max(2048, 'Logo URL is too long')
    .url('Logo URL must be a valid URL')
    .optional()
    .nullable()
    .or(z.literal('')),
  accent_color: z
    .string()
    .trim()
    .regex(HEX_RE, 'Accent must be a 6-digit hex like #6366F1')
    .optional()
    .nullable()
    .or(z.literal('')),
  brand_name: z
    .string()
    .trim()
    .max(64, 'Brand name is too long')
    .optional()
    .nullable()
    .or(z.literal('')),
})

export type UpdateWorkspaceBrandingInput = z.infer<typeof updateSchema>

export interface ActionResult {
  ok: boolean
  error?: string
}

type AuthedClient = Awaited<ReturnType<typeof createClient>>

/**
 * Resolve the org a settings write must target, binding it to the org the form
 * was loaded for. RLS already restricts writes to the active org, but if the
 * active org DRIFTED between page load and save (user switched in another tab /
 * device), a blind get_current_org_id() write would land on the NEW active org
 * with the OLD form's values — cross-org contamination. When the caller passes
 * the loaded `expectedOrgId` and it no longer matches, we refuse loudly instead.
 */
async function resolveTargetOrg(
  supabase: AuthedClient,
  expectedOrgId?: string | null,
): Promise<{ ok: true; orgId: string } | { ok: false; error: string }> {
  const { data: orgId, error } = await supabase.rpc('get_current_org_id')
  if (error || !orgId) return { ok: false, error: 'No active organization' }
  if (expectedOrgId && expectedOrgId !== orgId) {
    return { ok: false, error: 'A organização ativa mudou. Recarregue a página e tente de novo.' }
  }
  return { ok: true, orgId: orgId as string }
}

/**
 * Update branding fields (logo_url, accent_color, brand_name) on the current
 * org. Empty strings are normalized to null. RLS enforces org membership.
 */
export async function updateWorkspaceBranding(input: UpdateWorkspaceBrandingInput): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const target = await resolveTargetOrg(supabase, parsed.data.orgId)
  if (!target.ok) return target
  const orgId = target.orgId

  const patch: Record<string, string | null> = {}
  if (parsed.data.logo_url !== undefined) {
    patch.logo_url = parsed.data.logo_url && parsed.data.logo_url.length > 0 ? parsed.data.logo_url : null
  }
  if (parsed.data.accent_color !== undefined) {
    patch.accent_color = parsed.data.accent_color && parsed.data.accent_color.length > 0 ? parsed.data.accent_color : null
  }
  if (parsed.data.brand_name !== undefined) {
    patch.brand_name = parsed.data.brand_name && parsed.data.brand_name.length > 0 ? parsed.data.brand_name : null
  }

  if (Object.keys(patch).length === 0) {
    return { ok: true }
  }

  const { error: updateErr } = await supabase
    .from('organizations')
    .update(patch)
    .eq('id', orgId as string)

  if (updateErr) {
    return { ok: false, error: updateErr.message }
  }

  // Branding feeds into the dashboard layout | revalidate all dashboard routes.
  revalidatePath('/', 'layout')
  return { ok: true }
}

/**
 * Update the per-org daily AI cost cap.
 * Pass null to remove the override and fall back to the platform default.
 */
export async function updateDefaultCurrency(currency: string, orgId?: string): Promise<ActionResult> {
  const parsed = z.string().length(3).safeParse(currency.toUpperCase())
  if (!parsed.success) {
    return { ok: false, error: 'Currency must be a 3-letter ISO code' }
  }

  const supabase = await createClient()
  const target = await resolveTargetOrg(supabase, orgId)
  if (!target.ok) return target

  const { error } = await supabase
    .from('organizations')
    .update({ default_currency: parsed.data })
    .eq('id', target.orgId)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/settings/company-info')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Company profile (migration 1105) — legal identity, tax id, address, timezone
// ---------------------------------------------------------------------------

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().nullable().or(z.literal(''))

// Validate against the runtime's IANA tz list when available; fall back to a
// loose check so older runtimes don't reject valid input.
const SUPPORTED_TZS: string[] =
  typeof (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf === 'function'
    ? (Intl as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone')
    : []

const companyProfileSchema = z.object({
  orgId: z.string().uuid().optional(),
  // Phase 138 Plan 00 (MODAL-00): what kind of business this org is. Feeds
  // the DEFAULT organizations.service_location_mode (Plan 138-01) — see
  // the business_type branch in updateCompanyProfile below.
  business_type: z.enum(BUSINESS_TYPES).optional(),
  legal_name: optionalText(160),
  tax_id: optionalText(64),
  address_line1: optionalText(200),
  address_line2: optionalText(200),
  address_city: optionalText(120),
  address_state: optionalText(120),
  address_postal_code: optionalText(40),
  // ISO-3166-1 alpha-2 (or empty)
  address_country: z.string().trim().regex(/^[A-Za-z]{2}$/, 'Country must be a 2-letter code').optional().nullable().or(z.literal('')),
  timezone: z
    .string()
    .trim()
    .min(1)
    .refine((v) => SUPPORTED_TZS.length === 0 || SUPPORTED_TZS.includes(v), 'Unknown timezone')
    .optional(),
})

export type UpdateCompanyProfileInput = z.infer<typeof companyProfileSchema>

/**
 * Persist the company control-panel fields on the active org. Empty strings
 * normalize to null; country is upper-cased. RLS enforces org membership.
 */
export async function updateCompanyProfile(input: UpdateCompanyProfileInput): Promise<ActionResult> {
  const parsed = companyProfileSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const target = await resolveTargetOrg(supabase, parsed.data.orgId)
  if (!target.ok) return target
  const orgId = target.orgId

  const blank = (v: string | null | undefined) =>
    v == null || v.trim() === '' ? null : v.trim()

  const patch: Record<string, string | null> = {}
  const d = parsed.data
  if (d.legal_name !== undefined) patch.legal_name = blank(d.legal_name)
  if (d.tax_id !== undefined) patch.tax_id = blank(d.tax_id)
  if (d.address_line1 !== undefined) patch.address_line1 = blank(d.address_line1)
  if (d.address_line2 !== undefined) patch.address_line2 = blank(d.address_line2)
  if (d.address_city !== undefined) patch.address_city = blank(d.address_city)
  if (d.address_state !== undefined) patch.address_state = blank(d.address_state)
  if (d.address_postal_code !== undefined) patch.address_postal_code = blank(d.address_postal_code)
  if (d.address_country !== undefined) {
    const c = blank(d.address_country)
    patch.address_country = c ? c.toUpperCase() : null
  }
  if (d.timezone !== undefined && d.timezone) patch.timezone = d.timezone

  // Phase 138 Plan 00 (MODAL-00): business_type sets service_location_mode's
  // DEFAULT only. We detect "no explicit override" by comparing the org's
  // CURRENT service_location_mode against what its CURRENT (pre-save)
  // business_type would derive: if they still match, the stored mode is
  // still tracking the auto-derived default (or the org never diverged from
  // it), so it is safe to re-derive for the new business_type. If they
  // differ, an operator (or a future direct edit) deliberately moved the
  // mode away from its auto-derived value, and business_type must never
  // silently overwrite that choice. organizations.service_location_mode is
  // added at the DB level by Plan 138-01's migration 1297 (authored
  // alongside this one; both ship together in numeric order before either
  // runs against a real database).
  if (d.business_type !== undefined) {
    patch.business_type = d.business_type

    const { data: current } = await supabase
      .from('organizations')
      .select('business_type, service_location_mode')
      .eq('id', orgId as string)
      .maybeSingle()

    const currentRow = current as { business_type?: string | null; service_location_mode?: string | null } | null
    const oldDerivedMode = deriveServiceLocationModeFromBusinessType(currentRow?.business_type ?? null)
    const currentMode = currentRow?.service_location_mode ?? null
    const noExplicitOverride = currentMode === null || currentMode === oldDerivedMode

    if (noExplicitOverride) {
      patch.service_location_mode = deriveServiceLocationModeFromBusinessType(d.business_type)
    }
  }

  if (Object.keys(patch).length === 0) return { ok: true }

  const { error } = await supabase
    .from('organizations')
    .update(patch)
    .eq('id', orgId as string)
  if (error) return { ok: false, error: error.message }

  // Timezone/currency feed dashboard + email; revalidate the whole layout so
  // server-rendered dates pick up the new org timezone.
  revalidatePath('/', 'layout')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// SEED-031 | WhatsApp provider settings
// ---------------------------------------------------------------------------

const whatsappProviderSchema = z.object({
  orgId: z.string().uuid().optional(),
  provider: z.enum(['evolution', 'zapi', 'wapi']),
  displayName: z.string().trim().max(64).optional().default(''),
  config: z.record(z.string(), z.string()),
})

export interface SaveWhatsAppProviderInput {
  orgId?: string
  provider: WhatsAppProvider
  displayName?: string
  config: Record<string, string>
}

export interface ActiveWhatsAppProvider {
  id: string
  provider: WhatsAppProvider
  displayName: string
  config: Record<string, string>
  status: WhatsAppProviderStatus
  phoneNumber: string | null
}

function validateConfigForProvider(
  provider: WhatsAppProvider,
  config: Record<string, string>,
): string | null {
  const need = (keys: string[]) =>
    keys.find((k) => !config[k] || config[k].trim().length === 0)

  if (provider === 'evolution') {
    const missing = need(['base_url', 'token', 'instance_name'])
    if (missing) return `Evolution: ${missing} is required`
  } else if (provider === 'zapi') {
    const missing = need(['instance_id', 'token'])
    if (missing) return `Z-API: ${missing} is required`
  } else if (provider === 'wapi') {
    const missing = need(['instance_key', 'token', 'base_url'])
    if (missing) return `W-API: ${missing} is required`
  }
  return null
}

/**
 * Activate (or insert) a WhatsApp provider for the current org. Atomically
 * deactivates any previously active provider so the partial unique index
 * (org_id where is_active=true) is satisfied. Uses the service-role client to
 * bypass RLS for the multi-row mutation; org_id is resolved via the
 * authenticated client before the privileged write.
 */
export async function saveWhatsAppProvider(
  input: SaveWhatsAppProviderInput,
): Promise<ActionResult> {
  const parsed = whatsappProviderSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const target = await resolveTargetOrg(supabase, parsed.data.orgId)
  if (!target.ok) return target

  const configErr = validateConfigForProvider(parsed.data.provider, parsed.data.config)
  if (configErr) return { ok: false, error: configErr }

  const admin = createServiceRoleClient()
  const orgIdStr = target.orgId

  // 1. Deactivate any current active provider for the org
  const { error: deactErr } = await admin
    .from('whatsapp_providers')
    .update({ is_active: false })
    .eq('org_id', orgIdStr)
    .eq('is_active', true)
  if (deactErr) {
    return { ok: false, error: `Failed to deactivate previous provider: ${deactErr.message}` }
  }

  // 2. Encrypt config + look for existing row to update; otherwise insert
  const configEncrypted = await encrypt(JSON.stringify(parsed.data.config))

  const { data: existing } = await admin
    .from('whatsapp_providers')
    .select('id')
    .eq('org_id', orgIdStr)
    .eq('provider', parsed.data.provider)
    .limit(1)
    .maybeSingle()

  if (existing?.id) {
    const { error: upErr } = await admin
      .from('whatsapp_providers')
      .update({
        display_name: parsed.data.displayName ?? '',
        config_encrypted: configEncrypted,
        is_active: true,
      })
      .eq('id', existing.id)
    if (upErr) return { ok: false, error: upErr.message }
  } else {
    const { error: insErr } = await admin.from('whatsapp_providers').insert({
      org_id: orgIdStr,
      provider: parsed.data.provider,
      display_name: parsed.data.displayName ?? '',
      config_encrypted: configEncrypted,
      is_active: true,
    })
    if (insErr) return { ok: false, error: insErr.message }
  }

  // 3. Deactivate legacy evolution_instances rows when the new provider is
  //    non-Evolution. When evolution is selected we keep the legacy row in sync
  //    so older code that still queries evolution_instances keeps working.
  if (parsed.data.provider !== 'evolution') {
    await admin
      .from('evolution_instances')
      .update({ is_active: false })
      .eq('org_id', orgIdStr)
      .eq('is_active', true)
  }

  revalidatePath('/settings/company-info')
  return { ok: true }
}

export async function getActiveWhatsAppProvider(): Promise<ActiveWhatsAppProvider | null> {
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return null

  const { data, error } = await supabase
    .from('whatsapp_providers')
    .select('id, provider, display_name, config_encrypted, status, phone_number')
    .eq('org_id', orgId as string)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (error || !data) return null

  try {
    const configJson = await decrypt(data.config_encrypted)
    const config = JSON.parse(configJson) as Record<string, string>
    return {
      id: data.id,
      provider: data.provider,
      displayName: data.display_name,
      config,
      status: data.status,
      phoneNumber: data.phone_number,
    }
  } catch (err) {
    console.error('[settings/whatsapp] decrypt failed:', err)
    return null
  }
}

// ─── Logo upload ──────────────────────────────────────────────────────────────
// Upload a square logo image. Resized to 256x256 webp and stored in the public
// `avatars` bucket; returns the public URL. The caller persists it via
// updateWorkspaceBranding({ logo_url: url }).

const LOGO_MAX_BYTES = 4 * 1024 * 1024 // 4MB
const LOGO_ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
])

export async function uploadOrgLogo(
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const expectedOrgId = formData.get('orgId')
  const target = await resolveTargetOrg(supabase, typeof expectedOrgId === 'string' ? expectedOrgId : undefined)
  if (!target.ok) return { ok: false, error: target.error }
  const orgId = target.orgId

  const file = formData.get('file')
  if (!(file instanceof File)) return { ok: false, error: 'Missing file' }
  if (file.size === 0) return { ok: false, error: 'Empty file' }
  if (file.size > LOGO_MAX_BYTES) return { ok: false, error: 'File too large (max 4MB)' }
  if (!LOGO_ALLOWED_MIME.has(file.type)) return { ok: false, error: 'Unsupported image type' }

  const arrayBuffer = await file.arrayBuffer()
  const sharp = (await import('sharp')).default
  let processed: Buffer
  try {
    processed = await sharp(Buffer.from(arrayBuffer))
      .rotate()
      .resize(256, 256, { fit: 'cover', position: 'attention' })
      .webp({ quality: 86 })
      .toBuffer()
  } catch {
    return { ok: false, error: 'Could not process image' }
  }

  const nonce = Math.random().toString(36).slice(2, 10)
  const objectPath = `${orgId as string}/logo/${nonce}.webp`

  const { error: uploadErr } = await supabase.storage
    .from('avatars')
    .upload(objectPath, processed, {
      contentType: 'image/webp',
      upsert: false,
      cacheControl: '3600',
    })
  if (uploadErr) return { ok: false, error: uploadErr.message }

  const { data } = supabase.storage.from('avatars').getPublicUrl(objectPath)
  if (!data.publicUrl) return { ok: false, error: 'Could not resolve public URL' }
  return { ok: true, url: data.publicUrl }
}
