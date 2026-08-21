// Copilot tools for the Ads Journey.
//
// These make the Copilot a first-class operator of the ads journey: it can read
// the journey state, GROUND its thinking in Global Knowledge (curated
// fundamentals), inspect live Meta metrics + CRM attribution, and record what it
// learns as memories/plans for the operator to approve. The system prompt
// instructs the Copilot to ACTIVATE the journey for any ads request.

import type { CopilotToolRegistry, ToolContext, ToolResult } from './types'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createMemory, getOrCreateJourney } from '@/lib/ads/journey-db'
import type { AdsMemoryType } from '@/lib/ads/journey-db'
import { searchGlobalKnowledge } from '@/lib/knowledge/global-knowledge'
import { getInsights, listCampaigns, getAdAccountInfo } from '@/lib/ads/meta-api'
import type { DatePreset } from '@/lib/ads/meta-api'
import { resolveAdAccount } from '@/lib/ads/ai-accounts'
import { formatCurrency } from '@/lib/ads/currency'
import {
  parseTokens,
  getAccountOverview,
  listCampaigns as googleListCampaigns,
  buildGaqlDateCondition,
} from '@/lib/ads/google-api'
import { getCustomerInfo, refreshAccessToken } from '@/lib/ads/google-oauth'
import { compareAdsPeriods, describeComparison } from '@/lib/ads/snapshot'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return createServiceRoleClient() as any }

type Platform = 'meta' | 'google'

function parseLeads(actions?: Array<{ action_type: string; value: string }>): number {
  return parseFloat(actions?.find((a) => a.action_type === 'lead')?.value ?? '0')
}

// ─── Read: journey state ──────────────────────────────────────────────────────
async function queryAdsJourney(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const platform = input.platform as Platform | undefined
  const limit = Math.min(Number(input.limit ?? 10), 50)
  const orgId = ctx.orgId

  let memQ = db()
    .from('ads_memories')
    .select('id, type, status, platform, title, content, campaign_name, confidence, created_at')
    .eq('org_id', orgId)
    .in('status', ['active', 'needs_review'])
    .order('created_at', { ascending: false })
    .limit(limit)
  if (platform) memQ = memQ.or(`platform.eq.${platform},platform.is.null`)

  let execQ = db()
    .from('ads_executions')
    .select('id, type, platform, title, campaign_name, after_value, executed_by_ai, executed_at')
    .eq('org_id', orgId)
    .order('executed_at', { ascending: false })
    .limit(limit)
  if (platform) execQ = execQ.eq('platform', platform)

  let planQ = db()
    .from('ads_plans')
    .select('id, type, title, description, platform, metric, target_value, deadline, status')
    .eq('org_id', orgId)
    .in('status', ['active', 'draft'])
    .order('created_at', { ascending: false })
    .limit(limit)
  if (platform) planQ = planQ.or(`platform.eq.${platform},platform.is.null`)

  const [{ data: memories }, { data: executions }, { data: plans }] = await Promise.all([memQ, execQ, planQ])
  return { success: true, data: { memories: memories ?? [], executions: executions ?? [], plans: plans ?? [], platform: platform ?? 'all' } }
}

// ─── Read: Global Knowledge (fundamentals) ─────────────────────────────────
async function searchGlobalKnowledgeTool(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const query = String(input.query ?? '').trim()
  if (!query) return { success: false, error: 'query is required' }
  const result = await searchGlobalKnowledge({
    orgId: ctx.orgId,
    query,
    platform: input.platform as Platform | undefined,
    topK: input.top_k ? Math.min(Number(input.top_k), 20) : 6,
  })
  if ('error' in result) return { success: false, error: result.detail ?? result.error }
  return { success: true, data: result }
}

// ─── Read: live Meta metrics ──────────────────────────────────────────────────
async function getAdsOverview(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const conn = await resolveAdAccount(ctx.orgId, 'meta', input.ad_account_id as string | undefined)
  if (!conn.ok) return { success: false, error: conn.detail, data: { available_accounts: conn.available } }

  const datePreset = (input.date_preset as DatePreset) ?? 'last_30d'
  try {
    const [info, insights] = await Promise.all([
      getAdAccountInfo(conn.accountId, conn.token),
      getInsights(conn.accountId, conn.token, { level: 'account', datePreset }),
    ])
    const raw = insights.data[0] ?? null
    const leads = raw ? parseLeads(raw.actions) : 0
    const spend = raw ? parseFloat(raw.spend ?? '0') : 0
    const currency = info.currency
    return {
      success: true,
      data: {
        ad_account_id: conn.accountId,
        ad_account_name: info.name,
        currency,
        date_preset: datePreset,
        metrics: raw ? {
          spend, leads,
          spend_formatted: formatCurrency(spend, currency),
          impressions: parseInt(raw.impressions ?? '0', 10),
          clicks: parseInt(raw.clicks ?? '0', 10),
          ctr: raw.ctr ? parseFloat(raw.ctr) : null,
          cpm: raw.cpm ? parseFloat(raw.cpm) : null,
          cpc: raw.cpc ? parseFloat(raw.cpc) : null,
          cpl: leads > 0 ? spend / leads : null,
          cpl_formatted: leads > 0 ? formatCurrency(spend / leads, currency) : null,
        } : null,
      },
    }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Meta API error' }
  }
}

