import { Suspense } from 'react'
import Link from 'next/link'
import { KeyRound, Megaphone, Mic, PhoneIncoming, PhoneOutgoing, Plug, Sparkles } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { can } from '@/lib/rbac/server'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { getUnifiedCall, getUnifiedCalls, type UnifiedCallWithContact } from '../actions'
import { getRoutingChain } from '../routing-actions'
import { listCallDestinations } from '../destination-actions'
import { getCurrentCallSettings, getSipDomain } from '../settings-actions'
import {
  listTwilioNumbers,
  listOrgMembersForSelect,
  type TwilioPhoneNumberRow,
} from '@/app/(dashboard)/integrations/twilio/numbers-actions'
import { getTwilioIntegration } from '@/app/(dashboard)/integrations/twilio/actions'
import { UnifiedCallTimeline } from '@/components/calls/unified-call-timeline'
import { CallsOnboardingGate } from '@/components/calls/calls-onboarding-gate'
import { CallsHeaderActions } from '@/components/calls/calls-header-actions'
import { CallDetailDialogLazy } from '@/components/calls/call-detail-dialog-lazy'
import { AnswerCallHandler } from '@/components/calls/answer-call-handler'
import { PushDeviceSection } from '@/components/calls/push-device-section'
import { CallDetailAi } from '@/components/calls/call-detail-ai'
import { CallDetailHuman } from '@/components/calls/call-detail-human'
import { MyPhoneDialog } from '@/components/calls/my-phone-dialog'
import { CallSettingsForm } from '@/components/calls/call-settings-form'
import { VoiceSettingsDialogLazy } from '@/components/calls/voice-settings-dialog-lazy'
import { isVoiceSettingsTab, type VoiceSettingsTab } from '@/components/calls/voice-settings-tabs'
import { PhoneNumbersList } from '@/components/phone-numbers/phone-numbers-list'
import { VapiNumbersSection } from '@/components/phone-numbers/vapi-numbers-section'
import { RoutingChainEditorLazy } from '@/components/calls/routing-chain-editor-lazy'
import { AssistantMappingsTable } from '@/components/assistants/assistant-mappings-table'
import type { Database } from '@/types/database'

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

type TypeFilter = 'all' | 'ai' | 'human'
type DirFilter = 'all' | 'inbound' | 'outbound' | 'missed'

const TYPES: TypeFilter[] = ['all', 'ai', 'human']
const DIRS: DirFilter[] = ['all', 'inbound', 'outbound', 'missed']

function parseType(v: string | undefined): TypeFilter {
  return (v && (TYPES as string[]).includes(v) ? v : 'all') as TypeFilter
}

function parseDir(v: string | undefined): DirFilter {
  return (v && (DIRS as string[]).includes(v) ? v : 'all') as DirFilter
}

export default async function CallsPage({ searchParams }: PageProps) {
  const sp = await searchParams
  const type = parseType(sp.type as string | undefined)
  const direction = parseDir(sp.direction as string | undefined)
  const q = typeof sp.q === 'string' ? sp.q : undefined
  const pageNum = Math.max(1, Number(sp.page ?? '1') || 1)

  const callId = typeof sp.call === 'string' ? sp.call : undefined
  const answerSid = typeof sp.answer === 'string' ? sp.answer : undefined
  const settingsTab = typeof sp.settings === 'string' && isVoiceSettingsTab(sp.settings)
    ? sp.settings
    : undefined
  const myPhoneOpen = sp.myphone === '1'

  const [result, numbers, canManage] = await Promise.all([
    getUnifiedCalls({
      page: pageNum,
      type: type === 'all' ? undefined : type,
      direction: direction === 'missed' ? undefined : direction === 'all' ? undefined : direction,
      missed: direction === 'missed',
      q,
    }),
    listTwilioNumbers(),
    can('calls.manage'),
  ])

  // An org can be Vapi-only (AI calls, zero Twilio numbers) and still have a
  // call history — gate on either signal, not just the Twilio number count,
  // or a Vapi-only org never sees its own timeline. result.total is the
  // FILTERED count, so when there are no Twilio numbers and the current
  // filters match nothing, check unfiltered existence before gating —
  // otherwise a Vapi-only org loses the filter bar the moment a filter
  // returns zero rows.
  let hasAnyCallHistory = result.total > 0
  if (numbers.length === 0 && !hasAnyCallHistory) {
    const unfiltered = await getUnifiedCalls({ page: 1, pageSize: 1 })
    hasAnyCallHistory = unfiltered.total > 0
  }
  const hasAnyNumber = numbers.length > 0 || hasAnyCallHistory

  // Only decrypt the Twilio credential blob when something actually needs it:
  // the onboarding gate or the Numbers settings tab.
  let twilioConnected = false
  if (!hasAnyNumber || settingsTab === 'numbers') {
    const twilio = await getTwilioIntegration()
    twilioConnected = twilio.hasAccountSid && twilio.hasAuthToken
  }

  return (
    <div className="space-y-4">
      {hasAnyNumber ? (
        <UnifiedCallTimeline
          rows={result.rows}
          total={result.total}
          page={result.page}
          pageSize={result.pageSize}
          currentType={type}
          currentDirection={direction}
          currentQuery={q}
          headerActions={<CallsHeaderActions canManage={canManage} />}
        />
      ) : (
        <>
          <CallsHeaderActions canManage={canManage} />
          <div className="pt-4">
            <CallsOnboardingGate twilioConnected={twilioConnected} />
          </div>
        </>
      )}

      {answerSid && <AnswerCallHandler callSid={answerSid} />}

      {callId && <CallDetail id={callId} rows={result.rows} />}

      {settingsTab && canManage && (
        <VoiceSettings tab={settingsTab} twilioConnected={twilioConnected} numbers={numbers} />
      )}

      {myPhoneOpen && <MyPhone />}
    </div>
  )
}

