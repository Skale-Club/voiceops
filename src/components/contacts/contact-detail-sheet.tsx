'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Phone,
  Mail,
  Building2,
  Calendar,
  Pencil,
  Trash2,
  MessageSquare,
  PhoneCall,
  Activity,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react'
import Link from 'next/link'

import { formatCurrency } from '@/lib/pipeline/format'
import { TagBadge } from '@/components/tags/tag-badge'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { prefillDialPad } from '@/components/calls/dial-pad-context'
import { useDialpadAvailable } from '@/components/phone/dialpad-availability-context'
import { formatPhoneDisplay } from '@/lib/phone-numbers/format'
import { formatEmailDisplay } from '@/lib/email-addresses/format'
import { isValidEmail } from '@/lib/contacts/zod-schemas'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ChannelBadge, type Channel } from '@/components/design-system/channel-badge'
import { EmailVerificationBadge } from '@/components/prospects/email-verification-badge'
import { ContactForm } from './contact-form'
import { CustomFieldsDisplay } from '@/components/custom-fields/custom-fields-display'
import {
  getContact,
  updateContact,
  deleteContact,
  type ContactDetail,
} from '@/app/(dashboard)/contacts/actions'
import { cn } from '@/lib/utils'
import { displayContactName, initialsFromContactName } from '@/lib/contacts/names'
import { DndBadge } from '@/components/contacts/dnd-badge'
import { ContactDndSection } from '@/components/contacts/contact-dnd-section'
import {
  EntityDetailLoadingState,
  EntityDetailNotFoundState,
  EntityDetailTemplate,
} from '@/components/crm/entity-template'

interface ContactDetailSheetProps {
  contactId: string | null
  onOpenChange: (open: boolean) => void
  /**
   * Open the sheet directly in edit mode (skips the read-only view). Used by
   * the chat header's "Edit contact" shortcut so mobile operators land on the
   * editable form in a single tap.
   */
  initialEditing?: boolean
}