async function listAdsCampaigns(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const conn = await resolveAdAccount(ctx.orgId, 'meta', input.ad_account_id as string | undefined)
  if (!conn.ok) return { success: false, error: conn.detail, data: { available_accounts: conn.available } }

  const datePreset = (input.date_preset as DatePreset) ?? 'last_30d'
  try {
    const [info, campaigns, insights] = await Promise.all([
      getAdAccountInfo(conn.accountId, conn.token).catch(() => null),
      listCampaigns(conn.accountId, conn.token),
      getInsights(conn.accountId, conn.token, {
        level: 'campaign', datePreset,
        fields: ['impressions', 'clicks', 'spend', 'cpc', 'cpm', 'ctr', 'actions', 'campaign_id', 'campaign_name'],
      }),
    ])
    const currency = info?.currency ?? 'USD'
    const map = new Map(insights.data.map((i) => [(i as unknown as Record<string, string>).campaign_id, i]))
    const enriched = campaigns.map((c) => {
      const ins = map.get(c.id)
      const leads = ins ? parseLeads(ins.actions) : 0
      const spend = ins ? parseFloat(ins.spend ?? '0') : 0
      return {
        id: c.id, name: c.name, status: c.effective_status, objective: c.objective,
        // Meta budgets come back in the account's minor units.
        daily_budget: c.daily_budget ? parseFloat(c.daily_budget) / 100 : null,
        spend, leads,
        ctr: ins?.ctr ? parseFloat(ins.ctr) : null,
        cpl: leads > 0 ? spend / leads : null,
      }
    })
    return {
      success: true,
      data: {
        ad_account_id: conn.accountId,
        currency,
        campaigns: enriched,
        total: enriched.length,
      },
    }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Meta API error' }
  }
}

// ─── Read: live Google Ads metrics ────────────────────────────────────────────
// The Copilot could read Meta but not Google, while the journey happily
// accepted platform='google' — so it could plan against an account it had no
// way to look at.

async function getGoogleAdsOverview(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const conn = await resolveAdAccount(ctx.orgId, 'google', input.customer_id as string | undefined)
  if (!conn.ok) return { success: false, error: conn.detail, data: { available_accounts: conn.available } }

  try {
    const tokens = parseTokens(conn.token)
    const duration = buildGaqlDateCondition(String(input.date_preset ?? 'last_30d'))
    const [info, overview] = await Promise.all([
      refreshAccessToken(tokens.refresh_token)
        .then((at) => getCustomerInfo(conn.accountId, at))
        .catch(() => null),
      getAccountOverview(conn.accountId, tokens.refresh_token, duration),
    ])

    const currency = info?.currency_code ?? 'USD'
    // Google money is micros — 1e6 per major unit — in every currency.
    const cost = Number(overview.costMicros) / 1_000_000
    const conversions = parseFloat(overview.conversions)

    return {
      success: true,
      data: {
        customer_id: conn.accountId,
        customer_name: info?.name ?? conn.accountName,
        currency,
        metrics: {
          cost,
          cost_formatted: formatCurrency(cost, currency),
          impressions: parseInt(overview.impressions, 10),
          clicks: parseInt(overview.clicks, 10),
          conversions,
          ctr: parseFloat(overview.ctr),
          cost_per_conversion: conversions > 0 ? cost / conversions : null,
        },
      },
    }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Google Ads API error' }
  }
}

async function listGoogleAdsCampaigns(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const conn = await resolveAdAccount(ctx.orgId, 'google', input.customer_id as string | undefined)
  if (!conn.ok) return { success: false, error: conn.detail, data: { available_accounts: conn.available } }

  try {
    const tokens = parseTokens(conn.token)
    const duration = buildGaqlDateCondition(String(input.date_preset ?? 'last_30d'))
    const [info, campaigns] = await Promise.all([
      refreshAccessToken(tokens.refresh_token)
        .then((at) => getCustomerInfo(conn.accountId, at))
        .catch(() => null),
      googleListCampaigns(conn.accountId, tokens.refresh_token, duration),
    ])
    const currency = info?.currency_code ?? 'USD'

    const enriched = campaigns.map((c) => {
      const cost = Number(c.costMicros) / 1_000_000
      const conversions = parseFloat(c.conversions)
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        channel_type: c.channelType,
        daily_budget: Number(c.budgetAmountMicros) / 1_000_000,
        cost,
        clicks: parseInt(c.clicks, 10),
        conversions,
        cpa: conversions > 0 ? cost / conversions : null,
      }
    })

    return {
      success: true,
      data: { customer_id: conn.accountId, currency, campaigns: enriched, total: enriched.length },
    }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Google Ads API error' }
  }
}

