// Period-over-period comparison, served from stored history.
//
// This module previously built a text table for injection into the Copilot
// system prompt, by calling the Meta and Google APIs directly. It was never
// imported anywhere, formatted every currency as "$", and would have put two
// live API round-trips in front of every Copilot message — including the ones
// with nothing to do with ads. The live tools superseded it.
//
// What it does now is the thing the module was reaching for and could not do:
// answer "compared to what?". That needs history, which ads_insights_daily now
// holds, so a comparison costs one indexed query instead of re-fetching two
// windows from a rate-limited platform API — and still works for a window the
// operator has since disconnected the account for.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { formatCurrency, minorUnitsPerMajor } from './currency'
import { resolvePresetRange, previousRange, type PresetRange } from './date-range'

export type PeriodTotals = {
  impressions: number
  clicks: number
  spend: number
  conversions: number
  leads: number
  ctr: number | null
  cpc: number | null
  cpl: number | null
  currency: string
  days: number
}

export type PeriodComparison = {
  platform: 'meta' | 'google'
  adAccountId: string
  currency: string
  current: PeriodTotals & { range: PresetRange }
  previous: PeriodTotals & { range: PresetRange }
  /** Signed percentage change per metric; null when the baseline is zero. */
  deltaPct: Record<'impressions' | 'clicks' | 'spend' | 'conversions' | 'leads' | 'ctr' | 'cpc' | 'cpl', number | null>
  /** True when no stored history covers the window at all. */
  noData: boolean
}

type DailyRow = {
  impressions: number
  clicks: number
  spend_minor: number
  conversions: number
  leads: number
  currency: string
  stat_date: string
}

function emptyTotals(currency = 'USD'): PeriodTotals {
  return {
    impressions: 0, clicks: 0, spend: 0, conversions: 0, leads: 0,
    ctr: null, cpc: null, cpl: null, currency, days: 0,
  }
}

function aggregate(rows: DailyRow[]): PeriodTotals {
  if (!rows.length) return emptyTotals()

  const currency = rows[0].currency ?? 'USD'
  const perMajor = minorUnitsPerMajor(currency)

  let impressions = 0
  let clicks = 0
  let spendMinor = 0
  let conversions = 0
  let leads = 0
  const days = new Set<string>()

  for (const r of rows) {
    impressions += r.impressions
    clicks += r.clicks
    // Spend is summed in integer minor units, then converted once — summing
    // floats across a quarter drifts.
    spendMinor += r.spend_minor
    conversions += Number(r.conversions)
    leads += r.leads
    days.add(r.stat_date)
  }

  const spend = spendMinor / perMajor

  return {
    impressions,
    clicks,
    spend,
    conversions,
    leads,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
    cpc: clicks > 0 ? spend / clicks : null,
    cpl: leads > 0 ? spend / leads : null,
    currency,
    days: days.size,
  }
}

/** Signed percent change. Null when there's no baseline to compare against. */
function pctChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null
  if (previous === 0) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

async function fetchRange(
  orgId: string,
  platform: 'meta' | 'google',
  adAccountId: string,
  range: PresetRange,
): Promise<DailyRow[]> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('ads_insights_daily')
    .select('impressions, clicks, spend_minor, conversions, leads, currency, stat_date')
    .eq('org_id', orgId)
    .eq('platform', platform)
    .eq('ad_account_id', adAccountId)
    .gte('stat_date', range.since)
    .lte('stat_date', range.until)
  return (data ?? []) as DailyRow[]
}

/**
 * Compare a window against the immediately preceding window of equal length.
 *
 * Reads only from ads_insights_daily, so it returns `noData: true` rather than
 * silently reporting zeros when the nightly snapshot hasn't run for this
 * account yet — a fabricated "-100%" is worse than an honest gap.
 */
export async function compareAdsPeriods(params: {
  orgId: string
  platform: 'meta' | 'google'
  adAccountId: string
  preset?: string
  now?: Date
}): Promise<PeriodComparison> {
  const currentRange = resolvePresetRange(params.preset ?? 'last_30d', params.now)
  const priorRange = previousRange(currentRange)

  const [currentRows, priorRows] = await Promise.all([
    fetchRange(params.orgId, params.platform, params.adAccountId, currentRange),
    fetchRange(params.orgId, params.platform, params.adAccountId, priorRange),
  ])

  const current = aggregate(currentRows)
  const previous = aggregate(priorRows)
  const currency = currentRows[0]?.currency ?? priorRows[0]?.currency ?? 'USD'

  return {
    platform: params.platform,
    adAccountId: params.adAccountId,
    currency,
    current: { ...current, currency, range: currentRange },
    previous: { ...previous, currency, range: priorRange },
    deltaPct: {
      impressions: pctChange(current.impressions, previous.impressions),
      clicks: pctChange(current.clicks, previous.clicks),
      spend: pctChange(current.spend, previous.spend),
      conversions: pctChange(current.conversions, previous.conversions),
      leads: pctChange(current.leads, previous.leads),
      ctr: pctChange(current.ctr, previous.ctr),
      cpc: pctChange(current.cpc, previous.cpc),
      cpl: pctChange(current.cpl, previous.cpl),
    },
    noData: currentRows.length === 0 && priorRows.length === 0,
  }
}

/** One-line human summary, in the account's own currency. */
export function describeComparison(cmp: PeriodComparison): string {
  if (cmp.noData) {
    return 'No stored history for this account yet — the nightly snapshot has not captured it.'
  }
  const spend = formatCurrency(cmp.current.spend, cmp.currency)
  const cpl = cmp.current.cpl != null ? formatCurrency(cmp.current.cpl, cmp.currency) : '—'
  const cplDelta = cmp.deltaPct.cpl
  const trend = cplDelta === null ? '' : ` (${cplDelta > 0 ? '+' : ''}${cplDelta.toFixed(1)}% vs previous period)`
  return `${spend} spent, ${cmp.current.leads} leads, CPL ${cpl}${trend}.`
}
