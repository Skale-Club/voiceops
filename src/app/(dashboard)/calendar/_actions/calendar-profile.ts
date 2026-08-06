'use server'

import { z } from 'zod'
import { createClient, getUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { listGoogleCalendars, type GoogleCalendarEntry } from '@/lib/calendar/google-calendar'

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string }

const profileSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers and hyphens'),
  timezone: z.string().min(1),
})

export type LookBusyMode = 'off' | 'hide_percent' | 'max_per_day'

export type SchedulingProfile = {
  user_id: string
  org_id: string
  slug: string
  timezone: string
  sync_mode: 'one_way' | 'two_way'
  default_location_type: 'google_meet' | 'my_address' | 'client_address' | 'phone'
  conflict_calendar_ids: string[]
  look_busy_mode: LookBusyMode
  look_busy_percent: number | null
  look_busy_max_per_day: number | null
  created_at: string
  updated_at: string
}

export async function updateSchedulingPreferences(input: {
  sync_mode?: 'one_way' | 'two_way'
  default_location_type?: 'google_meet' | 'my_address' | 'client_address' | 'phone'
  conflict_calendar_ids?: string[]
}): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('calendar_profiles')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('user_id', user.id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/calendar')
  return { ok: true, data: undefined }
}

// Look busy (migration 1267). Bounds mirror the DB CHECKs; the parameter the
// chosen mode does not use is nulled so a stale value can never resurface when
// the operator switches modes back and forth.
const lookBusySchema = z
  .object({
    look_busy_mode: z.enum(['off', 'hide_percent', 'max_per_day']),
    look_busy_percent: z.number().int().min(1).max(90).nullable(),
    look_busy_max_per_day: z.number().int().min(1).max(50).nullable(),
  })
  .superRefine((val, ctx) => {
    if (val.look_busy_mode === 'hide_percent' && val.look_busy_percent == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['look_busy_percent'],
        message: 'A percentage is required when hiding a share of slots',
      })
    }
    if (val.look_busy_mode === 'max_per_day' && val.look_busy_max_per_day == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['look_busy_max_per_day'],
        message: 'A maximum is required when capping slots per day',
      })
    }
  })

export type LookBusyInput = z.infer<typeof lookBusySchema>

export async function updateLookBusySettings(
  input: LookBusyInput,
): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const parsed = lookBusySchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'validation_error' }
  }

  const { look_busy_mode: mode } = parsed.data
  const patch = {
    look_busy_mode: mode,
    look_busy_percent: mode === 'hide_percent' ? parsed.data.look_busy_percent : null,
    look_busy_max_per_day: mode === 'max_per_day' ? parsed.data.look_busy_max_per_day : null,
    updated_at: new Date().toISOString(),
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('calendar_profiles')
    .update(patch)
    .eq('user_id', user.id)

  if (error) return { ok: false, error: error.message }
  // The public booking pages read this profile, so their cached slot lists
  // must not survive a change here.
  revalidatePath('/calendar')
  revalidatePath('/book', 'layout')
  return { ok: true, data: undefined }
}

export async function getSchedulingProfile(): Promise<ActionResult<SchedulingProfile | null>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('calendar_profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) return { ok: false, error: error.message }
  // Cast: database.ts types predate the sync_mode / default_location_type columns.
  return { ok: true, data: data as SchedulingProfile | null }
}

export async function upsertSchedulingProfile(
  input: { slug: string; timezone: string },
): Promise<ActionResult<SchedulingProfile>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const parsed = profileSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'validation_error' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'no_active_org' }

  const { data, error } = await supabase
    .from('calendar_profiles')
    .upsert(
      {
        user_id: user.id,
        org_id: orgId,
        slug: parsed.data.slug,
        timezone: parsed.data.timezone,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
    .select()
    .single()

  if (error) return { ok: false, error: error.message }
  revalidatePath('/calendar')
  return { ok: true, data: data as SchedulingProfile }
}

export async function getGoogleCalendarList(): Promise<ActionResult<GoogleCalendarEntry[]>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { ok: false, error: 'no_active_org' }

  try {
    const calendars = await listGoogleCalendars(user.id, orgId as string)
    return { ok: true, data: calendars }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to fetch calendars' }
  }
}
