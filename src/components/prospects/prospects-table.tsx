'use client'

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Building2, ExternalLink, Plus, Search, UserRound } from 'lucide-react'
import { toast } from 'sonner'

import {
  bulkAssignToList,
  bulkConvertProspects,
  bulkDeleteProspects,
  bulkSetIntent,
  bulkSetQualification,
  createProspect,
  importProspectsCsv,
  sendToXpot,
  startOutreach,
  type ProspectFilters,
  type ProspectKind,
  type ProspectRef,
  type ProspectRow,
} from '@/app/(dashboard)/prospects/actions'
import { EmailVerificationBadge } from '@/components/prospects/email-verification-badge'
import { ProspectDetailSheet } from '@/components/prospects/prospect-detail-sheet'
import { VoiceCampaignDialog } from '@/components/prospects/voice-campaign-dialog'
import { WhatsAppBulkDialog } from '@/components/prospects/whatsapp-bulk-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PhoneDisplay } from '@/components/phone/phone-display'
import { PhoneInput } from '@/components/ui/phone-input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type {
  CrmEngagementStatus,
  CrmIntentLevel,
  CrmQualificationStatus,
} from '@/types/database'
import { cn } from '@/lib/utils'

/** Prefix a bare domain with https:// so it forms a valid external href. */
function toHref(website: string): string {
  const trimmed = website.trim()
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

/** Strip scheme and trailing slash for a compact display label. */
function cleanDomain(website: string): string {
  return website
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/$/, '')
}

interface ProspectsTableProps {
  rows: ProspectRow[]
  total: number
  page: number
  pageSize: number
  lists: { id: string; name: string }[]
  filters: ProspectFilters
  outreachEnabled: boolean
  xpotEnabled: boolean
}

const ENGAGEMENT_OPTIONS: CrmEngagementStatus[] = [
  'not_contacted', 'contacted', 'opened', 'clicked', 'replied',
  'engaged', 'interested', 'needs_follow_up', 'not_interested', 'unsubscribed',
]
const INTENT_OPTIONS: CrmIntentLevel[] = ['none', 'low', 'medium', 'high']
const QUALIFICATION_OPTIONS: CrmQualificationStatus[] = ['unqualified', 'needs_review', 'qualified']
const ALL = '__all__'