function relativeTime(iso: string | null): string {
  if (!iso) return ''
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

export function ContactDetailSheet({ contactId, onOpenChange, initialEditing = false }: ContactDetailSheetProps) {
  const [contact, setContact] = React.useState<ContactDetail | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const router = useRouter()
  const dialpadAvailable = useDialpadAvailable()

  React.useEffect(() => {
    if (!contactId) {
      setContact(null)
      setEditing(false)
      return
    }
    setEditing(initialEditing)
    let cancelled = false
    setLoading(true)
    getContact(contactId).then((c) => {
      if (cancelled) return
      setContact(c)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [contactId, initialEditing])

  async function handleDelete() {
    if (!contact) return
    if (!confirm(`Delete ${displayContactName(contact, 'this contact')}? This cannot be undone.`)) return
    const res = await deleteContact(contact.id)
    if (res && 'error' in res && res.error) {
      toast.error(res.error)
      return
    }
    toast.success('Contact deleted')
    onOpenChange(false)
    router.refresh()
  }

  return (
    <Dialog open={Boolean(contactId)} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(780px,calc(100vh-2rem))] max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-[560px] flex-col overflow-hidden p-0 gap-0">
        {loading && !contact ? (
          <EntityDetailLoadingState
            title={
              <DialogTitle className="sr-only">Loading contact</DialogTitle>
            }
          />
        ) : !contact ? (
          <EntityDetailNotFoundState
            title={<DialogTitle className="sr-only">Contact not found</DialogTitle>}
          >
            Contact not found.
          </EntityDetailNotFoundState>
        ) : editing ? (
          <EntityDetailTemplate>
            <DialogHeader className="border-b border-border-subtle px-6 py-4">
              <DialogTitle>Edit contact</DialogTitle>
              <DialogDescription>Update fields below.</DialogDescription>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <ContactForm
                defaultValues={{
                  first_name: contact.first_name ?? '',
                  last_name: contact.last_name ?? '',
                  name: contact.name ?? '',
                  phone: contact.phone ?? '',
                  email: contact.email ?? '',
                  company: contact.account?.name ?? contact.company ?? '',
                  account_id: contact.account_id ?? null,
                  notes: contact.notes ?? '',
                  tags: contact.tagIds ?? [],
                  custom_fields: (contact.custom_fields as Record<string, unknown>) ?? {},
                }}
                submitLabel="Save changes"
                onCancel={() => setEditing(false)}
                onSubmit={async (values) => {
                  const res = await updateContact(contact.id, values)
                  if (res && 'error' in res && res.error) return { error: res.error }
                  toast.success('Contact updated')
                  setEditing(false)
                  const fresh = await getContact(contact.id)
                  setContact(fresh)
                  router.refresh()
                }}
              />
            </div>
          </EntityDetailTemplate>
        ) : (
          <EntityDetailTemplate>
            {/* Header */}
            <div className="border-b border-border-subtle px-6 py-5">
              <div className="flex items-start gap-3">
                <Avatar className="h-14 w-14">
                  <AvatarFallback className="text-[15px] font-semibold bg-accent-muted text-accent">
                    {initialsFromContactName(contact, contact.email ?? contact.phone ?? '?')}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <DialogTitle className="flex items-center gap-2 text-[18px] truncate">
                    <span className="truncate">{displayContactName(contact)}</span>
                    <DndBadge dndEnabled={Boolean(contact.dnd_enabled)} dndChannels={contact.dnd_channels ?? []} iconOnly={false} />
                  </DialogTitle>
                  {(contact.account?.name ?? contact.company) && (
                    <p className="mt-0.5 text-[12.5px] text-text-secondary truncate">
                      {contact.account?.name ?? contact.company}
                    </p>
                  )}
                  {contact.tagEntities.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {contact.tagEntities.map((t) => (
                        <TagBadge key={t.id} name={t.name} color={t.color} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-4 flex items-center gap-1.5">
                <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={handleDelete} className="text-rose-400 hover:text-rose-300">
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </div>
            </div>

            {/* Tabs */}
            <Tabs defaultValue="info" className="flex flex-col flex-1 overflow-hidden">
              <TabsList className="mx-6 mt-4 self-start">
                <TabsTrigger value="info">Info</TabsTrigger>
                <TabsTrigger value="conversations">
                  Conversations
                  {contact.conversations.length > 0 && (
                    <span className="ml-1 text-[10px] text-text-tertiary">
                      {contact.conversations.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="calls">
                  Calls
                  {contact.call_logs.length > 0 && (
                    <span className="ml-1 text-[10px] text-text-tertiary">
                      {contact.call_logs.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="activities">Activities</TabsTrigger>
              </TabsList>

              <div className="flex-1 overflow-y-auto px-6 py-5">
                <TabsContent value="info" className="space-y-3 mt-0">
                  <InfoRow
                    icon={Phone}
                    label="Phone"
                    value={contact.phone ? formatPhoneDisplay(contact.phone) : null}
                    onClick={
                      contact.phone
                        ? dialpadAvailable
                          ? () => prefillDialPad(contact.phone!)
                          : () => {
                              window.location.href = `tel:${contact.phone}`
                            }
                        : undefined
                    }
                    title={contact.phone ? (dialpadAvailable ? 'Open in dial-pad' : `Call ${formatPhoneDisplay(contact.phone)}`) : undefined}
                  />
                  <InfoRow
                    icon={Mail}
                    label="Email"
                    value={formatEmailDisplay(contact.email)}
                    onClick={contact.email ? () => { window.location.href = `mailto:${contact.email}` } : undefined}
                    warning={
                      contact.email && !isValidEmail(contact.email)
                        ? 'Invalid email format — open this contact to fix it'
                        : undefined
                    }
                    endContent={
                      contact.email ? (
                        <EmailVerificationBadge
                          status={contact.email_status}
                          risk={contact.email_risk}
                          verifiedAt={contact.email_verified_at}
                          provider={contact.email_verification_provider}
                          size="sm"
                        />
                      ) : null
                    }
                  />
                  <InfoRow icon={Building2} label="Company" value={contact.account?.name ?? contact.company} />
                  <InfoRow
                    icon={Calendar}
                    label="Created"
                    value={`${relativeTime(contact.created_at)} · source: ${contact.source}`}
                  />
                  {contact.notes && (
                    <div className="mt-4 rounded-[10px] border border-border-subtle bg-bg-secondary px-3.5 py-3">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
                        Notes
                      </div>
                      <p className="mt-1.5 whitespace-pre-wrap text-[13px] text-text-primary leading-relaxed">
                        {contact.notes}
                      </p>
                    </div>
                  )}
                  <CustomFieldsDisplay
                    entity="contact"
                    customFields={contact.custom_fields as Record<string, unknown>}
                  />
                  <ContactDndSection
                    contactId={contact.id}
                    initialDnd={{
                      dnd_enabled: Boolean(contact.dnd_enabled),
                      dnd_channels: contact.dnd_channels ?? [],
                      dnd_note: contact.dnd_note ?? null,
                    }}
                  />
                </TabsContent>

                <TabsContent value="conversations" className="mt-0">
                  {contact.conversations.length === 0 ? (
                    <EmptyTab
                      icon={MessageSquare}
                      title="No conversations yet"
                      description="When this contact messages on a channel, the thread will appear here."
                    />
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {contact.conversations.map((c) => (
                        <a
                          key={c.id}
                          href={`/inbox?conversation=${c.id}`}
                          className="flex items-center gap-3 rounded-[10px] border border-border-subtle bg-bg-secondary px-3.5 py-3 hover:border-border-strong hover:bg-bg-tertiary/40 transition-colors duration-150"
                        >
                          <ChannelBadge channel={c.channel as Channel} showLabel={false} size="md" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12.5px] text-text-primary">
                              {c.last_message || '-'}
                            </div>
                            <div className="text-[11px] text-text-tertiary">
                              {relativeTime(c.last_message_at)} · {c.status}
                            </div>
                          </div>
                        </a>
                      ))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="calls" className="mt-0">
                  {contact.call_logs.length === 0 ? (
                    <EmptyTab
                      icon={PhoneCall}
                      title="No calls yet"
                      description="Inbound and outbound calls with this contact will appear here automatically."
                    />
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {contact.call_logs.map((c) => (
                        <a
                          key={c.id}
                          href={`/voice/${c.id}`}
                          className="flex items-center gap-3 rounded-[10px] border border-border-subtle bg-bg-secondary px-3.5 py-3 hover:border-border-strong hover:bg-bg-tertiary/40 transition-colors duration-150"
                        >
                          <div className={cn(
                            'flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]',
                            c.direction === 'inbound' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-accent-muted/30 text-accent',
                          )}>
                            <PhoneCall className="h-3.5 w-3.5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12.5px] text-text-primary capitalize">
                              {c.direction} · {c.status ?? '-'}
                            </div>
                            <div className="text-[11px] text-text-tertiary">
                              {relativeTime(c.started_at)}
                              {c.duration_seconds ? ` · ${Math.floor(c.duration_seconds / 60)}:${(c.duration_seconds % 60).toString().padStart(2, '0')}` : ''}
                              {c.recording_url ? ' · recorded' : ''}
                            </div>
                          </div>
                        </a>
                      ))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="activities" className="mt-0">
                  {contact.opportunities.length === 0 ? (
                    <EmptyTab
                      icon={Activity}
                      title="No opportunities yet"
                      description="Create a deal in the pipeline and link it to this contact to track activity here."
                    />
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {contact.opportunities.map((o) => (
                        <Link
                          key={o.id}
                          href={`/pipeline/${o.id}`}
                          className="flex items-center gap-3 rounded-[10px] border border-border-subtle bg-bg-secondary px-3.5 py-3 hover:border-border-strong hover:bg-bg-tertiary/40 transition-colors duration-150"
                        >
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-accent-muted/30 text-accent">
                            <TrendingUp className="h-3.5 w-3.5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12.5px] text-text-primary">
                              {o.title}
                            </div>
                            <div className="text-[11px] text-text-tertiary inline-flex items-center gap-1.5">
                              {o.stage && (
                                <>
                                  <span
                                    className="h-2 w-2 rounded-full"
                                    style={{ backgroundColor: o.stage.color }}
                                  />
                                  {o.stage.name}
                                </>
                              )}
                              <span>· {relativeTime(o.updated_at)} · {o.status}</span>
                            </div>
                          </div>
                          <div className="text-[12.5px] font-semibold tabular-nums text-text-primary shrink-0">
                            {formatCurrency(Number(o.value), o.currency)}
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </TabsContent>
              </div>
            </Tabs>
          </EntityDetailTemplate>
        )}
      </DialogContent>
    </Dialog>
  )
}

function InfoRow({
  icon: Icon,
  label,
  value,
  onClick,
  title,
  warning,
  endContent,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | null
  onClick?: () => void
  title?: string
  /** When set, renders an amber AlertTriangle next to the value and uses amber text color. */
  warning?: string
  /** Optional trailing content (e.g. a status badge) shown next to the value. */
  endContent?: React.ReactNode
}) {
  const interactive = Boolean(onClick && value)
  const Inner = (
    <>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-bg-tertiary ring-1 ring-border-subtle text-text-tertiary">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wide text-text-tertiary">{label}</div>
        <div
          className={cn(
            'text-[13px] flex items-center gap-1.5',
            value
              ? warning
                ? 'text-amber-200'
                : 'text-text-primary'
              : 'text-text-tertiary italic',
            interactive && 'group-hover:text-accent transition-colors',
          )}
        >
          {warning && <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" />}
          <span className="truncate">{value || 'Not set'}</span>
          {endContent}
        </div>
      </div>
    </>
  )
  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className="group flex w-full items-start gap-3 text-left rounded-[8px] -mx-1 px-1 py-1 hover:bg-bg-tertiary/40 transition-colors cursor-pointer"
      >
        {Inner}
      </button>
    )
  }
  return <div className="flex items-start gap-3">{Inner}</div>
}

function EmptyTab({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-bg-tertiary ring-1 ring-border-subtle text-text-tertiary">
        <Icon className="h-4 w-4" />
      </div>
      <h4 className="text-[13.5px] font-medium text-text-primary">{title}</h4>
      <p className="max-w-xs text-[12.5px] text-text-secondary leading-relaxed">{description}</p>
    </div>
  )
}