// ─── Read: period-over-period comparison ──────────────────────────────────────
// Answers "compared to what?" from stored history instead of re-fetching two
// windows from a rate-limited API — and still works for a window whose account
// has since been disconnected.

async function comparePeriods(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const platform = (input.platform as Platform | undefined) ?? 'meta'
  const conn = await resolveAdAccount(
    ctx.orgId,
    platform,
    (input.ad_account_id ?? input.customer_id) as string | undefined,
  )
  if (!conn.ok) return { success: false, error: conn.detail, data: { available_accounts: conn.available } }

  const comparison = await compareAdsPeriods({
    orgId: ctx.orgId,
    platform,
    adAccountId: conn.accountId,
    preset: String(input.date_preset ?? 'last_30d'),
  })

  return { success: true, data: { ...comparison, summary: describeComparison(comparison) } }
}

// ─── Write: record memories / plans ───────────────────────────────────────────
async function writeMemory(input: Record<string, unknown>, ctx: ToolContext, proposed: boolean): Promise<ToolResult> {
  const id = await createMemory({
    orgId: ctx.orgId,
    type: input.type as AdsMemoryType,
    source: 'chat',
    platform: input.platform as Platform | undefined,
    title: String(input.title ?? ''),
    content: String(input.content ?? ''),
    campaignName: input.campaign_name as string | undefined,
    confidence: input.confidence ? Number(input.confidence) : (proposed ? 2 : 4),
    proposed,
    status: proposed ? 'needs_review' : 'active',
  })
  if (!id) return { success: false, error: 'Failed to save memory' }
  return { success: true, data: { id, status: proposed ? 'needs_review' : 'active' } }
}

async function createAdsPlan(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const journey = await getOrCreateJourney(ctx.orgId)
  const { data, error } = await db()
    .from('ads_plans')
    .insert({
      org_id: ctx.orgId,
      journey_id: journey.id,
      type: input.type,
      title: String(input.title ?? ''),
      description: (input.description as string | undefined) ?? null,
      platform: (input.platform as Platform | undefined) ?? null,
      metric: (input.metric as string | undefined) ?? null,
      target_value: input.target_value != null ? Number(input.target_value) : null,
      deadline: (input.deadline as string | undefined) ?? null,
      status: 'active',
    })
    .select('id')
    .single()
  if (error) return { success: false, error: error.message }
  return { success: true, data: { id: data.id } }
}

const PLATFORM_PROP = { type: 'string', enum: ['meta', 'google'], description: 'Ad platform (omit for cross-platform)' }
const MEMORY_TYPE_PROP = { type: 'string', enum: ['insight', 'decision', 'plan', 'risk', 'observation', 'result', 'goal'] }

