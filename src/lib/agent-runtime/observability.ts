'use server'

// src/lib/agent-runtime/observability.ts
// Phase 40: Agent observability query helpers.
// OBS-04: getAgentMetrics | per-agent invocation count, p50/p95 latency, cost, tool success rate
// OBS-05: getOrgCostTicker | per-org cost totals with daily cap %
// OBS-06: getConversationDelegationTree | recursive invocation tree for a conversation
// OBS-07: getAgentInvocations + getInvocationDelegationTree | invocations list + trace tree
// All functions use the authenticated Supabase client (RLS auto-scopes to active org).

import { createClient, getUser } from '@/lib/supabase/server'
import type { AgentInvocationStatus } from '@/types/database'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

// ─── Time windows ────────────────────────────────────────────────────────────

export type ObsWindow = '24h' | '7d' | '30d'

function windowStart(w: ObsWindow): string {
  const msMap: Record<ObsWindow, number> = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  }
  return new Date(Date.now() - msMap[w]).toISOString()
}

// ─── Percentile helper ────────────────────────────────────────────────────────

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.ceil(sorted.length * p) - 1
  return sorted[Math.max(0, idx)]
}

// ─── OBS-04: Per-agent metrics ────────────────────────────────────────────────

export interface AgentMetrics {
  window: ObsWindow
  invocationCount: number
  p50LatencyMs: number
  p95LatencyMs: number
  totalCostUsd: number
  toolCallSuccessRate: number | null // null = no tool calls in window
}

export async function getAgentMetrics(
  agentId: string,
  window: ObsWindow
): Promise<AgentMetrics | null> {
  const user = await getUser()
  if (!user) return null
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('agent_invocations')
    .select('duration_ms, cost_usd, tool_calls, status')
    .eq('agent_id', agentId)
    .neq('status', 'running')
    .neq('mode', 'playground')
    .gte('created_at', windowStart(window))
    .order('created_at', { ascending: false })
    .limit(10000)

  if (error || !data) return null

  const invocationCount = data.length
  const durations = data
    .map((r) => r.duration_ms)
    .filter((v): v is number => v !== null && v >= 0)
  const p50LatencyMs = percentile(durations, 0.5)
  const p95LatencyMs = percentile(durations, 0.95)
  const totalCostUsd = data.reduce((sum, r) => sum + (Number(r.cost_usd) || 0), 0)

  // Tool call success rate from tool_calls JSONB array
  // Each entry shape: { name, args, result, denied: boolean }
  let totalToolCalls = 0
  let successfulToolCalls = 0
  for (const row of data) {
    const calls = Array.isArray(row.tool_calls) ? row.tool_calls : []
    for (const call of calls) {
      const c = call as Record<string, unknown>
      totalToolCalls++
      if (!c.denied) successfulToolCalls++
    }
  }
  const toolCallSuccessRate =
    totalToolCalls === 0 ? null : Math.round((successfulToolCalls / totalToolCalls) * 100)

  return {
    window,
    invocationCount,
    p50LatencyMs,
    p95LatencyMs,
    totalCostUsd,
    toolCallSuccessRate,
  }
}

// ─── OBS-05: Per-org cost ticker ─────────────────────────────────────────────

const DEFAULT_DAILY_CAP_USD = parseFloat(process.env.AGENT_DAILY_COST_CAP_USD ?? '50.00')

export interface OrgCostTicker {
  cost1hUsd: number
  cost24hUsd: number
  cost7dUsd: number
  dailyCapUsd: number
  pctOf24hCap: number   // 0–100+ (can exceed 100 when over cap)
  isAlertLevel: boolean // true when pctOf24hCap >= 80
}