function scoreStyle(score: number | null | undefined): React.CSSProperties {
  const s = score ?? 0
  // 0–33 cold (blue), 34–66 neutral (amber), 67–100 hot (red)
  if (s <= 33) {
    const intensity = s / 33
    return {
      backgroundColor: `rgba(59,130,246,${0.12 + intensity * 0.12})`,
      color: `rgb(${Math.round(96 + intensity * 30)},${Math.round(165 - intensity * 30)},250)`,
    }
  }
  if (s <= 66) {
    const intensity = (s - 34) / 32
    return {
      backgroundColor: `rgba(245,158,11,${0.12 + intensity * 0.08})`,
      color: `rgb(251,${Math.round(191 - intensity * 20)},36)`,
    }
  }
  const intensity = (s - 67) / 33
  return {
    backgroundColor: `rgba(239,68,68,${0.13 + intensity * 0.12})`,
    color: `rgb(${Math.round(248 + intensity * 5)},${Math.round(113 - intensity * 40)},${Math.round(113 - intensity * 60)})`,
  }
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.round(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

function statusLabel(value: string): string {
  return value.replaceAll('_', ' ')
}

function rowKey(row: { kind: ProspectKind; id: string }): string {
  return `${row.kind}:${row.id}`
}

export function ProspectsTable({
  rows,
  total,
  page,
  pageSize,
  lists,
  filters,
  outreachEnabled,
  xpotEnabled,
}: ProspectsTableProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [detail, setDetail] = React.useState<ProspectRow | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [searchValue, setSearchValue] = React.useState(filters.q ?? '')
  const [cityValue, setCityValue] = React.useState(filters.city ?? '')

  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  function updateParam(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '' || value === ALL) params.delete(key)
      else params.set(key, value)
    }
    if (!('page' in updates)) params.delete('page')
    router.push(`${pathname}?${params.toString()}`)
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault()
    updateParam({ q: searchValue.trim() || null })
  }

  function submitCity(e: React.FormEvent) {
    e.preventDefault()
    updateParam({ city: cityValue.trim() || null })
  }

  const selectedRows: ProspectRow[] = React.useMemo(
    () => rows.filter((r) => selected.has(rowKey(r))),
    [rows, selected],
  )
  const selectedRefs: ProspectRef[] = React.useMemo(
    () => selectedRows.map((r) => ({ kind: r.kind, id: r.id })),
    [selectedRows],
  )

  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(rowKey(r)))

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allOnPageSelected) rows.forEach((r) => next.delete(rowKey(r)))
      else rows.forEach((r) => next.add(rowKey(r)))
      return next
    })
  }

  function toggleOne(row: ProspectRow) {
    setSelected((prev) => {
      const next = new Set(prev)
      const key = rowKey(row)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function runBulk(label: string, fn: () => Promise<{ ok: boolean; error?: string; affected?: number }>) {
    setBusy(true)
    const res = await fn()
    setBusy(false)
    if (!res.ok) {
      toast.error(res.error ?? 'Action failed')
      return
    }
    toast.success(`${label}: ${res.affected ?? selectedRefs.length} updated`)
    setSelected(new Set())
    router.refresh()
  }

  function clearAndRefresh() {
    setSelected(new Set())
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <NewProspectDialog onCreated={() => router.refresh()} />
        <ImportProspectsDialog onImported={() => router.refresh()} />

        <form onSubmit={submitSearch} className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
          <Input
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder="Search prospects…"
            className="h-8 w-[220px] pl-8 text-[13px]"
          />
        </form>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          value={filters.kind ?? 'all'}
          onChange={(v) => updateParam({ kind: v === 'all' ? null : v })}
          placeholder="Type"
          options={[
            { value: 'all', label: 'All types' },
            { value: 'person', label: 'People' },
            { value: 'company', label: 'Companies' },
          ]}
        />
        <FilterSelect
          value={filters.engagement ?? ALL}
          onChange={(v) => updateParam({ engagement: v })}
          placeholder="Engagement"
          options={[
            { value: ALL, label: 'Any engagement' },
            ...ENGAGEMENT_OPTIONS.map((s) => ({ value: s, label: statusLabel(s) })),
          ]}
        />
        <FilterSelect
          value={filters.intent ?? ALL}
          onChange={(v) => updateParam({ intent: v })}
          placeholder="Intent"
          options={[
            { value: ALL, label: 'Any intent' },
            ...INTENT_OPTIONS.map((s) => ({ value: s, label: s })),
          ]}
        />
        <FilterSelect
          value={filters.qualification ?? ALL}
          onChange={(v) => updateParam({ qualification: v })}
          placeholder="Qualification"
          options={[
            { value: ALL, label: 'Any qualification' },
            ...QUALIFICATION_OPTIONS.map((s) => ({ value: s, label: statusLabel(s) })),
          ]}
        />
        <FilterSelect
          value={filters.emailStatus ?? ALL}
          onChange={(v) => updateParam({ emailStatus: v })}
          placeholder="Email"
          options={[
            { value: ALL, label: 'Any email' },
            { value: 'ok', label: 'Verified' },
            { value: 'catch_all', label: 'Catch-all' },
            { value: 'unverified', label: 'Not verified' },
            { value: 'invalid', label: 'Invalid' },
          ]}
        />
        <form onSubmit={submitCity}>
          <Input
            value={cityValue}
            onChange={(e) => setCityValue(e.target.value)}
            onBlur={() => updateParam({ city: cityValue.trim() || null })}
            placeholder="City…"
            className="h-8 w-[130px] text-[12.5px]"
          />
        </form>
        {lists.length > 0 && (
          <FilterSelect
            value={filters.listId ?? ALL}
            onChange={(v) => updateParam({ list: v })}
            placeholder="List"
            options={[
              { value: ALL, label: 'Any list' },
              ...lists.map((l) => ({ value: l.id, label: l.name })),
            ]}
          />
        )}
        <div className="ml-auto flex items-center gap-2">
          <FilterSelect
            value={filters.sort ?? 'recent'}
            onChange={(v) => updateParam({ sort: v === 'recent' ? null : v })}
            placeholder="Sort"
            options={[
              { value: 'recent', label: 'Most recent' },
              { value: 'score', label: 'Highest score' },
              { value: 'name', label: 'Name (A–Z)' },
            ]}
          />
          <Badge variant="secondary">{total}</Badge>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedRefs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-accent/30 bg-accent-muted/40 px-3 py-2">
          <span className="text-[12.5px] font-medium text-text-primary">
            {selectedRefs.length} selected
          </span>
          <div className="h-4 w-px bg-border" />
          <Button size="sm" variant="secondary" className="h-7" disabled={busy}
            onClick={() => runBulk('Converted', () => bulkConvertProspects(selectedRefs))}>
            Convert to lead
          </Button>
          <BulkSelect placeholder="Assign to list" disabled={busy || lists.length === 0}
            options={lists.map((l) => ({ value: l.id, label: l.name }))}
            onPick={(listId) => runBulk('Assigned', () => bulkAssignToList(selectedRefs, listId))} />
          <BulkSelect placeholder="Set qualification" disabled={busy}
            options={QUALIFICATION_OPTIONS.map((s) => ({ value: s, label: statusLabel(s) }))}
            onPick={(v) => runBulk('Qualification', () => bulkSetQualification(selectedRefs, v as CrmQualificationStatus))} />
          <BulkSelect placeholder="Set intent" disabled={busy}
            options={INTENT_OPTIONS.map((s) => ({ value: s, label: s }))}
            onPick={(v) => runBulk('Intent', () => bulkSetIntent(selectedRefs, v as CrmIntentLevel))} />
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            disabled={busy || !outreachEnabled}
            title={outreachEnabled ? 'Start email outreach via Xmail' : 'Configure Xmail to enable outreach'}
            onClick={() => runBulk('Outreach started', () => startOutreach(selectedRefs))}
          >
            Start outreach
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            disabled={busy || !xpotEnabled}
            title={xpotEnabled ? 'Send to Xpot for a field visit' : 'Configure Xpot to enable field visits'}
            onClick={() => runBulk('Sent to Xpot', () => sendToXpot(selectedRefs))}
          >
            Send to Xpot
          </Button>
          <VoiceCampaignDialog
            selectedRefs={selectedRefs}
            selectedRows={selectedRows}
            disabled={busy}
            onDone={clearAndRefresh}
          />
          <WhatsAppBulkDialog
            selectedRefs={selectedRefs}
            selectedRows={selectedRows}
            disabled={busy}
            onDone={clearAndRefresh}
          />
          <Button size="sm" variant="ghost" className="h-7 text-red-500 hover:text-red-600" disabled={busy}
            onClick={() => {
              if (confirm(`Delete ${selectedRefs.length} prospect(s)? This cannot be undone.`)) {
                runBulk('Deleted', () => bulkDeleteProspects(selectedRefs))
              }
            }}>
            Delete
          </Button>
          <button type="button" className="ml-auto text-[12px] text-text-tertiary hover:text-text-primary"
            onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {/* List */}
      <div className="rounded-[12px] border border-border bg-bg-secondary overflow-hidden">
        <div className="hidden grid-cols-[28px_1.6fr_1fr_1fr_1fr_70px_1fr_90px] items-center gap-3 border-b border-border-subtle px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary sm:grid">
          <input type="checkbox" checked={allOnPageSelected} onChange={toggleAll} className="h-3.5 w-3.5 accent-[var(--accent)]" aria-label="Select all" />
          <div>Prospect</div>
          <div>Phone</div>
          <div>City</div>
          <div>Source</div>
          <div className="text-right">Score</div>
          <div>Qualification</div>
          <div className="text-right">Added</div>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-text-secondary">
            No prospects match these filters.
          </div>
        ) : (
          <div className="divide-y divide-border-subtle">
            {rows.map((row) => {
              const isSelected = selected.has(rowKey(row))
              return (
                <div
                  key={rowKey(row)}
                  className={cn(
                    'grid grid-cols-[28px_minmax(0,1fr)] items-center gap-3 px-4 py-3 transition-colors hover:bg-bg-tertiary/40',
                    'sm:grid-cols-[28px_1.6fr_1fr_1fr_1fr_70px_1fr_90px]',
                    isSelected && 'bg-accent-muted/20',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleOne(row)}
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                    aria-label={`Select ${row.name ?? 'prospect'}`}
                  />
                  <div className="flex min-w-0 items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => setDetail(row)}
                      aria-label={`Open ${row.name ?? 'prospect'}`}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-accent-muted text-accent"
                    >
                      {row.kind === 'company' ? <Building2 className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
                    </button>
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => setDetail(row)}
                        className="block max-w-full truncate text-left text-[13px] font-medium text-text-primary hover:text-accent"
                      >
                        {row.name || <span className="italic text-text-tertiary">Unnamed prospect</span>}
                      </button>
                      <div className="flex min-w-0 items-center gap-1.5">
                        {row.website ? (
                          <a
                            href={toHref(row.website)}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`Open ${cleanDomain(row.website)} in a new tab`}
                            className="flex max-w-full items-center gap-1 text-[11.5px] text-text-tertiary hover:text-accent hover:underline"
                          >
                            <span className="truncate">{cleanDomain(row.website)}</span>
                            <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                          </a>
                        ) : (
                          <div className="truncate text-[11.5px] text-text-tertiary">
                            {row.company || row.email || row.phone || (row.kind === 'company' ? 'Company' : 'Person')}
                          </div>
                        )}
                        {row.email && (
                          <EmailVerificationBadge
                            status={row.emailStatus}
                            risk={row.emailRisk}
                            verifiedAt={row.emailVerifiedAt}
                            provider={row.emailVerificationProvider}
                            size="sm"
                            showLabel={false}
                            className="shrink-0"
                          />
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="hidden truncate text-[12.5px] text-text-secondary sm:block">
                    <PhoneDisplay value={row.phone} stopPropagation />
                    {!row.phone && '—'}
                  </div>
                  <div className="hidden truncate text-[12.5px] text-text-secondary sm:block">
                    {row.city || '—'}
                  </div>
                  <div className="hidden truncate text-[12.5px] text-text-secondary sm:block">
                    {row.sourceType || row.source}
                  </div>
                  <div className="hidden text-right sm:block">
                    <span
                      className="inline-block rounded px-1.5 py-0.5 text-[12px] font-semibold tabular-nums"
                      style={scoreStyle(row.score)}
                    >
                      {row.score}
                    </span>
                  </div>
                  <div className="hidden text-[12.5px] capitalize text-text-secondary sm:block">
                    {statusLabel(row.qualificationStatus)}
                  </div>
                  <div className="hidden text-right text-[11.5px] text-text-tertiary sm:block">
                    {relativeTime(row.createdAt)}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="flex items-center justify-between text-[12.5px] text-text-secondary">
          <span>
            Page {page} of {pageCount} · {total} total
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" className="h-7" disabled={page <= 1}
              onClick={() => updateParam({ page: String(page - 1) })}>
              Previous
            </Button>
            <Button size="sm" variant="secondary" className="h-7" disabled={page >= pageCount}
              onClick={() => updateParam({ page: String(page + 1) })}>
              Next
            </Button>
          </div>
        </div>
      )}

      <ProspectDetailSheet
        prospect={detail}
        onOpenChange={(open) => { if (!open) setDetail(null) }}
        onChanged={() => { setDetail(null); router.refresh() }}
      />
    </div>
  )
}

function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  options: { value: string; label: string }[]
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-auto min-w-[130px] text-[12.5px] capitalize">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-[12.5px] capitalize">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function BulkSelect({
  placeholder,
  options,
  onPick,
  disabled,
}: {
  placeholder: string
  options: { value: string; label: string }[]
  onPick: (value: string) => void
  disabled?: boolean
}) {
  return (
    <Select value="" onValueChange={onPick} disabled={disabled}>
      <SelectTrigger className="h-7 w-auto min-w-[140px] text-[12px] capitalize">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-[12px] capitalize">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function ImportProspectsDialog({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [csv, setCsv] = React.useState('name,email,phone,company,source_id\n')
  const [defaultCountry, setDefaultCountry] = React.useState('')
  const [pending, startTransition] = React.useTransition()

  function submit() {
    startTransition(async () => {
      const res = await importProspectsCsv(csv, defaultCountry.trim() || undefined)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(`Imported ${res.inserted} prospect${res.inserted === 1 ? '' : 's'}`)
      setOpen(false)
      onImported()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" className="h-8">
          Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Import prospects</DialogTitle>
          <DialogDescription>
            Paste CSV with headers such as name, email, phone, company, and source_id.
            Add a <code>country</code> column (ISO code, e.g. <code>BR</code>, <code>PT</code>, <code>US</code>) to
            read bare local-format phone numbers correctly per row.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea
            value={csv}
            onChange={(event) => setCsv(event.target.value)}
            className="min-h-[220px] font-mono text-[12px]"
          />
          <div className="space-y-1.5">
            <Label>Default phone country (optional)</Label>
            <Input
              value={defaultCountry}
              onChange={(e) => setDefaultCountry(e.target.value)}
              placeholder="ISO code, e.g. BR — used for rows without their own country column"
              maxLength={2}
              className="uppercase"
            />
          </div>
          <Button onClick={submit} disabled={pending || csv.trim().split('\n').length < 2} className="w-full">
            {pending ? 'Importing...' : 'Import prospects'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function NewProspectDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [kind, setKind] = React.useState<ProspectKind>('person')
  const [name, setName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [phone, setPhone] = React.useState('')
  const [company, setCompany] = React.useState('')
  const [sourceType, setSourceType] = React.useState('')
  const [pending, startTransition] = React.useTransition()

  function reset() {
    setKind('person')
    setName('')
    setEmail('')
    setPhone('')
    setCompany('')
    setSourceType('')
  }

  function submit() {
    startTransition(async () => {
      const res = await createProspect({ kind, name, email, phone, company, sourceType })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success('Prospect created')
      reset()
      setOpen(false)
      onCreated()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8">
          <Plus className="h-3.5 w-3.5" />
          Prospect
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New prospect</DialogTitle>
          <DialogDescription>Create an early-stage record without exposing it in normal CRM views.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={kind} onValueChange={(value) => setKind(value as ProspectKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="person">Person</SelectItem>
                <SelectItem value="company">Company</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'company' ? 'Company name' : 'Person name'} />
          </div>
          {kind === 'person' && (
            <div className="space-y-1.5">
              <Label>Company</Label>
              <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Optional company" />
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional email" />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <PhoneInput value={phone} onChange={setPhone} placeholder="Optional phone" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Source</Label>
            <Input value={sourceType} onChange={(e) => setSourceType(e.target.value)} placeholder="manual, xcraper, csv, event..." />
          </div>
          <Button onClick={submit} disabled={pending || !name.trim()} className="w-full">
            {pending ? 'Creating...' : 'Create prospect'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
