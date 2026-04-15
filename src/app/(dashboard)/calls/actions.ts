'use server'

import { createClient, getUser } from '@/lib/supabase/server'
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
  const user = await getUser()
  if (!user) return { calls: [], total: 0 }
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
  trends: {
    today: { date: string; value: number }[]
    week: { date: string; value: number }[]
    month: { date: string; value: number }[]
  }
}> {
  const supabase = await createClient()
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const weekStartTs = now.getTime() - 7 * 24 * 60 * 60 * 1000
  const weekStart = new Date(weekStartTs).toISOString()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  // Limits trend payload; displayed counts come from head:true counts below (accurate).
  const TREND_FETCH_LIMIT = 5000
  const rangeStart = monthStart < weekStart ? monthStart : weekStart

  const [
    trendRes,
    monthCountRes,
    weekCountRes,
    todayCountRes,
    actionLogsTotalRes,
    actionLogsSuccessRes,
    recentCallsRes,
    recentFailuresRes,
  ] = await Promise.all([
    supabase
      .from('calls')
      .select('created_at')
      .gte('created_at', rangeStart)
      .order('created_at', { ascending: false })
      .limit(TREND_FETCH_LIMIT),
    supabase.from('calls').select('*', { count: 'exact', head: true }).gte('created_at', monthStart),
    supabase.from('calls').select('*', { count: 'exact', head: true }).gte('created_at', weekStart),
    supabase.from('calls').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
    supabase
      .from('action_logs')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', monthStart),
    supabase
      .from('action_logs')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', monthStart)
      .eq('status', 'success'),
    supabase.from('calls').select('*').order('created_at', { ascending: false }).limit(10),
    supabase
      .from('action_logs')
      .select('*')
      .in('status', ['error', 'timeout'])
      .gte('created_at', dayAgo)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const trendRows = trendRes.data ?? []
  const monthCalls = trendRows.filter((c) => c.created_at >= monthStart)
  const weekCalls = trendRows.filter((c) => new Date(c.created_at).getTime() >= weekStartTs)
  const todayCalls = monthCalls.filter((c) => c.created_at >= todayStart)

  const totalLogs = actionLogsTotalRes.count ?? 0
  const successLogs = actionLogsSuccessRes.count ?? 0
  const monthCount = monthCountRes.count ?? 0
  const successRate =
    totalLogs === 0 || monthCount === 0
      ? null
      : Math.round((successLogs * 100) / totalLogs)

  // Today buckets (24 hours)
  const todayTrend = Array.from({ length: 24 }, (_, i) => ({
    date: `${String(i).padStart(2, '0')}:00`,
    value: 0
  }))
  todayCalls.forEach(call => {
    const hour = new Date(call.created_at).getHours()
    if (hour >= 0 && hour < 24) {
      todayTrend[hour].value++
    }
  })

  // Week buckets (7 days)
  const weekTrend = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getTime() - (6 - i) * 24 * 60 * 60 * 1000)
    return {
      date: `${d.getMonth() + 1}/${d.getDate()}`,
      value: 0,
      timestamp: d.setHours(0,0,0,0)
    }
  })
  weekCalls.forEach(call => {
    const ts = new Date(call.created_at).setHours(0,0,0,0)
    const bucket = weekTrend.find(b => b.timestamp === ts)
    if (bucket) bucket.value++
  })

  // Month buckets (current month days)
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const monthTrend = Array.from({ length: daysInMonth }, (_, i) => ({
    date: `${i + 1}`,
    value: 0
  }))
  monthCalls.forEach(call => {
    const date = new Date(call.created_at).getDate()
    if (date >= 1 && date <= daysInMonth) {
      monthTrend[date - 1].value++
    }
  })

  return {
    callsToday: todayCountRes.count ?? 0,
    callsWeek: weekCountRes.count ?? 0,
    callsMonth: monthCount,
    toolSuccessRate: successRate,
    recentCalls: recentCallsRes.data ?? [],
    recentFailures: recentFailuresRes.data ?? [],
    trends: {
      today: todayTrend.map(t => ({ date: t.date, value: t.value })),
      week: weekTrend.map(t => ({ date: t.date, value: t.value })),
      month: monthTrend.map(t => ({ date: t.date, value: t.value }))
    }
  }
}
