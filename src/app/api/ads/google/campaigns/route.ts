import { NextRequest } from 'next/server'
import { z } from 'zod'

import { captureApiError } from '@/lib/api-error'
import { invalidateAccountReports } from '@/lib/ads/cache'
import { withConnectionHealth } from '@/lib/ads/connection-health'
import { formatGoogleMicros } from '@/lib/ads/currency'
import {
  parseTokens,
  updateCampaignStatus,
  updateCampaignBudget,
  getCampaignSnapshot,
  GoogleAdsError,
} from '@/lib/ads/google-api'
import { recordMutationExecution } from '@/lib/ads/journey-db'
import { NumericIdSchema } from '@/lib/ads/validation'
import { decrypt } from '@/lib/crypto'
import { can } from '@/lib/rbac/server'
import { createClient, getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/** See the Meta route for the rationale — same ceiling, same override. */
const DEFAULT_MAX_DAILY_BUDGET = 10_000

function maxDailyBudget(): number {
  const raw = Number(process.env.ADS_MAX_DAILY_BUDGET)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_DAILY_BUDGET
}

const MutateSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set_status'),
    customer_id: NumericIdSchema,
    campaign_id: NumericIdSchema,
    status: z.enum(['ENABLED', 'PAUSED']),
  }),
  // Plain objects only — a .refine() would make this a ZodEffects, which zod
  // will not accept inside a discriminated union. The "one budget field is
  // required" rule is checked after parsing.
  z.object({
    action: z.literal('set_budget'),
    customer_id: NumericIdSchema,
    budget_id: NumericIdSchema,
    campaign_id: NumericIdSchema.optional(),
    /** Major currency units per day. Google stores micros (1e6 per unit). */
    daily_budget: z.number().positive().optional(),
    /** Legacy name from the existing dashboard caller — same major units. */
    daily_budget_usd: z.number().positive().optional(),
  }),
])

function err(msg: string, status = 400) {
  return Response.json({ error: msg }, { status })
}

export async function POST(request: NextRequest): Promise<Response> {
  const user = await getUser()
  if (!user) return err('Unauthorized', 401)

  if (!(await can('ads.manage'))) {
    return err('You do not have permission to manage ads.', 403)
  }

  let body: unknown
  try { body = await request.json() } catch { return err('Invalid JSON') }

  const parsed = MutateSchema.safeParse(body)
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid request')

  const data = parsed.data
  if (data.action === 'set_budget' && data.daily_budget == null && data.daily_budget_usd == null) {
    return err('Provide daily_budget (major currency units)')
  }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return err('No active org')

  const { data: conn } = await supabase
    .from('ads_connections')
    .select('encrypted_access_token')
    .eq('org_id', orgId as string)
    .eq('ad_account_id', data.customer_id)
    .eq('platform', 'google')
    .eq('usable', true)
    .maybeSingle()

  if (!conn) return err('No active Google Ads connection', 404)

  const tokens = parseTokens(await decrypt(conn.encrypted_access_token))
  const health = { orgId: orgId as string, platform: 'google' as const, adAccountId: data.customer_id }

  try {
    if (data.action === 'set_status') {
      const before = await getCampaignSnapshot(data.customer_id, data.campaign_id, tokens.refresh_token)
        .catch(() => null)

      await withConnectionHealth(health, () =>
        updateCampaignStatus(data.customer_id, data.campaign_id, data.status, tokens.refresh_token),
      )

      await recordMutationExecution({
        orgId: orgId as string,
        platform: 'google',
        toolName: data.status === 'PAUSED' ? 'pause_campaign' : 'enable_campaign',
        executedByAi: false,
        actorId: user.id,
        campaignId: data.campaign_id,
        campaignName: before?.name,
        beforeValue: before?.status,
        afterValue: data.status,
      })
      await invalidateAccountReports(orgId as string, 'google', data.customer_id)

      return Response.json({ ok: true })
    }

    const budgetMajor = (data.daily_budget ?? data.daily_budget_usd) as number
    const ceiling = maxDailyBudget()
    if (budgetMajor > ceiling) {
      return err(
        `Daily budget ${budgetMajor} exceeds the ${ceiling} limit for a single change.`,
        422,
      )
    }

    const before = data.campaign_id
      ? await getCampaignSnapshot(data.customer_id, data.campaign_id, tokens.refresh_token).catch(() => null)
      : null
    const currency = before?.currency ?? 'USD'

    // Google money is always micros — 1e6 per major unit — regardless of the
    // account currency, so this conversion is currency-independent.
    const amountMicros = Math.round(budgetMajor * 1_000_000)

    await withConnectionHealth(health, () =>
      updateCampaignBudget(data.customer_id, data.budget_id, amountMicros, tokens.refresh_token),
    )

    await recordMutationExecution({
      orgId: orgId as string,
      platform: 'google',
      toolName: 'set_daily_budget',
      executedByAi: false,
      actorId: user.id,
      campaignId: data.campaign_id,
      campaignName: before?.name,
      beforeValue: before ? formatGoogleMicros(before.budgetAmountMicros, currency) : undefined,
      afterValue: formatGoogleMicros(amountMicros, currency),
    })
    await invalidateAccountReports(orgId as string, 'google', data.customer_id)

    return Response.json({ ok: true })
  } catch (e) {
    captureApiError(e, { route: 'ads/google/campaigns', action: data.action, orgId })
    if (e instanceof GoogleAdsError) return Response.json({ error: e.message, code: e.code }, { status: 502 })
    return Response.json({ error: 'Google Ads API error' }, { status: 502 })
  }
}