export async function getOrgCostTicker(): Promise<OrgCostTicker | null> {
  const user = await getUser()
  if (!user) return null
  const supabase = await createClient()

  // Resolve active org id via RPC (same pattern as guardrails.ts)
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return null

  // Fetch per-org daily cap override (null → use env default)
  const { data: orgRow } = await supabase
    .from('organizations')
    .select('daily_cost_cap_usd_override')
    .eq('id', orgId as string)
    .single()

  const dailyCapUsd =
    orgRow?.daily_cost_cap_usd_override !== null &&
    orgRow?.daily_cost_cap_usd_override !== undefined
      ? Number(orgRow.daily_cost_cap_usd_override)
      : DEFAULT_DAILY_CAP_USD

  // Fetch 7d of invocations for windowed cost sums (1h / 24h / 7d)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: rows } = await supabase
    .from('agent_invocations')
    .select('cost_usd, created_at')
    .not('cost_usd', 'is', null)
    .gte('created_at', sevenDaysAgo)

  const now = Date.now()
  const oneHourAgo = now - 1 * 60 * 60 * 1000
  const oneDayAgo = now - 24 * 60 * 60 * 1000

  let cost1hUsd = 0
  let cost24hUsd = 0
  let cost7dUsd = 0

  for (const row of rows ?? []) {
    const t = new Date(row.created_at).getTime()
    const cost = Number(row.cost_usd) || 0
    cost7dUsd += cost
    if (t >= oneDayAgo) cost24hUsd += cost
    if (t >= oneHourAgo) cost1hUsd += cost
  }

  const pctOf24hCap = dailyCapUsd > 0 ? (cost24hUsd / dailyCapUsd) * 100 : 0

  return {
    cost1hUsd,
    cost24hUsd,
    cost7dUsd,
    dailyCapUsd,
    pctOf24hCap,
    isAlertLevel: pctOf24hCap >= 80,
  }
}

// ─── OBS-06: Conversation delegation tree ────────────────────────────────────

// Phase 134 Plan 03 (OBS-01): one workflow_tool_logs row (workflow_runs
// kind='tool' UNION legacy action_logs — migration 1249/1255, the Action
// Engine execution record) caused by an invocation node.
export interface WorkflowRunSummary {
  id: string
  workflowId: string | null
  toolName: string
  status: string
  executionMs: number
  createdAt: string
  source: 'run' | 'legacy'
}

export interface InvocationTreeNode {
  id: string
  agentId: string
  agentName: string
  agentSlug: string
  status: string
  costUsd: number | null
  durationMs: number | null
  depth: number
  children: InvocationTreeNode[]
  /**
   * Workflow runs / Action Engine executions this invocation caused,
   * joined via workflow_tool_logs.agent_invocation_id (migration 1292 +
   * Phase 134 Plan 03's executeWorkflowTool() wiring). Undefined until
   * attachWorkflowRuns() populates it; always an array (possibly empty)
   * once populated — never omitted, so a caller can tell "attached, none
   * found" apart from "not attached yet".
   */
  workflowRuns?: WorkflowRunSummary[]
}

type RawInvocationRow = {
  id: string
  parent_invocation_id: string | null
  agent_id: string
  status: string
  cost_usd: number | null
  duration_ms: number | null
  depth: number
  agents: { name: string; slug: string } | null
}

