import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { Json } from '@/types/database'

export type AdsMemoryType = 'insight' | 'decision' | 'plan' | 'risk' | 'observation' | 'result' | 'goal'
export type AdsMemoryStatus = 'active' | 'archived' | 'superseded' | 'needs_review'
export type AdsMemorySource = 'chat' | 'mcp' | 'manual' | 'audit'

export type AdsMemory = {
  id: string
  org_id: string
  journey_id: string
  type: AdsMemoryType
  status: AdsMemoryStatus
  source: AdsMemorySource
  platform: 'meta' | 'google' | null
  title: string
  content: string
  campaign_id: string | null
  campaign_name: string | null
  confidence: number
  proposed: boolean
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

function db() { return createServiceRoleClient() }

/**
 * One journey per org. Uses an upsert on the existing UNIQUE(org_id) rather
 * than select-then-insert: two concurrent callers (a Copilot tool and a
 * dashboard mutation landing together) would both read "no journey" and the
 * loser's insert would fail on the unique constraint.
 */
export async function getOrCreateJourney(orgId: string): Promise<{ id: string }> {
  const { data: existing } = await db()
    .from('ads_journey')
    .select('id')
    .eq('org_id', orgId)
    .maybeSingle()

  if (existing) return existing as { id: string }

  const { data: created, error } = await db()
    .from('ads_journey')
    .upsert({ org_id: orgId, title: 'Ads Journey' }, { onConflict: 'org_id' })
    .select('id')
    .single()

  if (created) return created as { id: string }

  // Lost a race after the upsert (or RLS rejected it) — re-read before failing.
  const { data: raced } = await db()
    .from('ads_journey')
    .select('id')
    .eq('org_id', orgId)
    .maybeSingle()
  if (raced) return raced as { id: string }

  throw new Error(`Failed to create journey: ${error?.message ?? 'unknown error'}`)
}

export async function fetchRecentMemories(
  orgId: string,
  platform?: 'meta' | 'google',
  limit = 10,
): Promise<AdsMemory[]> {
  let q = db()
    .from('ads_memories')
    .select('*')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (platform) q = q.or(`platform.eq.${platform},platform.is.null`)

  const { data } = await q
  return (data ?? []) as AdsMemory[]
}

export async function createMemory(params: {
  orgId: string
  type: AdsMemoryType
  source: AdsMemorySource
  platform?: 'meta' | 'google'
  title: string
  content: string
  campaignId?: string
  campaignName?: string
  confidence?: number
  proposed?: boolean
  status?: AdsMemoryStatus
  metadata?: Record<string, unknown>
}): Promise<string | null> {
  try {
    const journey = await getOrCreateJourney(params.orgId)
    const { data, error } = await db()
      .from('ads_memories')
      .insert({
        org_id: params.orgId,
        journey_id: journey.id,
        type: params.type,
        status: params.status ?? (params.proposed ? 'needs_review' : 'active'),
        source: params.source,
        platform: params.platform ?? null,
        title: params.title,
        content: params.content,
        campaign_id: params.campaignId ?? null,
        campaign_name: params.campaignName ?? null,
        confidence: params.confidence ?? 3,
        proposed: params.proposed ?? false,
        metadata: (params.metadata ?? {}) as Json,
      })
      .select('id')
      .single()

    if (error) {
      // Callers treat null as "not saved" and carry on, but a memory silently
      // failing to persist is exactly the kind of thing that goes unnoticed for
      // weeks — say so on the way out.
      console.error('[ads/journey] failed to create memory:', error.message)
      return null
    }
    return data?.id ?? null
  } catch (err) {
    console.error('[ads/journey] failed to create memory:', err instanceof Error ? err.message : err)
    return null
  }
}

export type MutationToolName = 'pause_campaign' | 'enable_campaign' | 'set_daily_budget' | (string & {})

/**
 * Append an entry to the journey's execution log.
 *
 * This existed but was never wired to anything: campaigns paused and budgets
 * changed from the dashboard left no trace at all, so the journey's execution
 * timeline only ever showed what the AI claimed to have done. Every mutation
 * path now calls it with both the before and after values.
 *
 * Non-blocking by contract — a failure to write history must never fail the
 * mutation that already succeeded upstream.
 */
export async function recordMutationExecution(params: {
  toolName: MutationToolName
  orgId: string
  platform: 'meta' | 'google'
  campaignId?: string
  campaignName?: string
  beforeValue?: string | null
  afterValue?: string | null
  /** false for an operator acting in the dashboard, true for an AI tool call. */
  executedByAi?: boolean
  /** The acting user, when a human triggered it. */
  actorId?: string
}): Promise<void> {
  try {
    const journey = await getOrCreateJourney(params.orgId)
    const name = params.campaignName

    let type: string
    let title: string

    switch (params.toolName) {
      case 'pause_campaign':
        type = 'campaign_pause'
        title = name ? `Campaign paused: ${name}` : 'Campaign paused'
        break
      case 'enable_campaign':
        type = 'campaign_enable'
        title = name ? `Campaign enabled: ${name}` : 'Campaign enabled'
        break
      case 'set_daily_budget': {
        // Direction matters for the timeline: "budget_increase" on a cut reads
        // as the opposite of what happened.
        const before = parseAmount(params.beforeValue)
        const after = parseAmount(params.afterValue)
        type = before != null && after != null && after < before ? 'budget_decrease' : 'budget_increase'
        const suffix = params.afterValue ? ` → ${params.afterValue}/day` : ''
        title = name ? `Budget updated: ${name}${suffix}` : `Budget updated${suffix}`
        break
      }
      default:
        type = 'manual'
        title = `Action executed: ${params.toolName}`
    }

    await db().from('ads_executions').insert({
      org_id: params.orgId,
      journey_id: journey.id,
      type,
      platform: params.platform,
      title,
      campaign_id: params.campaignId ?? null,
      campaign_name: params.campaignName ?? null,
      before_value: params.beforeValue ?? null,
      after_value: params.afterValue ?? null,
      executed_by_ai: params.executedByAi ?? false,
      executed_by: params.actorId ?? null,
    })
  } catch (err) {
    // Non-blocking, but not invisible: a silently missing audit trail is how
    // this went unnoticed in the first place.
    console.error('[ads/journey] failed to record execution:', err instanceof Error ? err.message : err)
  }
}

/** Pull the numeric part out of a formatted money string ("R$ 1.234" → 1234). */
function parseAmount(value: string | null | undefined): number | null {
  if (!value) return null
  const digits = value.replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')
  const parsed = Number.parseFloat(digits)
  return Number.isFinite(parsed) ? parsed : null
}
