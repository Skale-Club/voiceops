// POST /api/v1/accounts/:id/analyze
// Triggers a Playwright-based website analysis for the given account.
//
// Auth: Authorization: Bearer <token>
//   Token must hold the `prospects:enrich` scope.
//
// Returns 202 immediately — analysis runs fire-and-forget in the background.
// Poll GET /api/v1/accounts/:id/analyze to check status + read results.
//
// GET /api/v1/accounts/:id/analyze
// Returns the latest analysis for the account (status + results).

import { createHash }              from 'node:crypto'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { hasScope }                from '@/lib/api-keys/scopes'
import { runAnalysis }             from '@/services/website-analyzer'
import { resolveLatestAnalysisForDisplay, type AnalysisRowStatus } from '@/services/website-analyzer/display'

export const runtime = 'nodejs'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

async function resolveApiKey(request: Request) {
  const auth = request.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return { error: 'Missing Bearer token', status: 401 }
  const token = auth.slice(7).trim()
  if (!token) return { error: 'Missing Bearer token', status: 401 }

  const supabase = createServiceRoleClient()
  const { data: apiKey } = await supabase
    .from('api_keys')
    .select('id, org_id, scopes')
    .eq('key_hash', hashToken(token))
    .is('revoked_at', null)
    .maybeSingle()

  if (!apiKey) return { error: 'Invalid or revoked API key', status: 401 }
  return { apiKey, supabase }
}

// ── POST — trigger analysis ────────────────────────────────────────────────

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: accountId } = await params

  // 1. Auth
  const resolved = await resolveApiKey(request)
  if ('error' in resolved) {
    return Response.json({ error: resolved.error }, { status: resolved.status, headers: CORS_HEADERS })
  }
  const { apiKey, supabase } = resolved
  if (!hasScope(apiKey.scopes, 'prospects:enrich')) {
    return Response.json(
      { error: 'API key is missing the prospects:enrich scope' },
      { status: 403, headers: CORS_HEADERS },
    )
  }

  // 2. Validate account exists + belongs to org + has a domain
  const { data: account } = await supabase
    .from('accounts')
    .select('id, domain, name')
    .eq('id', accountId)
    .eq('org_id', apiKey.org_id)
    .maybeSingle()

  if (!account) {
    return Response.json({ error: 'Account not found' }, { status: 404, headers: CORS_HEADERS })
  }
  if (!account.domain) {
    return Response.json(
      { error: 'Account has no domain — cannot analyse website' },
      { status: 422, headers: CORS_HEADERS },
    )
  }

  // 3. Create analysis row (pending)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wa = (supabase as any).from('website_analyses')
  const { data: analysis, error: insertError } = await wa
    .insert({ org_id: apiKey.org_id, account_id: accountId, status: 'pending' })
    .select('id')
    .single()

  if (insertError || !analysis) {
    console.error('[analyze] insert error:', insertError)
    return Response.json({ error: 'Failed to queue analysis' }, { status: 500, headers: CORS_HEADERS })
  }

  // 4. Fire-and-forget — works on long-running Node process (Hetzner)
  runAnalysis({
    analysisId: analysis.id,
    orgId:      apiKey.org_id,
    accountId,
    domain:     account.domain,
  }).catch((err) =>
    console.error('[analyze] unhandled runAnalysis error:', err),
  )

  return Response.json(
    { analysis_id: analysis.id, account_id: accountId, status: 'queued' },
    { status: 202, headers: CORS_HEADERS },
  )
}

// ── GET — check status / read results ────────────────────────────────────────

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: accountId } = await params

  const resolved = await resolveApiKey(request)
  if ('error' in resolved) {
    return Response.json({ error: resolved.error }, { status: resolved.status, headers: CORS_HEADERS })
  }
  const { apiKey, supabase } = resolved
  if (!hasScope(apiKey.scopes, 'prospects:enrich')) {
    return Response.json(
      { error: 'API key is missing the prospects:enrich scope' },
      { status: 403, headers: CORS_HEADERS },
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('website_analyses')
    .select(
      'id, account_id, status, lead_score, brand_colors, logo_url, services, pain_points, outreach_insights, screenshot_desktop_url, screenshot_mobile_url, analyzed_at, error_message',
    )
    .eq('account_id', accountId)
    .eq('org_id', apiKey.org_id)
    .order('created_at', { ascending: false })
    .limit(5)

  const analysis = resolveLatestAnalysisForDisplay(
    (data ?? []) as Array<{ status: AnalysisRowStatus; error_message?: unknown }>,
  )

  if (!analysis) {
    return Response.json({ error: 'No analysis found for this account' }, { status: 404, headers: CORS_HEADERS })
  }

  return Response.json(analysis, { status: 200, headers: CORS_HEADERS })
}