/* ── Detail sheet (?call=) ─────────────────────────────────────────── */

async function CallDetail({ id, rows }: { id: string; rows: UnifiedCallWithContact[] }) {
  const call = rows.find((r) => r.id === id) ?? (await getUnifiedCall(id))
  if (!call) return null

  const displayName =
    call.contact?.name ?? call.counterpart_name ?? call.counterpart_number ?? 'Unknown'

  return (
    <CallDetailDialogLazy>
      <div className="mb-5 flex items-center gap-3 pr-8">
        <Avatar className="h-10 w-10">
          <AvatarFallback className="bg-bg-tertiary text-[13px] font-medium text-text-secondary">
            {initialsOf(displayName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-text-primary">{displayName}</div>
          <div className="mt-0.5 flex items-center gap-2 text-[12px] text-text-secondary">
            {call.direction === 'inbound'
              ? <PhoneIncoming className="h-3.5 w-3.5 text-emerald-400" />
              : <PhoneOutgoing className="h-3.5 w-3.5 text-accent" />}
            <span className="capitalize">{call.direction}</span>
            <span className="text-text-tertiary">·</span>
            <span>{call.counterpart_number ?? '-'}</span>
            <span className="text-text-tertiary">·</span>
            <span>{call.call_type === 'ai' ? 'AI call' : 'Human call'}</span>
          </div>
        </div>
      </div>

      <Suspense fallback={<CallDetailSkeleton />}>
        {call.call_type === 'ai'
          ? <CallDetailAi call={call} />
          : <CallDetailHuman call={call} />}
      </Suspense>
    </CallDetailDialogLazy>
  )
}

function CallDetailSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-6">
        <Skeleton className="h-24 w-full" rounded="lg" />
        <Skeleton className="h-40 w-full" rounded="lg" />
      </div>
      <aside className="space-y-4">
        <div className="space-y-3 rounded-[14px] border border-border bg-bg-secondary p-5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </aside>
    </div>
  )
}

function initialsOf(name: string | null | undefined): string {
  const base = (name ?? '?').replace(/[^a-zA-Z0-9 ]/g, ' ').trim()
  const parts = base.split(/\s+/)
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return base.slice(0, 2).toUpperCase()
}

/* ── Voice Settings modal (?settings=) ─────────────────────────────── */

async function VoiceSettings({
  tab,
  twilioConnected,
  numbers,
}: {
  tab: VoiceSettingsTab
  twilioConnected: boolean
  numbers: TwilioPhoneNumberRow[]
}) {
  return (
    <VoiceSettingsDialogLazy tab={tab}>
      {tab === 'numbers' && <NumbersTab twilioConnected={twilioConnected} numbers={numbers} />}
      {tab === 'routing' && <RoutingTab />}
      {tab === 'assistants' && <AssistantsTab />}
      {tab === 'general' && <GeneralTab />}
    </VoiceSettingsDialogLazy>
  )
}

function NumbersTab({
  twilioConnected,
  numbers,
}: {
  twilioConnected: boolean
  numbers: TwilioPhoneNumberRow[]
}) {
  // The two providers get their own section: the Twilio list carries webhook
  // sync, capabilities and routing modes, none of which apply to a Vapi-native
  // number where Vapi itself owns the call leg.
  const twilioNumbers = numbers.filter((n) => n.provider !== 'vapi')
  const vapiNumbers = numbers.filter((n) => n.provider === 'vapi')

  return (
    <>
      <PhoneNumbersList initial={twilioNumbers} twilioConnected={twilioConnected} embedded />
      <VapiNumbersSection numbers={vapiNumbers} twilioNumbers={twilioNumbers} />
    </>
  )
}

