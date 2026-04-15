'use server'

import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

export type ActionLogRow = Database['public']['Tables']['action_logs']['Row']
export type LogStatus = ActionLogRow['status']

export type LogWithCall = ActionLogRow & {
  call: {
    id: string
    customer_name: string | null
    customer_number: string | null
  } | null
}

export type GetLogsParams = {
  toolConfigId?: string
  status?: LogStatus | 'all'
  from?: string
  to?: string
  q?: string
  page?: number
  pageSize?: number
}

export type GetLogsResult = {
  logs: LogWithCall[]
  total: number
  pageCount: number
}

export async function getLogs({
  toolConfigId,
  status,
  from,
  to,
  q,
  page = 1,
  pageSize = 50,
}: GetLogsParams): Promise<GetLogsResult> {
  const supabase = await createClient()
  const offset = (page - 1) * pageSize

  let query = supabase
    .from('action_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1)

  if (toolConfigId) query = query.eq('tool_config_id', toolConfigId)
  if (status && status !== 'all') query = query.eq('status', status)
  if (from) query = query.gte('created_at', from)
  if (to) {
    const toEnd = new Date(to)
    if (!isNaN(toEnd.getTime())) {
      toEnd.setDate(toEnd.getDate() + 1)
      query = query.lt('created_at', toEnd.toISOString())
    }
  }
  if (q) query = query.ilike('vapi_call_id', `${q}%`)

  const { data, count, error } = await query
  if (error) return { logs: [], total: 0, pageCount: 0 }

  const logs = (data ?? []) as ActionLogRow[]
  const callIds = [...new Set(logs.map((l) => l.vapi_call_id))]

  let callMap = new Map<string, { id: string; customer_name: string | null; customer_number: string | null }>()
  if (callIds.length > 0) {
    const { data: calls } = await supabase
      .from('calls')
      .select('id, vapi_call_id, customer_name, customer_number')
      .in('vapi_call_id', callIds)
    callMap = new Map(
      (calls ?? []).map((c) => [
        c.vapi_call_id,
        { id: c.id, customer_name: c.customer_name, customer_number: c.customer_number },
      ])
    )
  }

  const total = count ?? 0
  return {
    logs: logs.map((log) => ({
      ...log,
      call: callMap.get(log.vapi_call_id) ?? null,
    })),
    total,
    pageCount: Math.ceil(total / pageSize),
  }
}

export async function getToolOptions(): Promise<Array<{ id: string; tool_name: string }>> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('tool_configs')
    .select('id, tool_name')
    .order('tool_name', { ascending: true })
  return (data ?? []) as Array<{ id: string; tool_name: string }>
}

// Average is computed over the most recent AVG_SAMPLE_SIZE executions so the
// query is bounded as the log table grows; counts stay exact via head:true.
const AVG_SAMPLE_SIZE = 500

export async function getLogStats(toolConfigId: string): Promise<{
  total: number
  successCount: number
  averageMs: number | null
}> {
  const supabase = await createClient()

  const [totalRes, successRes, recentRes] = await Promise.all([
    supabase
      .from('action_logs')
      .select('*', { count: 'exact', head: true })
      .eq('tool_config_id', toolConfigId),
    supabase
      .from('action_logs')
      .select('*', { count: 'exact', head: true })
      .eq('tool_config_id', toolConfigId)
      .eq('status', 'success'),
    supabase
      .from('action_logs')
      .select('execution_ms')
      .eq('tool_config_id', toolConfigId)
      .order('created_at', { ascending: false })
      .limit(AVG_SAMPLE_SIZE),
  ])

  const recent = recentRes.data ?? []
  const averageMs =
    recent.length > 0
      ? Math.round(recent.reduce((s, l) => s + l.execution_ms, 0) / recent.length)
      : null

  return {
    total: totalRes.count ?? 0,
    successCount: successRes.count ?? 0,
    averageMs,
  }
}
