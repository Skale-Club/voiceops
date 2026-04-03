'use server'

import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

type CallRow = Database['public']['Tables']['calls']['Row']

const PAGE_SIZE = 20

export async function getCalls({
  page = 1,
  from,
  to,
  status,
  assistantId,
  callType,
  q,
}: {
  page?: number
  from?: string
  to?: string
  status?: string
  assistantId?: string
  callType?: string
  q?: string
}): Promise<{ calls: CallRow[]; total: number }> {
  const supabase = await createClient()
  let query = supabase
    .from('calls')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

  if (from) query = query.gte('started_at', from)
  if (to) query = query.lte('started_at', to)
  if (status) query = query.eq('ended_reason', status)
  if (assistantId) query = query.eq('assistant_id', assistantId)
  if (callType) query = query.eq('call_type', callType)
  if (q) {
    query = query.or(`customer_number.ilike.%${q}%,customer_name.ilike.%${q}%`)
  }

  const { data, count, error } = await query
  if (error) throw new Error(error.message)
  return { calls: data ?? [], total: count ?? 0 }
}

export async function getAssistantOptions(): Promise<
  Array<{ vapi_assistant_id: string; name: string | null }>
> {
  const supabase = await createClient()
  // Get distinct assistant_ids that have calls, joined with assistant_mappings for names
  const { data, error } = await supabase
    .from('assistant_mappings')
    .select('vapi_assistant_id, name')
    .eq('is_active', true)
    .order('name', { ascending: true })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getDashboardMetrics(): Promise<{
  callsToday: number
  callsWeek: number
  callsMonth: number
  toolSuccessRate: number | null
  recentCalls: CallRow[]
  recentFailures: Database['public']['Tables']['action_logs']['Row'][]
}> {
  const supabase = await createClient()
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()

  const [todayRes, weekRes, monthRes, successRateRes, recentCallsRes, recentFailuresRes] =
    await Promise.all([
      supabase.from('calls').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
      supabase.from('calls').select('*', { count: 'exact', head: true }).gte('created_at', weekStart),
      supabase.from('calls').select('*', { count: 'exact', head: true }).gte('created_at', monthStart),
      supabase.from('action_logs').select('status').gte('created_at', monthStart),
      supabase.from('calls').select('*').order('created_at', { ascending: false }).limit(10),
      supabase
        .from('action_logs')
        .select('*')
        .in('status', ['error', 'timeout'])
        .gte('created_at', dayAgo)
        .order('created_at', { ascending: false })
        .limit(20),
    ])

  const logs = successRateRes.data ?? []
  const successRate =
    logs.length === 0
      ? null
      : Math.round((logs.filter((l) => l.status === 'success').length * 100) / logs.length)

  return {
    callsToday: todayRes.count ?? 0,
    callsWeek: weekRes.count ?? 0,
    callsMonth: monthRes.count ?? 0,
    toolSuccessRate: successRate,
    recentCalls: recentCallsRes.data ?? [],
    recentFailures: recentFailuresRes.data ?? [],
  }
}
