'use client'

import * as React from 'react'
import {
  Activity,
  Building2,
  CheckCircle2,
  Copy,
  ExternalLink,
  Gauge,
  Globe,
  ListTodo,
  Loader2,
  MessageSquare,
  Sparkles,
  StickyNote,
  TriangleAlert,
  UserRound,
} from 'lucide-react'
import { toast } from 'sonner'

import {
  addProspectNote,
  addProspectTask,
  applyQualification,
  convertProspectToContact,
  generateProspectPreview,
  getProspectDetail,
  suggestQualification,
  type ProspectDetail,
  type ProspectRow,
  type QualificationSuggestion,
  type WebsiteAnalysis,
} from '@/app/(dashboard)/prospects/actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmailVerificationBadge } from '@/components/prospects/email-verification-badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { formatPhoneDisplay } from '@/lib/phone-numbers/format'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

function statusLabel(value: string): string {
  return value.replaceAll('_', ' ')
}

function when(iso: string): string {
  return new Date(iso).toLocaleString()
}

interface ProspectDetailSheetProps {
  prospect: ProspectRow | null
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}

export function ProspectDetailSheet({ prospect, onOpenChange, onChanged }: ProspectDetailSheetProps) {
  const [detail, setDetail] = React.useState<ProspectDetail | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [suggestion, setSuggestion] = React.useState<QualificationSuggestion | null>(null)
  const [aiBusy, setAiBusy] = React.useState(false)

  React.useEffect(() => {
    if (!prospect) {
      setDetail(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setDetail(null)
    setSuggestion(null)
    getProspectDetail(prospect.kind, prospect.id).then((res) => {
      if (cancelled) return
      setLoading(false)
      if (res.ok) setDetail(res.detail)
      else toast.error(res.error)
    })
    return () => {
      cancelled = true
    }
  }, [prospect])

  async function handleConvert() {
    if (!prospect) return
    setBusy(true)
    const res = await convertProspectToContact(prospect.kind, prospect.id)
    setBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(prospect.kind === 'company' ? 'Company promoted to lead' : 'Prospect converted to lead')
    onChanged()
  }

  async function handleSuggest() {
    if (!prospect) return
    setAiBusy(true)
    const res = await suggestQualification(prospect.kind, prospect.id)
    setAiBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setSuggestion(res.suggestion)
  }

  async function handleApplySuggestion() {
    if (!prospect || !suggestion) return
    setAiBusy(true)
    const res = await applyQualification(prospect.kind, prospect.id, {
      intentLevel: suggestion.intentLevel,
      qualificationStatus: suggestion.qualificationStatus,
      recommendedChannel: suggestion.recommendedChannel,
    })
    setAiBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Qualification applied')
    setSuggestion(null)
    const refreshed = await getProspectDetail(prospect.kind, prospect.id)
    if (refreshed.ok) setDetail(refreshed.detail)
  }

  return (
    <Dialog open={Boolean(prospect)} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(780px,calc(100vh-2rem))] max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-[560px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border-subtle px-5 py-4 pr-12">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-accent-muted text-accent">
              {prospect?.kind === 'company' ? <Building2 className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
            </span>
            <div className="min-w-0">
              <DialogTitle className="truncate text-[15px]">
                {prospect?.name || 'Prospect'}
              </DialogTitle>
              <DialogDescription className="truncate text-[12px]">
                {prospect?.company || prospect?.email || prospect?.phone || (prospect?.kind === 'company' ? 'Company prospect' : 'Person prospect')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {loading || !detail ? (
          <div className="flex flex-1 items-center justify-center py-20 text-text-tertiary">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
            {/* Qualification chips */}
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary" className="capitalize">{statusLabel(detail.engagementStatus)}</Badge>
              <Badge variant="outline" className="capitalize">intent: {detail.intentLevel}</Badge>
              <Badge variant="outline" className="capitalize">{statusLabel(detail.qualificationStatus)}</Badge>
              <Badge variant="outline">score {detail.score}</Badge>
              {detail.recommendedChannel && (
                <Badge variant="outline" className="capitalize">→ {detail.recommendedChannel}</Badge>
              )}
            </div>

            {/* AI qualification */}
            <div className="rounded-[10px] border border-border-subtle bg-bg-tertiary/30 p-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  <Sparkles className="h-3.5 w-3.5" /> AI qualification
                </span>
                <Button size="sm" variant="ghost" className="h-7" onClick={handleSuggest} disabled={aiBusy}>
                  {aiBusy && !suggestion ? '…' : 'Suggest'}
                </Button>
              </div>
              {suggestion && (
                <div className="mt-2 space-y-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="capitalize">intent: {suggestion.intentLevel}</Badge>
                    <Badge variant="outline" className="capitalize">{statusLabel(suggestion.qualificationStatus)}</Badge>
                    {suggestion.recommendedChannel && (
                      <Badge variant="outline" className="capitalize">→ {suggestion.recommendedChannel}</Badge>
                    )}
                    <Badge
                      variant="outline"
                      className={
                        suggestion.source === 'ai'
                          ? 'ml-auto border-accent/40 text-accent'
                          : 'ml-auto text-text-tertiary'
                      }
                    >
                      {suggestion.source === 'ai' ? 'AI' : 'rules'}
                    </Badge>
                  </div>
                  <p className="text-[12px] text-text-tertiary">{suggestion.rationale}</p>
                  {suggestion.opener && (
                    <div className="rounded-[8px] border border-border-subtle bg-bg-secondary p-2.5">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                          Suggested opener
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 gap-1 px-2 text-[11px]"
                          onClick={() => {
                            navigator.clipboard.writeText(suggestion.opener ?? '')
                            toast.success('Copied')
                          }}
                        >
                          <Copy className="h-3 w-3" /> Copy
                        </Button>
                      </div>
                      <p className="whitespace-pre-wrap text-[12.5px] text-text-primary">{suggestion.opener}</p>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button size="sm" className="h-7" onClick={handleApplySuggestion} disabled={aiBusy}>
                      Apply
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => setSuggestion(null)} disabled={aiBusy}>
                      Dismiss
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Details */}
            <Section icon={Activity} title="Details">
              <dl className="grid gap-1.5 text-[13px]">
                <DetailRow
                  label="Email"
                  value={detail.email}
                  endContent={
                    detail.email || detail.emailStatus ? (
                      <EmailVerificationBadge
                        status={detail.emailStatus}
                        risk={detail.emailRisk}
                        verifiedAt={detail.emailVerifiedAt}
                        provider={detail.emailVerificationProvider}
                        size="sm"
                      />
                    ) : null
                  }
                />
                <DetailRow label="Phone" value={formatPhoneDisplay(detail.phone) || null} />
                <DetailRow label="Company" value={detail.company} />
                <DetailRow
                  label="Source"
                  value={[detail.sourceType || detail.source, detail.sourceId].filter(Boolean).join(' · ')}
                />
                {detail.tags.length > 0 && (
                  <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
                    <span className="text-text-tertiary">Tags</span>
                    <div className="flex flex-wrap gap-1">
                      {detail.tags.map((t) => (
                        <Badge key={t} variant="outline">{t}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                <DetailRow label="Conversations" value={detail.conversationCount > 0 ? String(detail.conversationCount) : null} />
                <DetailRow label="Added" value={when(detail.createdAt)} />
              </dl>
            </Section>

            {/* Website analysis (company prospects) */}
            {detail.websiteAnalysis && (
              <WebsiteAnalysisSection
                analysis={detail.websiteAnalysis}
                accountId={detail.id}
                onChanged={async () => {
                  if (!prospect) return
                  const refreshed = await getProspectDetail(prospect.kind, prospect.id)
                  if (refreshed.ok) setDetail(refreshed.detail)
                }}
              />
            )}

            {/* Convert action */}
            <div className="rounded-[10px] border border-border-subtle bg-bg-tertiary/30 p-3">
              <p className="mb-2 text-[12px] text-text-tertiary">
                Converting moves this record into the normal CRM as a lead, preserving its source, timeline, notes, and conversations.
              </p>
              <Button onClick={handleConvert} disabled={busy} className="w-full">
                <CheckCircle2 className="h-4 w-4" />
                {busy ? 'Converting…' : prospect?.kind === 'company' ? 'Promote company to lead' : 'Convert to Contact'}
              </Button>
            </div>

            {/* Timeline */}
            <Section icon={Activity} title="Timeline" count={detail.events.length}>
              {detail.events.length === 0 ? (
                <Empty>No engagement events yet.</Empty>
              ) : (
                <div className="space-y-2">
                  {detail.events.map((e) => (
                    <div key={e.id} className="flex items-start gap-2 text-[12.5px]">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                      <div className="min-w-0">
                        <span className="font-medium capitalize text-text-primary">{statusLabel(e.eventType)}</span>
                        {e.channel && <span className="text-text-tertiary"> · {e.channel}</span>}
                        {e.sourcePlatform && <span className="text-text-tertiary"> · {e.sourcePlatform}</span>}
                        <div className="text-[11px] text-text-tertiary">{when(e.occurredAt)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Notes */}
            <Section icon={StickyNote} title="Notes" count={detail.notes.length}>
              <AddInline
                placeholder="Add a note…"
                multiline
                onSubmit={async (value) => {
                  if (!prospect) return false
                  const res = await addProspectNote(prospect.kind, prospect.id, value)
                  if (!res.ok) {
                    toast.error(res.error)
                    return false
                  }
                  const refreshed = await getProspectDetail(prospect.kind, prospect.id)
                  if (refreshed.ok) setDetail(refreshed.detail)
                  return true
                }}
              />
              <div className="mt-2 space-y-2">
                {detail.notes.map((n) => (
                  <div key={n.id} className="rounded-[8px] border border-border-subtle bg-bg-secondary px-3 py-2 text-[12.5px]">
                    <p className="whitespace-pre-wrap text-text-primary">{n.content}</p>
                    <p className="mt-1 text-[11px] text-text-tertiary">{when(n.createdAt)}</p>
                  </div>
                ))}
              </div>
            </Section>

            {/* Tasks */}
            <Section icon={ListTodo} title="Tasks" count={detail.tasks.length}>
              <AddInline
                placeholder="Add a follow-up task…"
                onSubmit={async (value) => {
                  if (!prospect) return false
                  const res = await addProspectTask(prospect.kind, prospect.id, value)
                  if (!res.ok) {
                    toast.error(res.error)
                    return false
                  }
                  const refreshed = await getProspectDetail(prospect.kind, prospect.id)
                  if (refreshed.ok) setDetail(refreshed.detail)
                  return true
                }}
              />
              <div className="mt-2 space-y-1.5">
                {detail.tasks.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 text-[12.5px]">
                    <ListTodo className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                    <span className="min-w-0 flex-1 truncate text-text-primary">{t.title}</span>
                    <Badge variant="outline" className="capitalize">{statusLabel(t.status)}</Badge>
                  </div>
                ))}
              </div>
            </Section>

            {detail.conversationCount > 0 && (
              <Section icon={MessageSquare} title="Conversations">
                <p className="text-[12.5px] text-text-secondary">
                  {detail.conversationCount} linked conversation{detail.conversationCount === 1 ? '' : 's'} — preserved on conversion.
                </p>
              </Section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Section({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  count?: number
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
        <Icon className="h-3.5 w-3.5" />
        <span>{title}</span>
        {typeof count === 'number' && <span className="tabular-nums">· {count}</span>}
      </div>
      {children}
    </div>
  )
}

function DetailRow({
  label,
  value,
  endContent,
}: {
  label: string
  value: string | null
  /** Optional trailing content (e.g. a status badge) shown next to the value. */
  endContent?: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
      <span className="text-text-tertiary">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-text-primary">{value || '—'}</span>
        {endContent}
      </span>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] text-text-tertiary">{children}</p>
}

function scoreColor(score: number): string {
  if (score >= 60) return 'var(--accent)'
  if (score >= 40) return '#d97706' // amber
  if (score >= 20) return '#6b7280' // gray
  return '#16a34a' // green = site already good = weak opportunity
}

function WebsiteAnalysisSection({
  analysis,
  accountId,
  onChanged,
}: {
  analysis: WebsiteAnalysis
  accountId: string
  onChanged: () => Promise<void>
}) {
  const [busy, setBusy] = React.useState(false)

  if (analysis.status === 'failed') {
    return (
      <Section icon={Globe} title="Website analysis">
        <p className="text-[12.5px] text-text-tertiary">
          Analysis failed{analysis.errorMessage ? `: ${analysis.errorMessage.split('\n')[0]}` : '.'}
        </p>
      </Section>
    )
  }
  if (analysis.status !== 'completed') {
    return (
      <Section icon={Globe} title="Website analysis">
        <p className="flex items-center gap-1.5 text-[12.5px] text-text-tertiary">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing the website…
        </p>
      </Section>
    )
  }

  const ev = (analysis.rawEvidence ?? {}) as {
    isMobileResponsive?: boolean
    hasCTA?: boolean
    hasContactInfo?: boolean
    loadMs?: number
  }

  // Site problems = selling points for "we already built you a better version".
  const problems: string[] = []
  if (ev.isMobileResponsive === false) problems.push('Not mobile responsive')
  if (analysis.logoUrl === null) problems.push('No identifiable logo')
  if (ev.hasCTA === false) problems.push('No clear call to action (CTA)')
  if (typeof ev.loadMs === 'number' && ev.loadMs > 4000) problems.push(`Slow to load (${(ev.loadMs / 1000).toFixed(1)}s)`)
  if (ev.hasContactInfo === false) problems.push('Contact info hard to find')

  const score = analysis.leadScore ?? 0
  const verdict =
    score >= 60 ? 'Strong opportunity' : score >= 40 ? 'Good opportunity' : score >= 20 ? 'Weak opportunity' : 'Website already solid'

  async function handlePreview() {
    setBusy(true)
    const res = await generateProspectPreview(accountId)
    setBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success('Preview generated at websites.skale.club')
    await onChanged()
  }

  return (
    <Section icon={Globe} title="Website analysis">
      <div className="space-y-3">
        {/* Score + verdict */}
        <div className="flex items-center gap-2 text-[12.5px]">
          <span
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-semibold tabular-nums text-white"
            style={{ backgroundColor: scoreColor(score) }}
          >
            <Gauge className="h-3 w-3" /> {score}
          </span>
          <span className="text-text-primary">{verdict}</span>
          {analysis.url && (
            <a
              href={analysis.url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-text-tertiary hover:text-accent hover:underline"
            >
              view site <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        {/* Screenshots */}
        {(analysis.screenshotDesktopUrl || analysis.screenshotMobileUrl) && (
          <div className="flex gap-2">
            {analysis.screenshotDesktopUrl && (
              <a href={analysis.screenshotDesktopUrl} target="_blank" rel="noopener noreferrer" className="block flex-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={analysis.screenshotDesktopUrl}
                  alt="Desktop"
                  className="h-24 w-full rounded-[6px] border border-border-subtle object-cover object-top"
                />
                <span className="mt-1 block text-center text-[10.5px] text-text-tertiary">Desktop</span>
              </a>
            )}
            {analysis.screenshotMobileUrl && (
              <a href={analysis.screenshotMobileUrl} target="_blank" rel="noopener noreferrer" className="block w-[72px] shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={analysis.screenshotMobileUrl}
                  alt="Mobile"
                  className="h-24 w-full rounded-[6px] border border-border-subtle object-cover object-top"
                />
                <span className="mt-1 block text-center text-[10.5px] text-text-tertiary">Mobile</span>
              </a>
            )}
          </div>
        )}

        {/* Problems = selling points */}
        {problems.length > 0 && (
          <div className="rounded-[8px] border border-border-subtle bg-bg-tertiary/30 p-2.5">
            <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
              <TriangleAlert className="h-3.5 w-3.5" /> Issues (selling points)
            </span>
            <ul className="space-y-0.5">
              {problems.map((p) => (
                <li key={p} className="flex items-start gap-1.5 text-[12.5px] text-text-primary">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Detected services */}
        {analysis.services.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {analysis.services.slice(0, 8).map((s) => (
              <Badge key={s} variant="outline" className="text-[11px]">{s}</Badge>
            ))}
          </div>
        )}

        {/* Manual preview generation */}
        {analysis.previewUrl ? (
          <a
            href={analysis.previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 rounded-[8px] border border-accent/40 bg-accent-muted/30 px-3 py-2 text-[12.5px] font-medium text-accent hover:bg-accent-muted/50"
          >
            <Globe className="h-4 w-4" /> View generated preview <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : (
          <Button onClick={handlePreview} disabled={busy} variant="secondary" className="w-full">
            <Globe className="h-4 w-4" />
            {busy ? 'Generating preview…' : 'Generate improved website preview'}
          </Button>
        )}
        <p className="text-[11px] text-text-tertiary">
          The preview is only created when you click — we don&apos;t register the client automatically.
        </p>
      </div>
    </Section>
  )
}

function AddInline({
  placeholder,
  multiline,
  onSubmit,
}: {
  placeholder: string
  multiline?: boolean
  onSubmit: (value: string) => Promise<boolean>
}) {
  const [value, setValue] = React.useState('')
  const [pending, startTransition] = React.useTransition()

  function submit() {
    const text = value.trim()
    if (!text) return
    startTransition(async () => {
      const ok = await onSubmit(text)
      if (ok) setValue('')
    })
  }

  return (
    <div className="flex items-start gap-2">
      {multiline ? (
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="min-h-[40px] flex-1 text-[12.5px]"
        />
      ) : (
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="h-8 flex-1 text-[12.5px]"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
        />
      )}
      <Button size="sm" variant="secondary" className="h-8 shrink-0" disabled={pending || !value.trim()} onClick={submit}>
        {pending ? '…' : 'Add'}
      </Button>
    </div>
  )
}
