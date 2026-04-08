import Link from 'next/link'
import { notFound } from 'next/navigation'
import { format } from 'date-fns'
import { ChevronLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

type ToolConfigRow = Database['public']['Tables']['tool_configs']['Row']
type ActionLogRow = Database['public']['Tables']['action_logs']['Row']
type CallRow = Database['public']['Tables']['calls']['Row']

type ToolConfigDetail = ToolConfigRow & {
  integrations: {
    id: string
    name: string
    provider: string
  } | null
}

const ACTION_TYPE_LABELS: Record<ToolConfigRow['action_type'], string> = {
  create_contact: 'Create Contact',
  get_availability: 'Check Availability',
  create_appointment: 'Book Appointment',
  send_sms: 'Send SMS',
  knowledge_base: 'Knowledge Base',
  custom_webhook: 'Custom Webhook',
}

function formatJson(value: Database['public']['Tables']['action_logs']['Row']['request_payload']) {
  return JSON.stringify(value ?? {}, null, 2)
}

function StatusBadge({ status }: { status: ActionLogRow['status'] }) {
  const className =
    status === 'success'
      ? 'bg-emerald-500/15 text-emerald-400'
      : status === 'timeout'
      ? 'bg-yellow-500/15 text-yellow-400'
      : 'bg-red-500/15 text-red-400'

  return (
    <Badge variant="outline" className={className}>
      {status}
    </Badge>
  )
}

export default async function ToolDetailPage({
  params,
}: {
  params: Promise<{ toolConfigId: string }>
}) {
  const { toolConfigId } = await params
  const supabase = await createClient()

  const { data: toolConfig, error: toolError } = await supabase
    .from('tool_configs')
    .select('*, integrations(id, name, provider)')
    .eq('id', toolConfigId)
    .single()

  if (toolError || !toolConfig) notFound()

  const typedToolConfig = toolConfig as ToolConfigDetail

  const { data: actionLogs } = await supabase
    .from('action_logs')
    .select('*')
    .eq('tool_config_id', toolConfigId)
    .order('created_at', { ascending: false })
    .limit(20)

  const logs = (actionLogs ?? []) as ActionLogRow[]
  const callIds = Array.from(new Set(logs.map((log) => log.vapi_call_id)))

  let callsByVapiCallId = new Map<string, Pick<CallRow, 'id' | 'vapi_call_id' | 'customer_name' | 'customer_number'>>()
  if (callIds.length > 0) {
    const { data: calls } = await supabase
      .from('calls')
      .select('id, vapi_call_id, customer_name, customer_number')
      .in('vapi_call_id', callIds)

    callsByVapiCallId = new Map(
      ((calls ?? []) as Pick<CallRow, 'id' | 'vapi_call_id' | 'customer_name' | 'customer_number'>[])
        .map((call) => [call.vapi_call_id, call])
    )
  }

  const latestLog = logs[0] ?? null
  const successCount = logs.filter((log) => log.status === 'success').length
  const averageExecutionMs =
    logs.length > 0
      ? Math.round(logs.reduce((sum, log) => sum + log.execution_ms, 0) / logs.length)
      : null

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      <Link
        href="/tools"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to Tools
      </Link>

      <div className="space-y-1">
        <h1 className="text-lg font-semibold">{typedToolConfig.tool_name}</h1>
        <p className="text-sm text-muted-foreground">
          View this tool configuration and its recent execution logs.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Configuration</CardTitle>
          <CardDescription>
            This is the platform mapping used when Vapi calls this tool name.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Tool Name</dt>
              <dd className="font-mono break-all">{typedToolConfig.tool_name}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Action Type</dt>
              <dd>{ACTION_TYPE_LABELS[typedToolConfig.action_type]}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Integration</dt>
              <dd>{typedToolConfig.integrations?.name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Provider</dt>
              <dd>{typedToolConfig.integrations?.provider ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <Badge
                  variant="outline"
                  className={
                    typedToolConfig.is_active
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : 'bg-zinc-500/15 text-zinc-400'
                  }
                >
                  {typedToolConfig.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Created</dt>
              <dd>{format(new Date(typedToolConfig.created_at), 'MMM d, yyyy HH:mm')}</dd>
            </div>
          </dl>

          <div className="mt-4 border-t pt-4">
            <p className="text-xs text-muted-foreground mb-1">Fallback Message</p>
            <p className="text-sm">{typedToolConfig.fallback_message}</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Recent Runs</CardDescription>
            <CardTitle className="text-2xl">{logs.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Recent Successes</CardDescription>
            <CardTitle className="text-2xl">{successCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Average Execution</CardDescription>
            <CardTitle className="text-2xl">
              {averageExecutionMs != null ? `${averageExecutionMs}ms` : '—'}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Execution Logs</CardTitle>
          <CardDescription>
            Latest 20 runs for this tool configuration.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {latestLog && (
            <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
              <span className="text-muted-foreground">Latest run:</span>{' '}
              <StatusBadge status={latestLog.status} />{' '}
              <span className="ml-2 font-mono">{latestLog.execution_ms}ms</span>{' '}
              <span className="ml-2 text-muted-foreground">
                {format(new Date(latestLog.created_at), 'MMM d, yyyy HH:mm:ss')}
              </span>
            </div>
          )}

          {logs.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No execution logs yet for this tool.
            </div>
          ) : (
            logs.map((log) => {
              const call = callsByVapiCallId.get(log.vapi_call_id)

              return (
                <div key={log.id} className="rounded-lg border p-4 space-y-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={log.status} />
                        <span className="font-mono text-sm">{log.execution_ms}ms</span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {format(new Date(log.created_at), 'MMM d, yyyy HH:mm:ss')}
                      </div>
                      <div className="text-sm">
                        <span className="text-muted-foreground">Vapi Call ID:</span>{' '}
                        <span className="font-mono break-all">{log.vapi_call_id}</span>
                      </div>
                      {call && (
                        <div className="text-sm">
                          <Link
                            href={`/calls/${call.id}`}
                            className="underline-offset-4 hover:underline"
                          >
                            Open related call
                          </Link>
                          {(call.customer_name || call.customer_number) && (
                            <span className="text-muted-foreground">
                              {' '}· {call.customer_name ?? call.customer_number}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {log.error_detail && (
                      <div className="max-w-xl text-sm text-red-400">
                        {log.error_detail}
                      </div>
                    )}
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <details className="rounded-md border bg-muted/20 p-3">
                      <summary className="cursor-pointer text-sm font-medium">
                        Request Payload
                      </summary>
                      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
                        {formatJson(log.request_payload)}
                      </pre>
                    </details>

                    <details className="rounded-md border bg-muted/20 p-3">
                      <summary className="cursor-pointer text-sm font-medium">
                        Response Payload
                      </summary>
                      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
                        {formatJson(log.response_payload)}
                      </pre>
                    </details>
                  </div>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>
    </div>
  )
}