async function RoutingTab() {
  const [chain, members, destinations] = await Promise.all([
    getRoutingChain(),
    listOrgMembersForSelect(),
    listCallDestinations(),
  ])

  // Chains that ring browsers/PWAs silently do nothing when no org member has a
  // push-registered device AND nobody keeps the app open. Surface that here.
  let noDeviceWarning = false
  const ringsSoftware = chain.stages.some(
    (s) => s.enabled && s.targets.some((t) => t.type === 'team' || t.type === 'browser' || t.type === 'pwa'),
  )
  if (chain.is_active && ringsSoftware && members.length > 0) {
    const admin = createServiceRoleClient()
    const { count } = await admin
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
      .in('user_id', members.map((m) => m.user_id))
    noDeviceWarning = (count ?? 0) === 0
  }

  return (
    <div className="space-y-4">
      {noDeviceWarning && (
        <div className="rounded-[12px] border border-rose-500/30 bg-rose-500/[0.07] px-4 py-3 text-[12.5px] leading-relaxed text-text-secondary">
          <span className="font-medium text-rose-300">No device is registered to ring.</span>{' '}
          This routing rings browsers/PWAs, but no one in the organization has enabled
          call notifications on any device — calls will ring only in open browser tabs.
          Each member can enable their device in <span className="font-medium text-text-primary">My Phone</span>,
          or add a phone-number target below as a reliable fallback.
        </div>
      )}
      <div className="rounded-[12px] border border-amber-400/25 bg-amber-400/[0.06] px-4 py-3 text-[12.5px] leading-relaxed text-text-secondary">
        <span className="font-medium text-text-primary">Routing priority:</span>{' '}
        when global routing is active it overrides each number&apos;s default routing
        mode and every user&apos;s personal My Phone preference. Turn it off to fall
        back to those layers.
      </div>
      <RoutingChainEditorLazy initial={chain} members={members} destinations={destinations} />
    </div>
  )
}

async function AssistantsTab() {
  const supabase = await createClient()
  const { data: vapiIntegration } = await supabase
    .from('integrations')
    .select('id')
    .eq('provider', 'vapi')
    .eq('is_active', true)
    .maybeSingle()

  if (!vapiIntegration) {
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center rounded-[8px] border border-dashed border-border bg-bg-secondary/30 px-4 py-16 text-center">
        <Plug className="mb-4 h-10 w-10 text-muted-foreground" />
        <h3 className="mb-1 text-base font-semibold">Vapi integration required</h3>
        <p className="mb-4 max-w-sm text-sm text-muted-foreground">
          Connect your Vapi account to link voice assistants and route call webhooks to this workspace.
        </p>
        <Button asChild>
          <Link href="/integrations">Go to Integrations</Link>
        </Button>
      </div>
    )
  }

  type AssistantMapping = Database['public']['Tables']['assistant_mappings']['Row']
  const { data } = await supabase
    .from('assistant_mappings')
    .select('*')
    .order('created_at', { ascending: false })

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-text-secondary">
        Vapi voice assistants synced from your account — they answer and route inbound
        voice. Looking for Xphere Agents? Those live in the{' '}
        <Link href="/agents" className="text-accent hover:underline">Agents module</Link>.
      </p>
      <AssistantMappingsTable mappings={(data ?? []) as AssistantMapping[]} />
    </div>
  )
}

function GeneralTab() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <GeneralCard
        href="/integrations/twilio"
        icon={KeyRound}
        title="Twilio integration"
        description="Credentials, webhooks, Voice SDK, and SIP domain live in Integrations."
      />
      <GeneralCard
        href="/campaigns?channel=calls"
        icon={Megaphone}
        title="Voice campaigns"
        description="Outbound call campaigns run from the multi-channel Campaigns module."
      />
      <GeneralCard
        href="/calls?myphone=1"
        icon={Mic}
        title="Call recording"
        description="The record-calls toggle currently lives in each user's My Phone preferences."
      />
      <GeneralCard
        href="/agents"
        icon={Sparkles}
        title="Xphere Agents"
        description="Voice Assistants here are Vapi-side. Platform AI agents live in the Agents module."
      />
    </div>
  )
}

function GeneralCard({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
}) {
  return (
    <Link
      href={href}
      className="group rounded-[12px] border border-border bg-bg-secondary p-4 transition-colors hover:border-border-strong hover:bg-bg-tertiary/50"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-bg-tertiary text-text-secondary transition-colors group-hover:text-text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-[13.5px] font-medium text-text-primary">{title}</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-text-secondary">{description}</p>
        </div>
      </div>
    </Link>
  )
}

/* ── My Phone modal (?myphone=1) ───────────────────────────────────── */

async function MyPhone() {
  const [settings, sipDomain] = await Promise.all([getCurrentCallSettings(), getSipDomain()])
  return (
    <MyPhoneDialog>
      <div className="space-y-4">
        <PushDeviceSection />
        {settings ? <CallSettingsForm initial={settings} sipDomain={sipDomain} /> : null}
      </div>
    </MyPhoneDialog>
  )
}
