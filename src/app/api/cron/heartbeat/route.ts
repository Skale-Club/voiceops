// Cron heartbeat ingest.
//
// Called by the `skale-cron` container (Hetzner/Coolify) after every tick of
// every scheduled job it runs, so a job that silently stops running can be
// detected instead of discovered days later. This is NOT a webhook receiver
// (see CLAUDE.md) — it follows the /api/v1/ convention of returning real
// HTTP status codes instead of always-200.
//
// `cron_heartbeats` deliberately has no org_id: cron jobs are a property of
// the deployment, not of any one organization. RLS is enabled on that table
// with no policies, so only the service-role client used here can read/write
// it — see supabase/migrations/1282_cron_heartbeats.sql for the rationale.
//
// Auth: Authorization: Bearer <CRON_SECRET>, MANDATORY.
//
// This deliberately diverges from src/app/api/cron/obs-alerts/route.ts, which
// only enforces the bearer check when CRON_SECRET happens to be set (so it can
// be scheduled before the secret is configured). That leniency is acceptable
// for a read-only GET; it is not acceptable here, because this endpoint
// WRITES. With no secret configured, an unauthenticated caller could forge
// heartbeats and keep a dead job looking alive — defeating the entire purpose
// of the watchdog. So this route fails closed: no CRON_SECRET, no service.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const CRON_SECRET = process.env.CRON_SECRET

const bodySchema = z.object({
  job_name: z.string().min(1).max(200),
  status: z.number().int(),
  duration_ms: z.number().int().min(0),
  expected_interval_seconds: z.number().int().positive().optional(),
  error: z.string().max(2000).optional().nullable(),
})

export async function POST(request: Request): Promise<Response> {
  // Fail closed: an unset secret disables the endpoint rather than opening it.
  if (!CRON_SECRET) {
    return Response.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 503 })
  }
  const auth = request.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return Response.json({ ok: false, error: 'Supabase env not set' }, { status: 500 })
  }

  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await request.json())
  } catch (err) {
    return Response.json(
      { ok: false, error: 'Invalid request body', details: (err as z.ZodError).errors },
      { status: 422 },
    )
  }

  const supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // Atomic upsert (including the consecutive_failures increment) happens
  // inside the DB function so concurrent/overlapping ticks for the same job
  // can't race and drop an increment. See migration 1282.
  const { data, error } = await supabase.rpc('record_cron_heartbeat', {
    p_job_name: body.job_name,
    p_status: body.status,
    p_duration_ms: body.duration_ms,
    p_expected_interval_seconds: body.expected_interval_seconds ?? null,
    p_error: body.error ?? null,
  })

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true, heartbeat: data }, { status: 200 })
}
