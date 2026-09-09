import { NextRequest } from 'next/server'
import { z } from 'zod'

import { captureApiError } from '@/lib/api-error'
import { invalidateAccountReports } from '@/lib/ads/cache'
import { withConnectionHealth } from '@/lib/ads/connection-health'
import { toMetaMinorUnits, formatMetaBudget } from '@/lib/ads/currency'
import { recordMutationExecution } from '@/lib/ads/journey-db'
import {
  updateCampaignStatus,
  updateCampaignDailyBudget,
  getCampaign,
  getAdAccountInfo,
  MetaAdsError,
} from '@/lib/ads/meta-api'
import { MetaAdAccountIdSchema, MetaObjectIdSchema } from '@/lib/ads/validation'
import { decrypt } from '@/lib/crypto'
import { can } from '@/lib/rbac/server'
import { createClient, getUser } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/**
 * Hard ceiling on a single daily-budget change, in the account's major currency
 * unit. Budget edits spend real money and this endpoint is reachable by any
 * authenticated org member with `ads.manage`; a fat-fingered extra zero should
 * fail loudly rather than quietly become tomorrow's spend. Override per
 * deployment with ADS_MAX_DAILY_BUDGET.
 */
const DEFAULT_MAX_DAILY_BUDGET = 10_000

function maxDailyBudget(): number {
  const raw = Number(process.env.ADS_MAX_DAILY_BUDGET)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_DAILY_BUDGET
}

const MutateSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set_status'),
    campaign_id: MetaObjectIdSchema,
    ad_account_id: MetaAdAccountIdSchema,
    status: z.enum(['ACTIVE', 'PAUSED']),
  }),
  // A discriminated union can only hold plain objects — a .refine() here turns
  // the member into a ZodEffects and zod rejects it. The "one of the two budget
  // fields is required" rule is enforced right after parsing instead.
  z.object({
    action: z.literal('set_daily_budget'),
    campaign_id: MetaObjectIdSchema,
    ad_account_id: MetaAdAccountIdSchema,
    /** Major currency units (e.g. 50 = R$50/day on a BRL account). */
    daily_budget: z.number().positive().optional(),
    /** Legacy field kept for existing callers that already send cents. */
    daily_budget_cents: z.number().int().positive().optional(),
  }),
])

function err(msg: string, status = 400) {
  return Response.json({ error: msg }, { status })
}

export async function POST(request: NextRequest): Promise<Response> {
  const user = await getUser()
  if (!user) return err('Unauthorized', 401)

  // Reading ad performance and *changing* it are different privileges. Without
  // this gate any org member could pause a campaign or move a budget.
  if (!(await can('ads.manage'))) {
    return err('You do not have permission to manage ads.', 403)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return err('Invalid JSON')
  }

  const parsed = MutateSchema.safeParse(body)
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? 'Invalid request')

  const data = parsed.data
  if (data.action === 'set_daily_budget' && data.daily_budget == null && data.daily_budget_cents == null) {
    return err('Provide daily_budget (major currency units) or daily_budget_cents')
  }
  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return err('No active org')

  const { data: conn } = await supabase
    .from('ads_connections')
    .select('encrypted_access_token')
    .eq('org_id', orgId as string)
    .eq('ad_account_id', data.ad_account_id)
    .eq('platform', 'meta')
    .eq('usable', true)
    .maybeSingle()

  if (!conn) return err('No active Meta Ads connection', 404)

  const accessToken = await decrypt(conn.encrypted_access_token)
  const health = { orgId: orgId as string, platform: 'meta' as const, adAccountId: data.ad_account_id }

  try {
    // Capture the pre-change state so the audit record says what actually
    // changed, not just what it was set to.
    const before = await getCampaign(data.campaign_id, accessToken)

    if (data.action === 'set_status') {
      const result = await withConnectionHealth(health, () =>
        updateCampaignStatus(data.campaign_id, data.status, accessToken),
      )

      await recordMutationExecution({
        orgId: orgId as string,
        platform: 'meta',
        toolName: data.status === 'PAUSED' ? 'pause_campaign' : 'enable_campaign',
        executedByAi: false,
        actorId: user.id,
        campaignId: data.campaign_id,
        campaignName: before?.name,
        beforeValue: before?.effective_status ?? before?.status,
        afterValue: data.status,
      })
      await invalidateAccountReports(orgId as string, 'meta', data.ad_account_id)

      return Response.json(result)
    }

    // Budgets are denominated in the account's own currency; resolve it so the
    // cents conversion and the audit trail are both correct on a BRL/JPY
    // account instead of assuming USD.
    const account = await getAdAccountInfo(data.ad_account_id, accessToken).catch(() => null)
    const currency = account?.currency ?? 'USD'

    const budgetMajor = data.daily_budget ?? (data.daily_budget_cents as number) / 100
    const ceiling = maxDailyBudget()
    if (budgetMajor > ceiling) {
      return err(
        `Daily budget ${formatMetaBudget(toMetaMinorUnits(budgetMajor, currency), currency)} exceeds the ${formatMetaBudget(toMetaMinorUnits(ceiling, currency), currency)} limit for a single change.`,
        422,
      )
    }

    const minorUnits = data.daily_budget != null
      ? toMetaMinorUnits(data.daily_budget, currency)
      : (data.daily_budget_cents as number)

    const result = await withConnectionHealth(health, () =>
      updateCampaignDailyBudget(data.campaign_id, minorUnits, accessToken),
    )

    await recordMutationExecution({
      orgId: orgId as string,
      platform: 'meta',
      toolName: 'set_daily_budget',
      executedByAi: false,
      actorId: user.id,
      campaignId: data.campaign_id,
      campaignName: before?.name,
      beforeValue: before?.daily_budget ? formatMetaBudget(before.daily_budget, currency) : undefined,
      afterValue: formatMetaBudget(minorUnits, currency),
    })
    await invalidateAccountReports(orgId as string, 'meta', data.ad_account_id)

    return Response.json(result)
  } catch (e) {
    captureApiError(e, { route: 'ads/meta/campaigns', action: data.action, orgId })
    if (e instanceof MetaAdsError) {
      return Response.json({ error: e.message, code: e.code }, { status: 502 })
    }
    return Response.json({ error: 'Meta API error' }, { status: 502 })
  }
}
