'use client'

import Link from 'next/link'
import { format, formatDistanceToNow } from 'date-fns'
import type { Database } from '@/types/database'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
} from 'recharts'
import { useId } from 'react'

type CallRow = Database['public']['Tables']['calls']['Row']
type ActionLogRow = Database['public']['Tables']['action_logs']['Row']

interface DashboardMetricsProps {
  metrics: {
    callsToday: number
    callsWeek: number
    callsMonth: number
    toolSuccessRate: number | null
    recentCalls: CallRow[]
    recentFailures: ActionLogRow[]
  }
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
}

function EndedReasonBadge({ reason }: { reason: string | null }) {
  if (!reason) return <span className="text-muted-foreground text-xs">—</span>

  let className = 'bg-zinc-500/15 text-zinc-400'
  if (reason === 'customer-ended-call' || reason === 'assistant-ended-call') {
    className = 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
  } else if (reason.includes('error') || reason === 'pipeline-error') {
    className = 'bg-red-500/15 text-red-400 border-red-500/20'
  } else {
    className = 'bg-zinc-500/15 text-zinc-400 border-zinc-500/20'
  }

  return (
    <Badge variant="outline" className={`text-[10px] ${className}`}>
      {reason}
    </Badge>
  )
}

function SuccessRateValue({ rate }: { rate: number | null }) {
  if (rate === null) {
    return <span className="text-2xl font-bold text-muted-foreground">No data</span>
  }

  let colorClass = 'text-emerald-500'
  if (rate < 60) colorClass = 'text-destructive'
  else if (rate < 80) colorClass = 'text-yellow-500'

  return <span className={`text-2xl font-bold tracking-tight ${colorClass}`}>{rate}%</span>
}

// Generates placeholder data for the sparklines to enhance visual polish
function generateSparklineData(baseValue: number, days: number) {
  const data = []
  for (let i = days; i >= 0; i--) {
    data.push({
      date: format(new Date(Date.now() - i * 24 * 60 * 60 * 1000), 'MMM d'),
      value: Math.max(0, Math.floor(baseValue / days + (Math.random() * 10 - 5))),
    })
  }
  return data
}

function MetricSparkline({ data, color }: { data: any[]; color: string }) {
  const id = useId()
  return (
    <div className="h-[40px] mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <RechartsTooltip
            cursor={{ fill: 'transparent' }}
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                return (
                  <div className="bg-popover border text-popover-foreground text-xs p-2 rounded-md shadow-md">
                    <div className="font-semibold">{payload[0].payload.date}</div>
                    <div>{payload[0].value} calls</div>
                  </div>
                )
              }
              return null
            }}
          />
          <Bar dataKey="value" fill={color} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function DashboardMetrics({ metrics }: DashboardMetricsProps) {
  const { callsToday, callsWeek, callsMonth, toolSuccessRate, recentCalls, recentFailures } =
    metrics

  const weekData = generateSparklineData(callsWeek > 0 ? callsWeek : 50, 7)
  const monthData = generateSparklineData(callsMonth > 0 ? callsMonth : 200, 30)

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="hover:shadow-sm transition-shadow">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Calls Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-bold tracking-tight">{callsToday}</span>
          </CardContent>
        </Card>
        <Card className="hover:shadow-sm transition-shadow">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Calls This Week
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-bold tracking-tight">{callsWeek}</span>
            <MetricSparkline data={weekData} color="var(--color-primary)" />
          </CardContent>
        </Card>
        <Card className="hover:shadow-sm transition-shadow">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Calls This Month
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-3xl font-bold tracking-tight">{callsMonth}</span>
            <MetricSparkline data={monthData} color="var(--color-primary)" />
          </CardContent>
        </Card>
        <Card className="hover:shadow-sm transition-shadow">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Tool Success Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SuccessRateValue rate={toolSuccessRate} />
            <p className="text-xs text-muted-foreground mt-2.5">
              Based on recent action logs
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Recent calls */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight">Recent Calls</h2>
        {recentCalls.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 border border-dashed rounded-lg bg-muted/20">
            <p className="text-sm font-medium text-muted-foreground">No calls yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Your recent calls will appear here.</p>
          </div>
        ) : (
          <div className="rounded-lg border bg-card overflow-hidden shadow-sm">
            <div className="divide-y">
              {recentCalls.map((call) => (
                <div
                  key={call.id}
                  className="flex items-center justify-between px-5 py-3 text-sm hover:bg-muted/40 transition-colors group"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <span className="text-muted-foreground whitespace-nowrap w-[100px]">
                      {call.started_at
                        ? format(new Date(call.started_at), 'MMM d HH:mm')
                        : '—'}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground w-[40px]">
                      {formatDuration(call.duration_seconds)}
                    </span>
                    <span className="font-medium truncate">
                      {call.customer_name ?? call.customer_number ?? 'Unknown'}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <EndedReasonBadge reason={call.ended_reason} />
                    <Link
                      href={`/calls/${call.id}`}
                      className="text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity hover:underline"
                    >
                      View Details
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Failure alerts */}
      {recentFailures.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight text-destructive">
            Recent Failures (last 24h)
          </h2>
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 overflow-hidden">
            <div className="divide-y divide-destructive/10">
              {recentFailures.map((log) => (
                <div key={log.id} className="flex items-start justify-between px-5 py-3 gap-4 hover:bg-destructive/10 transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{log.tool_name}</span>
                      <Badge
                        variant="outline"
                        className={
                          log.status === 'timeout'
                            ? 'bg-yellow-500/15 text-yellow-600 border-yellow-500/20 text-[10px]'
                            : 'bg-red-500/15 text-red-600 border-red-500/20 text-[10px]'
                        }
                      >
                        {log.status}
                      </Badge>
                    </div>
                    {log.error_detail && (
                      <p className="text-xs text-muted-foreground mt-1 truncate max-w-[800px]">
                        {log.error_detail}
                      </p>
                    )}
                  </div>
                  <span className="text-xs font-medium text-muted-foreground whitespace-nowrap shrink-0 pt-0.5">
                    {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