function buildTree(rows: RawInvocationRow[]): InvocationTreeNode[] {
  const nodeMap = new Map<string, InvocationTreeNode>()

  for (const r of rows) {
    nodeMap.set(r.id, {
      id: r.id,
      agentId: r.agent_id,
      agentName: r.agents?.name ?? 'Unknown Agent',
      agentSlug: r.agents?.slug ?? '',
      status: r.status,
      costUsd: r.cost_usd,
      durationMs: r.duration_ms,
      depth: r.depth,
      children: [],
    })
  }

  const roots: InvocationTreeNode[] = []
  for (const r of rows) {
    const node = nodeMap.get(r.id)!
    if (r.parent_invocation_id && nodeMap.has(r.parent_invocation_id)) {
      nodeMap.get(r.parent_invocation_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

// Depth-first flatten of a tree already built by buildTree() — used to
// collect every node's id for a single follow-up workflow_tool_logs query
// (attachWorkflowRuns), rather than one query per node.
function flattenNodes(nodes: InvocationTreeNode[]): InvocationTreeNode[] {
  const out: InvocationTreeNode[] = []
  const walk = (list: InvocationTreeNode[]) => {
    for (const n of list) {
      out.push(n)
      if (n.children.length > 0) walk(n.children)
    }
  }
  walk(nodes)
  return out
}

// Phase 134 Plan 03 (OBS-01): completes the join this module exists to
// serve — channel ingress -> entry agent -> nested specialists
// (agent_invocations, already the tree above) -> workflow run -> Action
// Engine execution (workflow_tool_logs, one row per kind='tool' run or
// legacy action_log). ONE extra query for the whole tree (`.in(...)` over
// every node id), not one per node. Mutates each node's `workflowRuns` in
// place so callers keep using the same InvocationTreeNode[] shape.
async function attachWorkflowRuns(
  nodes: InvocationTreeNode[],
  supabase: SupabaseServerClient,
): Promise<void> {
  if (nodes.length === 0) return
  const ids = nodes.map((n) => n.id)

  const { data, error } = await supabase
    .from('workflow_tool_logs')
    .select('id, workflow_id, tool_name, status, execution_ms, created_at, source, agent_invocation_id')
    .in('agent_invocation_id', ids)

  if (error || !data) {
    for (const n of nodes) n.workflowRuns = []
    return
  }

  const byInvocation = new Map<string, WorkflowRunSummary[]>()
  for (const row of data) {
    if (!row.agent_invocation_id) continue
    const summary: WorkflowRunSummary = {
      id: row.id,
      workflowId: row.workflow_id,
      toolName: row.tool_name,
      status: row.status,
      executionMs: row.execution_ms,
      createdAt: row.created_at,
      source: row.source,
    }
    const list = byInvocation.get(row.agent_invocation_id) ?? []
    list.push(summary)
    byInvocation.set(row.agent_invocation_id, list)
  }

  for (const n of nodes) {
    n.workflowRuns = byInvocation.get(n.id) ?? []
  }
}

export async function getConversationDelegationTree(
  conversationId: string
): Promise<InvocationTreeNode[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('agent_invocations')
    .select(
      `id, parent_invocation_id, agent_id, status, cost_usd, duration_ms, depth,
       agents!agent_invocations_agent_id_fkey (name, slug)`
    )
    .eq('conversation_id', conversationId)
    .order('depth', { ascending: true })
    .order('created_at', { ascending: true })

  if (error || !data) return []
  const roots = buildTree(data as unknown as RawInvocationRow[])
  await attachWorkflowRuns(flattenNodes(roots), supabase)
  return roots
}

// ─── OBS-07: Agent invocations list ──────────────────────────────────────────

import { INVOCATIONS_PAGE_SIZE } from './constants'

export interface InvocationListItem {
  id: string
  agentId: string
  status: string
  costUsd: number | null
  durationMs: number | null
  errorDetail: string | null
  conversationId: string | null
  traceId: string
  depth: number
  createdAt: string
}

export async function getAgentInvocations(params: {
  agentId: string
  page?: number
  status?: string
  minCostUsd?: number
  errorSearch?: string
}): Promise<{ rows: InvocationListItem[]; total: number }> {
  const user = await getUser()
  if (!user) return { rows: [], total: 0 }
  const supabase = await createClient()

  const { agentId, page = 1, status, minCostUsd, errorSearch } = params

  let query = supabase
    .from('agent_invocations')
    .select(
      'id, agent_id, status, cost_usd, duration_ms, error_detail, conversation_id, trace_id, depth, created_at',
      { count: 'exact' }
    )
    .eq('agent_id', agentId)
    .neq('status', 'running')
    .neq('mode', 'playground')
    .order('created_at', { ascending: false })
    .range((page - 1) * INVOCATIONS_PAGE_SIZE, page * INVOCATIONS_PAGE_SIZE - 1)

  if (status) query = query.eq('status', status as AgentInvocationStatus)
  if (minCostUsd !== undefined) query = query.gte('cost_usd', minCostUsd)
  if (errorSearch) query = query.ilike('error_detail', `%${errorSearch}%`)

  const { data, count, error } = await query
  if (error) return { rows: [], total: 0 }

  const rows: InvocationListItem[] = (data ?? []).map((r) => ({
    id: r.id,
    agentId: r.agent_id,
    status: r.status,
    costUsd: r.cost_usd,
    durationMs: r.duration_ms,
    errorDetail: r.error_detail,
    conversationId: r.conversation_id,
    traceId: r.trace_id,
    depth: r.depth,
    createdAt: r.created_at,
  }))

  return { rows, total: count ?? 0 }
}

// ─── OBS-07: Single invocation | delegation tree from trace ──────────────────

export async function getInvocationDelegationTree(
  invocationId: string
): Promise<InvocationTreeNode[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()

  // Resolve the trace_id for this invocation
  const { data: inv } = await supabase
    .from('agent_invocations')
    .select('trace_id')
    .eq('id', invocationId)
    .single()

  if (!inv) return []

  // Fetch all invocations in this trace
  const { data, error } = await supabase
    .from('agent_invocations')
    .select(
      `id, parent_invocation_id, agent_id, status, cost_usd, duration_ms, depth,
       agents!agent_invocations_agent_id_fkey (name, slug)`
    )
    .eq('trace_id', inv.trace_id)
    .order('depth', { ascending: true })
    .order('created_at', { ascending: true })

  if (error || !data) return []
  const roots = buildTree(data as unknown as RawInvocationRow[])
  await attachWorkflowRuns(flattenNodes(roots), supabase)
  return roots
}