export const adsTools: CopilotToolRegistry = {
  query_ads_journey: {
    mode: 'read',
    definition: {
      name: 'query_ads_journey',
      description: 'Get the current ads journey state: recent memories (insights/decisions/plans/risks), recent executions (pauses/budget changes), and active plans. ALWAYS call this first when the operator asks anything about ads.',
      input_schema: { type: 'object', properties: { platform: PLATFORM_PROP, limit: { type: 'number', description: 'Max items per section (default 10, max 50)' } } },
    },
    handler: queryAdsJourney,
  },
  search_global_knowledge: {
    mode: 'read',
    definition: {
      name: 'search_global_knowledge',
      description: 'Semantic search over Global Knowledge by media. Use this to ground every diagnosis and recommendation in curated fundamentals before proposing changes.',
      input_schema: { type: 'object', properties: { query: { type: 'string', description: 'What you need fundamentals about (e.g. "scaling a winning ABO campaign on Meta")' }, platform: PLATFORM_PROP, top_k: { type: 'number', description: 'Max passages (default 6, max 20)' } }, required: ['query'] },
    },
    handler: searchGlobalKnowledgeTool,
  },
  get_ads_overview: {
    mode: 'read',
    definition: {
      name: 'get_ads_overview',
      description: "Account-level Meta Ads performance: spend, leads, impressions, clicks, CTR, CPM, CPC, CPL. Money is in the account currency returned with it — never assume dollars. If the org has several active Meta accounts and none is given, this returns the list so you can ask which one rather than reporting the wrong account's numbers.",
      input_schema: {
        type: 'object',
        properties: {
          date_preset: { type: 'string', description: 'e.g. last_7d, last_30d (default), last_90d, this_month' },
          ad_account_id: { type: 'string', description: "Required when the org has more than one active Meta account (e.g. 'act_123456789')" },
        },
      },
    },
    handler: getAdsOverview,
  },
  list_ads_campaigns: {
    mode: 'read',
    definition: {
      name: 'list_ads_campaigns',
      description: 'List Meta Ads campaigns with status, spend, leads, CTR and CPL. Use to find which campaigns to diagnose. Money is in the account currency returned with it.',
      input_schema: {
        type: 'object',
        properties: {
          date_preset: { type: 'string', description: 'e.g. last_7d, last_30d (default), last_90d' },
          ad_account_id: { type: 'string', description: 'Required when the org has more than one active Meta account' },
        },
      },
    },
    handler: listAdsCampaigns,
  },
  get_google_ads_overview: {
    mode: 'read',
    definition: {
      name: 'get_google_ads_overview',
      description: 'Account-level Google Ads performance: cost, impressions, clicks, CTR, conversions and cost per conversion. Money is in the account currency returned with it.',
      input_schema: {
        type: 'object',
        properties: {
          date_preset: { type: 'string', description: 'e.g. last_7d, last_30d (default), last_90d' },
          customer_id: { type: 'string', description: 'Required when the org has more than one active Google Ads account' },
        },
      },
    },
    handler: getGoogleAdsOverview,
  },
  list_google_ads_campaigns: {
    mode: 'read',
    definition: {
      name: 'list_google_ads_campaigns',
      description: 'List Google Ads campaigns with status, channel type, daily budget, cost, clicks, conversions and CPA.',
      input_schema: {
        type: 'object',
        properties: {
          date_preset: { type: 'string', description: 'e.g. last_7d, last_30d (default), last_90d' },
          customer_id: { type: 'string', description: 'Required when the org has more than one active Google Ads account' },
        },
      },
    },
    handler: listGoogleAdsCampaigns,
  },
  compare_ads_periods: {
    mode: 'read',
    definition: {
      name: 'compare_ads_periods',
      description: "Compare a window against the immediately preceding window of equal length, from Xphere's own stored daily history: spend, leads, conversions, CTR, CPC, CPL and the percentage change in each. Use this whenever the operator asks whether something got better or worse, or before claiming a trend. Returns noData:true when history hasn't been captured yet — say so rather than reporting zeros as a decline.",
      input_schema: {
        type: 'object',
        properties: {
          platform: PLATFORM_PROP,
          date_preset: { type: 'string', description: 'Window to evaluate, e.g. last_7d, last_30d (default), last_90d' },
          ad_account_id: { type: 'string', description: 'Meta account id, when the org has more than one' },
          customer_id: { type: 'string', description: 'Google Ads customer id, when the org has more than one' },
        },
      },
    },
    handler: comparePeriods,
  },
  create_ads_memory: {
    mode: 'write',
    definition: {
      name: 'create_ads_memory',
      description: 'Record a confirmed insight/decision/plan/risk/observation/result/goal into the journey (status active). Use for things the operator confirmed or that are clearly true.',
      input_schema: { type: 'object', properties: { type: MEMORY_TYPE_PROP, title: { type: 'string' }, content: { type: 'string' }, platform: PLATFORM_PROP, campaign_name: { type: 'string' }, confidence: { type: 'number', description: '1-5' } }, required: ['type', 'title', 'content'] },
    },
    handler: (input, ctx) => writeMemory(input, ctx, false),
  },
  propose_ads_memory: {
    mode: 'write',
    definition: {
      name: 'propose_ads_memory',
      description: 'Propose a memory for the operator to review/approve (status needs_review). Use when less certain — proposals show in the journey Story tab with approve/dismiss.',
      input_schema: { type: 'object', properties: { type: MEMORY_TYPE_PROP, title: { type: 'string' }, content: { type: 'string' }, platform: PLATFORM_PROP, campaign_name: { type: 'string' }, confidence: { type: 'number', description: '1-5' } }, required: ['type', 'title', 'content'] },
    },
    handler: (input, ctx) => writeMemory(input, ctx, true),
  },
  create_ads_plan: {
    mode: 'write',
    definition: {
      name: 'create_ads_plan',
      description: 'Create a strategy, hypothesis, target, or experiment in the journey Planning tab. Ground it in Global Knowledge.',
      input_schema: { type: 'object', properties: { type: { type: 'string', enum: ['strategy', 'hypothesis', 'target', 'experiment'] }, title: { type: 'string' }, description: { type: 'string' }, platform: PLATFORM_PROP, metric: { type: 'string' }, target_value: { type: 'number' }, deadline: { type: 'string', description: 'ISO date' } }, required: ['type', 'title'] },
    },
    handler: createAdsPlan,
  },
}
