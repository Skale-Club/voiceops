import Link from 'next/link'
import { format, formatDistanceToNow } from 'date-fns'
import type { Database } from '@/types/database'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

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
    className = 'bg-emerald-500/15 text-emerald-400'
  } else if (reason.includes('error') || reason === 'pipeline-error') {
    className = 'bg-red-500/15 text-red-400'
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
  if (rate < 60) colorClass = 'text-red-500'
  else if (rate < 80) colorClass = 'text-yellow-500'

  return <span className={`text-2xl font-bold ${colorClass}`}>{rate}%</span>
}

export function DashboardMetrics({ metrics }: DashboardMetricsProps) {
  const { callsToday, callsWeek, callsMonth, toolSuccessRate, recentCalls, recentFailures } =
    metrics

  return (
    <div className="space-y-8">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Calls Today</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-bold">{callsToday}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Calls This Week
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-bold">{callsWeek}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Calls This Month
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-bold">{callsMonth}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Tool Success Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SuccessRateValue rate={toolSuccessRate} />
          </CardContent>
        </Card>
      </div>

      {/* Recent calls */}
      <div>
        <h2 className="text-sm font-semibold mb-3">Recent Calls</h2>
        {recentCalls.length === 0 ? (
          <p className="text-sm text-muted-foreground">No calls yet.</p>
        ) : (
          <div className="rounded-md border divide-y">
            {recentCalls.map((call) => (
              <div
                key={call.id}
                className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-muted/40 transition-colors"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <span className="text-muted-foreground whitespace-nowrap">
                    {call.started_at
                      ? format(new Date(call.started_at), 'MMM d HH:mm')
                      : '—'}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatDuration(call.duration_seconds)}
                  </span>
                  <span className="truncate">
                    {call.customer_name ?? call.customer_number ?? 'Unknown'}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <EndedReasonBadge reason={call.ended_reason} />
                  <Link
                    href={`/dashboard/calls/${call.id}`}
                    className="text-xs text-primary hover:underline"
                  >
                    View
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Failure alerts */}
      {recentFailures.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-3">Recent Failures (last 24h)</h2>
          <div className="rounded-md border divide-y">
            {recentFailures.map((log) => (
              <div key={log.id} className="flex items-start justify-between px-4 py-2.5 gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{log.tool_name}</span>
                    <Badge
                      variant="outline"
                      className={
                        log.status === 'timeout'
                          ? 'bg-yellow-500/15 text-yellow-600 text-[10px]'
                          : 'bg-red-500/15 text-red-600 text-[10px]'
                      }
                    >
                      {log.status}
                    </Badge>
                  </div>
                  {log.error_detail && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {log.error_detail.length > 80
                        ? log.error_detail.slice(0, 80) + '…'
                        : log.error_detail}
                    </p>
                  )}
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                  {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
