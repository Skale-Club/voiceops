import { notFound, redirect } from 'next/navigation'
import { format } from 'date-fns'
import { Wrench } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { getLogs, getLogStats } from '@/app/(dashboard)/workflows/logs/actions'
import type { Database } from '@/types/database'
import { StatusPill } from '@/components/design-system/status-pill'
import { MetricCard } from '@/components/design-system/metric-card'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { LogsTable } from '@/components/tools/logs-table'
import { LogsFilters } from '@/components/tools/logs-filters'
import { InlineToolName } from '@/components/tools/inline-tool-name'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import type { LogStatus } from '@/app/(dashboard)/workflows/logs/actions'

type ToolConfigRow = Database['public']['Tables']['_legacy_tool_configs']['Row']

type ToolConfigDetail = ToolConfigRow & {
  integrations: {
    id: string
    name: string
    provider: string
  } | null
}

const ACTION_TYPE_LABELS: Record<ToolConfigRow['action_type'], string> = {
  send_email: 'Send Email',
  create_contact: 'Create Contact',
  get_availability: 'Check Availability',
  create_appointment: 'Book Appointment',
  send_sms: 'Send SMS',
  knowledge_base: 'Knowledge Base',
  custom_webhook: 'Custom Webhook',
  manychat_set_field: 'ManyChat: Set Field',
  manychat_add_tag: 'ManyChat: Add Tag',
  manychat_trigger_flow: 'ManyChat: Trigger Flow',
  manychat_send_message: 'ManyChat: Send Message',
  google_contacts_create: 'Google Contacts: Create',
  google_contacts_update: 'Google Contacts: Update',
  google_contacts_find: 'Google Contacts: Find',
  google_contacts_delete: 'Google Contacts: Delete',
  send_whatsapp_message: 'WhatsApp: Send Message',
  send_whatsapp_mention_all: 'WhatsApp: Group Mention-All',
  send_whatsapp_template: 'WhatsApp: Send Template (Official)',
  send_telegram_notification: 'Telegram: Notification',
  pipeline_move_opportunity: 'Pipeline: Move Opportunity',
  pipeline_update_opportunity: 'Pipeline: Update Opportunity',
  pipeline_mark_won: 'Pipeline: Mark Won',
  pipeline_mark_lost: 'Pipeline: Mark Lost',
  pipeline_add_note: 'Pipeline: Add Note',
  pipeline_assign_user: 'Pipeline: Assign User',
  pipeline_create_opportunity: 'Pipeline: Create Opportunity',
  create_task: 'Create Task',
  create_note: 'Create Note',
  send_tenant_email: 'Email: Send (Tenant)',
  send_platform_email: 'Email: Send (Platform)',
  xkedule_get_services: 'Xkedule: Get Services',
  xkedule_check_availability: 'Xkedule: Check Availability',
  xkedule_create_booking: 'Xkedule: Create Booking',
  xkedule_cancel_booking: 'Xkedule: Cancel Booking',
  xkedule_reschedule_booking: 'Xkedule: Reschedule Booking',
  xkedule_quote: 'Xkedule: Get Quote',
  xkedule_lookup_customer: 'Xkedule: Look Up Customer',
  xkedule_business_info: 'Xkedule: Business Info & Policies',
  send_zernio_dm: 'Instagram/Facebook: Send DM',
  medusa_search_products: 'Medusa: Search Products',
  medusa_get_product: 'Medusa: Get Product',
  medusa_get_cart: 'Medusa: Get Cart',
  medusa_add_to_cart: 'Medusa: Add to Cart',
  medusa_update_cart_item: 'Medusa: Update Cart Item',
  medusa_wishlist_add: 'Medusa: Wishlist Add',
  medusa_wishlist_remove: 'Medusa: Wishlist Remove',
  medusa_wishlist_list: 'Medusa: Wishlist List',
  medusa_get_order_status: 'Medusa: Get Order Status',
}

function buildPageUrl(
  toolConfigId: string,
  page: number,
  params: { status?: string; from?: string; to?: string; q?: string }
): string {
  const p = new URLSearchParams()
  if (params.status && params.status !== 'all') p.set('status', params.status)
  if (params.from) p.set('from', params.from)
  if (params.to) p.set('to', params.to)
  if (params.q) p.set('q', params.q)
  p.set('page', String(page))
  return `/workflows/${toolConfigId}?${p.toString()}`
}

export default async function ToolDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ toolConfigId: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { toolConfigId } = await params
  const sp = await searchParams

  const page = Math.max(1, Number(sp.page ?? '1') || 1)
  const status = sp.status as string | undefined
  const from = sp.from as string | undefined
  const to = sp.to as string | undefined
  const q = sp.q as string | undefined

  const supabase = await createClient()

  const { data: toolConfig, error: toolError } = await supabase
    .from('_legacy_tool_configs')
    .select('*, integrations(id, name, provider)')
    .eq('id', toolConfigId)
    .single()

  if (toolError || !toolConfig) {
    // SEED-037: if the id belongs to a unified workflow with kind='flow',
    // redirect to the flow editor instead of returning 404.
    const { data: flow } = await supabase
      .from('workflows')
      .select('id, kind')
      .eq('id', toolConfigId)
      .maybeSingle()
    if (flow?.kind === 'flow') {
      redirect(`/workflows/flows/${flow.id}`)
    }
    notFound()
  }

  const typedToolConfig = toolConfig as ToolConfigDetail
  const basePath = `/workflows/${toolConfigId}`

  const [{ logs, total, pageCount }, stats] = await Promise.all([
    getLogs({
      toolConfigId,
      status: status as LogStatus | 'all' | undefined,
      from,
      to,
      q,
      page,
    }),
    getLogStats(toolConfigId),
  ])

  const filterParams = { status, from, to, q }
  const prevHref = page > 1 ? buildPageUrl(toolConfigId, page - 1, filterParams) : null
  const nextHref = page < pageCount ? buildPageUrl(toolConfigId, page + 1, filterParams) : null

  const successRate = stats.total > 0 ? Math.round((stats.successCount / stats.total) * 100) : null

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Automation"
        eyebrowIcon={Wrench}
        back={{ href: '/workflows', label: 'Back to workflows' }}
        title={
          <InlineToolName toolConfigId={toolConfigId} initialName={typedToolConfig.tool_name} />
        }
        description={
          <span className="inline-flex items-center gap-2">
            {ACTION_TYPE_LABELS[typedToolConfig.action_type]}
            <span className="text-text-tertiary">·</span>
            <StatusPill tone={typedToolConfig.is_active ? 'success' : 'idle'}>
              {typedToolConfig.is_active ? 'Active' : 'Inactive'}
            </StatusPill>
          </span>
        }
      />

      {/* Metrics row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard
          index={0}
          label="Total runs"
          value={stats.total.toLocaleString()}
          tone="default"
        />
        <MetricCard
          index={1}
          label="Success rate"
          value={successRate !== null ? `${successRate}%` : '-'}
          tone={successRate !== null && successRate >= 90 ? 'success' : successRate !== null && successRate < 75 ? 'warning' : 'default'}
          hint={`${stats.successCount} successes`}
        />
        <MetricCard
          index={2}
          label="Avg execution"
          value={stats.averageMs != null ? `${stats.averageMs}` : '-'}
          unit={stats.averageMs != null ? 'ms' : undefined}
          tone="info"
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-[15px]">Configuration</CardTitle>
          <CardDescription>
            This is the platform mapping used when Vapi calls this tool name.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-4 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-[11.5px] uppercase tracking-[0.06em] text-text-tertiary">Tool name</dt>
              <dd className="mt-1 break-all font-mono text-text-primary">{typedToolConfig.tool_name}</dd>
            </div>
            <div>
              <dt className="text-[11.5px] uppercase tracking-[0.06em] text-text-tertiary">Action type</dt>
              <dd className="mt-1 text-text-primary">{ACTION_TYPE_LABELS[typedToolConfig.action_type]}</dd>
            </div>
            <div>
              <dt className="text-[11.5px] uppercase tracking-[0.06em] text-text-tertiary">Integration</dt>
              <dd className="mt-1 text-text-primary">{typedToolConfig.integrations?.name ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-[11.5px] uppercase tracking-[0.06em] text-text-tertiary">Provider</dt>
              <dd className="mt-1 text-text-primary">{typedToolConfig.integrations?.provider ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-[11.5px] uppercase tracking-[0.06em] text-text-tertiary">Created</dt>
              <dd className="mt-1 text-text-primary tabular">{format(new Date(typedToolConfig.created_at), 'MMM d, yyyy HH:mm')}</dd>
            </div>
          </dl>

          <div className="mt-5 border-t border-border pt-4">
            <p className="text-[11.5px] uppercase tracking-[0.06em] text-text-tertiary">Fallback message</p>
            <p className="mt-1 text-[13px] text-text-primary">{typedToolConfig.fallback_message}</p>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="text-[12px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
          Execution logs
        </h2>
        <LogsFilters
          workflowOptions={[]}
          showWorkflowFilter={false}
          basePath={basePath}
          status={status}
          from={from}
          to={to}
          q={q}
        />
        <LogsTable
          logs={logs}
          total={total}
          page={page}
          pageCount={pageCount}
          showWorkflowColumn={false}
          prevHref={prevHref}
          nextHref={nextHref}
        />
      </div>
    </PageContainer>
  )
}
