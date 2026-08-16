'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Phone, MessageSquare, Mail, MessageCircle, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createCampaign, listCampaignEmailTemplates } from '../actions'
import {
  listApprovedTemplates,
  type ApprovedTemplate,
} from '@/app/(dashboard)/integrations/whatsapp/actions'
import type { CampaignChannel } from '@/types/database'

interface Props {
  assistants: Array<{ id: string; name: string }>
  hasTwilio: boolean
  hasVapi: boolean
  hasResend: boolean
  hasWhatsApp: boolean
  /** When set, skips step 1 and pre-selects this channel. */
  defaultChannel?: CampaignChannel
  /** When provided (e.g. rendered inside a dialog), Cancel closes the surface instead of navigating to /campaigns. */
  onCancel?: () => void
}

interface VapiPhoneNumber {
  id: string
  number?: string
  name?: string
}

const CHANNELS: Array<{
  value: CampaignChannel
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}> = [
  {
    value: 'calls',
    label: 'Voice Call',
    description: 'Make AI-powered outbound calls to a list of contacts.',
    icon: Phone,
  },
  {
    value: 'sms',
    label: 'SMS',
    description: 'Send text messages to your contacts via Twilio.',
    icon: MessageSquare,
  },
  {
    value: 'email',
    label: 'Email',
    description: 'Send email campaigns via Resend.',
    icon: Mail,
  },
  {
    value: 'whatsapp',
    label: 'WhatsApp',
    description: 'Send WhatsApp messages to your contacts.',
    icon: MessageCircle,
  },
]

export function NewCampaignWizard({ assistants, hasTwilio, hasVapi, hasResend, hasWhatsApp, defaultChannel, onCancel }: Props) {
  const router = useRouter()
  // Skip step 1 when a channel is pre-selected.
  const [step, setStep] = useState(defaultChannel ? 2 : 1)
  const [submitting, setSubmitting] = useState(false)
  const availableChannels = CHANNELS.filter((ch) => ch.value !== 'whatsapp' || hasWhatsApp)

  // Step 1 — channel
  const [channel, setChannel] = useState<CampaignChannel>(defaultChannel ?? 'calls')

  // Step 2 — name & description
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  // Step 3 — audience (simplified)
  const [audienceType, setAudienceType] = useState<'all' | 'tagged'>('all')
  const [audienceTag, setAudienceTag] = useState('')

  // Step 4 — template
  const [vapiAssistantId, setVapiAssistantId] = useState('')
  const [vapiPhoneNumberId, setVapiPhoneNumberId] = useState('')
  const [callsPerMinute, setCallsPerMinute] = useState(5)
  const [smsBody, setSmsBody] = useState('')
  const [phoneNumbers, setPhoneNumbers] = useState<VapiPhoneNumber[]>([])
  const [loadingPhones, setLoadingPhones] = useState(false)
  // WhatsApp Cloud template
  const [whatsappTemplates, setWhatsappTemplates] = useState<ApprovedTemplate[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [whatsappTemplateId, setWhatsappTemplateId] = useState<string>('')
  // mapping[i] = source string ('contact.first_name' | 'literal:Hello' | etc)
  const [bodyMapping, setBodyMapping] = useState<string[]>([])
  const [headerMapping, setHeaderMapping] = useState<string[]>([])
  // Email builder template (UFE-12)
  const [emailTemplates, setEmailTemplates] = useState<Array<{ id: string; name: string }>>([])
  const [loadingEmailTemplates, setLoadingEmailTemplates] = useState(false)
  const [emailTemplateId, setEmailTemplateId] = useState<string>('')

  // Step 5 — schedule
  const [scheduleType, setScheduleType] = useState<'now' | 'later'>('now')
  const [scheduledAt, setScheduledAt] = useState('')

  useEffect(() => {
    let cancelled = false

    if (step === 4 && channel === 'whatsapp') {
      void (async () => {
        setLoadingTemplates(true)
        try {
          const data = await listApprovedTemplates()
          if (!cancelled) setWhatsappTemplates(data)
        } catch {
          if (!cancelled) setWhatsappTemplates([])
        } finally {
          if (!cancelled) setLoadingTemplates(false)
        }
      })()
    }
    if (step === 4 && channel === 'email') {
      void (async () => {
        setLoadingEmailTemplates(true)
        try {
          const data = await listCampaignEmailTemplates()
          if (!cancelled) setEmailTemplates(data)
        } catch {
          if (!cancelled) setEmailTemplates([])
        } finally {
          if (!cancelled) setLoadingEmailTemplates(false)
        }
      })()
    }
    if (step === 4 && channel === 'calls') {
      void (async () => {
        setLoadingPhones(true)
        try {
          const response = await fetch('/api/vapi/phone-numbers')
          const data = await response.json()
          if (!cancelled) setPhoneNumbers(Array.isArray(data) ? data : [])
        } catch {
          if (!cancelled) setPhoneNumbers([])
        } finally {
          if (!cancelled) setLoadingPhones(false)
        }
      })()
    }

    return () => {
      cancelled = true
    }
  }, [step, channel])

  function isChannelGated(c: CampaignChannel): boolean {
    if (c === 'email') return !hasResend
    if (c === 'whatsapp') return !hasWhatsApp
    // Voice campaigns are placed through the Vapi API (lib/campaigns/outbound.ts)
    // and never touch Twilio — a customer whose number lives in Vapi has no
    // Twilio account at all. SMS is genuinely Twilio-bound.
    if (c === 'calls') return !hasVapi
    if (c === 'sms') return !hasTwilio
    return false
  }

  function getGatedMessage(c: CampaignChannel): string {
    if (c === 'email') return 'Connect Resend to unlock email campaigns.'
    if (c === 'whatsapp') return 'Connect WhatsApp Official or Zernio to unlock WhatsApp campaigns.'
    if (c === 'calls') return 'Connect Vapi to unlock voice campaigns.'
    if (c === 'sms') return 'Connect Twilio to unlock SMS campaigns.'
    return ''
  }

  function canProceedStep1() {
    return !isChannelGated(channel)
  }

  function canProceedStep2() {
    return name.trim().length >= 2
  }

  function canProceedStep4() {
    if (channel === 'calls') return !!vapiAssistantId && !!vapiPhoneNumberId
    if (channel === 'sms') return smsBody.trim().length >= 1
    if (channel === 'email') return !!emailTemplateId
    if (channel === 'whatsapp') {
      if (!whatsappTemplateId) return false
      const tpl = whatsappTemplates.find((t) => t.id === whatsappTemplateId)
      if (!tpl) return false
      if (bodyMapping.length !== tpl.bodyVariableCount) return false
      if (headerMapping.length !== tpl.headerVariableCount) return false
      if (bodyMapping.some((s) => !s)) return false
      if (headerMapping.some((s) => !s)) return false
      return true
    }
    return true
  }

  async function handleSubmit() {
    setSubmitting(true)
    try {
      const audience_filter: Record<string, unknown> =
        audienceType === 'tagged' && audienceTag
          ? { tag: audienceTag }
          : {}

      const { id } = await createCampaign({
        name: name.trim(),
        description: description.trim() || null,
        channel,
        vapi_assistant_id: channel === 'calls' ? vapiAssistantId : null,
        vapi_phone_number_id: channel === 'calls' ? vapiPhoneNumberId : null,
        calls_per_minute: channel === 'calls' ? callsPerMinute : undefined,
        sms_body: channel === 'sms' ? smsBody.trim() : null,
        whatsapp_template_id: channel === 'whatsapp' ? whatsappTemplateId : null,
        email_template_id: channel === 'email' ? emailTemplateId : null,
        whatsapp_variable_mapping:
          channel === 'whatsapp'
            ? {
                body: bodyMapping.map((source) => ({ source })),
                header: headerMapping.map((source) => ({ source })),
              }
            : null,
        audience_filter,
        scheduled_start_at:
          scheduleType === 'later' && scheduledAt
            ? new Date(scheduledAt).toISOString()
            : null,
      })

      toast.success('Campaign created')
      router.push(`/campaigns/${id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create campaign')
      setSubmitting(false)
    }
  }

  const STEP_LABELS = ['Channel', 'Details', 'Audience', 'Template', 'Schedule']

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {STEP_LABELS.map((label, i) => {
          const num = i + 1
          // Step 1 is always "done" when pre-seeded with a channel.
          const done = num < step || (num === 1 && !!defaultChannel)
          const active = num === step && !(num === 1 && !!defaultChannel)
          return (
            <div key={label} className="flex items-center gap-2">
              <div
                className={[
                  'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold',
                  done ? 'bg-accent text-white' : active ? 'bg-accent/20 text-accent' : 'bg-bg-tertiary text-text-tertiary',
                ].join(' ')}
              >
                {done ? '✓' : num}
              </div>
              <span
                className={[
                  'text-[12px] font-medium',
                  active ? 'text-text-primary' : 'text-text-tertiary',
                ].join(' ')}
              >
                {label}
              </span>
              {i < STEP_LABELS.length - 1 && (
                <ChevronRight className="h-3 w-3 text-text-tertiary mx-1" />
              )}
            </div>
          )
        })}
      </div>

      <div className="rounded-[12px] border border-border bg-bg-secondary p-6">
        {/* Step 1 — Channel */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-[15px] font-semibold text-text-primary">Choose channel</h2>
            <div className="grid grid-cols-2 gap-3">
              {availableChannels.map((ch) => {
                const gated = isChannelGated(ch.value)
                const selected = channel === ch.value
                return (
                  <button
                    key={ch.value}
                    type="button"
                    disabled={gated}
                    onClick={() => !gated && setChannel(ch.value)}
                    className={[
                      'relative rounded-[10px] border p-4 text-left transition-all',
                      gated
                        ? 'border-border opacity-50 cursor-not-allowed'
                        : selected
                        ? 'border-accent bg-accent/5'
                        : 'border-border hover:border-border-strong',
                    ].join(' ')}
                  >
                    <ch.icon className={['h-5 w-5 mb-2', selected ? 'text-accent' : 'text-text-secondary'].join(' ')} />
                    <p className="text-[13px] font-semibold text-text-primary">{ch.label}</p>
                    <p className="text-[12px] text-text-tertiary mt-0.5">
                      {gated ? getGatedMessage(ch.value) : ch.description}
                    </p>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Step 2 — Name & Description */}
        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-[15px] font-semibold text-text-primary">Name your campaign</h2>
            <div className="space-y-2">
              <Label htmlFor="name">Campaign name <span className="text-destructive">*</span></Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Q2 Re-engagement Campaign"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this campaign's goal"
                rows={2}
              />
            </div>
          </div>
        )}

        {/* Step 3 — Audience */}
        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-[15px] font-semibold text-text-primary">Select audience</h2>
            <div className="space-y-2">
              {(['all', 'tagged'] as const).map((type) => (
                <label
                  key={type}
                  className={[
                    'flex items-start gap-3 rounded-[8px] border p-3 cursor-pointer',
                    audienceType === type ? 'border-accent bg-accent/5' : 'border-border hover:border-border-strong',
                  ].join(' ')}
                >
                  <input
                    type="radio"
                    name="audienceType"
                    value={type}
                    checked={audienceType === type}
                    onChange={() => setAudienceType(type)}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-[13px] font-medium text-text-primary">
                      {type === 'all' ? 'All contacts' : 'Contacts with tag'}
                    </p>
                    <p className="text-[12px] text-text-tertiary">
                      {type === 'all'
                        ? 'Send to every contact in your workspace.'
                        : 'Only contacts matching a specific tag.'}
                    </p>
                  </div>
                </label>
              ))}
            </div>
            {audienceType === 'tagged' && (
              <div className="space-y-2">
                <Label htmlFor="audienceTag">Tag name</Label>
                <Input
                  id="audienceTag"
                  value={audienceTag}
                  onChange={(e) => setAudienceTag(e.target.value)}
                  placeholder="e.g. lead, customer, prospect"
                />
              </div>
            )}
          </div>
        )}

        {/* Step 4 — Template / Config */}
        {step === 4 && (
          <div className="space-y-4">
            <h2 className="text-[15px] font-semibold text-text-primary">
              {channel === 'calls' ? 'Configure call settings' : channel === 'sms' ? 'Write your message' : 'Configure template'}
            </h2>

            {channel === 'calls' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="assistant">Vapi assistant <span className="text-destructive">*</span></Label>
                  <select
                    id="assistant"
                    value={vapiAssistantId}
                    onChange={(e) => setVapiAssistantId(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Select an assistant</option>
                    {assistants.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phoneNumber">Phone number <span className="text-destructive">*</span></Label>
                  <select
                    id="phoneNumber"
                    value={vapiPhoneNumberId}
                    onChange={(e) => setVapiPhoneNumberId(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">{loadingPhones ? 'Loading...' : 'Select a phone number'}</option>
                    {phoneNumbers.map((p) => (
                      <option key={p.id} value={p.id}>{p.number ?? p.name ?? p.id}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="callsPerMinute">Calls per minute (1–20)</Label>
                  <Input
                    id="callsPerMinute"
                    type="number"
                    min={1}
                    max={20}
                    value={callsPerMinute}
                    onChange={(e) => setCallsPerMinute(Number(e.target.value))}
                  />
                </div>
              </>
            )}

            {channel === 'sms' && (
              <div className="space-y-2">
                <Label htmlFor="smsBody">Message body <span className="text-destructive">*</span></Label>
                <Textarea
                  id="smsBody"
                  value={smsBody}
                  onChange={(e) => setSmsBody(e.target.value)}
                  placeholder="Your SMS message here. Keep it concise — standard SMS is 160 chars."
                  rows={4}
                />
                <p className="text-[11.5px] text-text-tertiary">{smsBody.length} characters</p>
              </div>
            )}

            {channel === 'email' && (
              <div className="space-y-2">
                <Label htmlFor="email-template">Email template <span className="text-destructive">*</span></Label>
                {loadingEmailTemplates ? (
                  <p className="text-[13px] text-text-tertiary">Loading templates…</p>
                ) : emailTemplates.length === 0 ? (
                  <div className="rounded-md border border-border bg-bg-tertiary/50 p-4 text-center">
                    <p className="text-[13px] text-text-secondary">
                      No published templates yet. Create and publish one in Email Templates first.
                    </p>
                  </div>
                ) : (
                  <select
                    id="email-template"
                    value={emailTemplateId}
                    onChange={(e) => setEmailTemplateId(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Select a template…</option>
                    {emailTemplates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                )}
                <p className="text-[11.5px] text-text-tertiary">
                  Only published templates can be sent. Merge-tags like {'{{contact.first_name}}'} are filled per recipient.
                </p>
              </div>
            )}

            {channel === 'whatsapp' && (
              <WhatsAppTemplateStep
                templates={whatsappTemplates}
                loading={loadingTemplates}
                selectedId={whatsappTemplateId}
                onSelect={(id) => {
                  setWhatsappTemplateId(id)
                  const tpl = whatsappTemplates.find((t) => t.id === id)
                  setBodyMapping(tpl ? new Array(tpl.bodyVariableCount).fill('') : [])
                  setHeaderMapping(tpl ? new Array(tpl.headerVariableCount).fill('') : [])
                }}
                bodyMapping={bodyMapping}
                setBodyMapping={setBodyMapping}
                headerMapping={headerMapping}
                setHeaderMapping={setHeaderMapping}
              />
            )}
          </div>
        )}

        {/* Step 5 — Schedule */}
        {step === 5 && (
          <div className="space-y-4">
            <h2 className="text-[15px] font-semibold text-text-primary">Schedule</h2>
            <div className="space-y-2">
              {(['now', 'later'] as const).map((type) => (
                <label
                  key={type}
                  className={[
                    'flex items-start gap-3 rounded-[8px] border p-3 cursor-pointer',
                    scheduleType === type ? 'border-accent bg-accent/5' : 'border-border hover:border-border-strong',
                  ].join(' ')}
                >
                  <input
                    type="radio"
                    name="scheduleType"
                    value={type}
                    checked={scheduleType === type}
                    onChange={() => setScheduleType(type)}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-[13px] font-medium text-text-primary">
                      {type === 'now' ? 'Save as draft' : 'Schedule for later'}
                    </p>
                    <p className="text-[12px] text-text-tertiary">
                      {type === 'now'
                        ? 'Campaign is saved as draft. Launch it manually when ready.'
                        : 'Set a date and time to automatically start the campaign.'}
                    </p>
                  </div>
                </label>
              ))}
            </div>
            {scheduleType === 'later' && (
              <div className="space-y-2">
                <Label htmlFor="scheduledAt">Start date &amp; time</Label>
                <Input
                  id="scheduledAt"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex gap-3">
        {step > 1 && (
          <Button variant="outline" type="button" onClick={() => setStep((s) => s - 1)}>
            Back
          </Button>
        )}
        {step < 5 && (
          <Button
            type="button"
            disabled={
              (step === 1 && !canProceedStep1()) ||
              (step === 2 && !canProceedStep2()) ||
              (step === 4 && !canProceedStep4())
            }
            onClick={() => setStep((s) => s + 1)}
          >
            Continue
          </Button>
        )}
        {step === 5 && (
          <Button
            type="button"
            disabled={submitting}
            onClick={handleSubmit}
          >
            {submitting ? 'Creating...' : scheduleType === 'later' ? 'Schedule campaign' : 'Create as draft'}
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={() => (onCancel ? onCancel() : router.push('/campaigns'))}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

// ─── WhatsApp template selector + variable mapping ───────────────────────────

const CONTACT_FIELDS: Array<{ value: string; label: string }> = [
  { value: 'contact.first_name', label: 'First name' },
  { value: 'contact.last_name', label: 'Last name' },
  { value: 'contact.name', label: 'Full name' },
  { value: 'contact.email', label: 'Email' },
  { value: 'contact.phone', label: 'Phone' },
  { value: 'contact.company', label: 'Company' },
]

function WhatsAppTemplateStep(props: {
  templates: ApprovedTemplate[]
  loading: boolean
  selectedId: string
  onSelect: (id: string) => void
  bodyMapping: string[]
  setBodyMapping: (next: string[]) => void
  headerMapping: string[]
  setHeaderMapping: (next: string[]) => void
}) {
  const selected = props.templates.find((t) => t.id === props.selectedId) ?? null

  if (props.loading) {
    return (
      <div className="rounded-md border border-border bg-bg-tertiary/50 p-4 text-center text-[13px] text-text-secondary">
        Loading approved templates…
      </div>
    )
  }

  if (props.templates.length === 0) {
    return (
      <div className="rounded-md border border-border bg-bg-tertiary/50 p-4 space-y-2">
        <p className="text-[13px] text-text-secondary">
          No approved templates yet. Create one in Meta Business Manager, sync it from Integrations →
          WhatsApp Official, then come back to this campaign.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-[12px]">Choose a template</Label>
        <select
          value={props.selectedId}
          onChange={(e) => props.onSelect(e.target.value)}
          className="w-full h-9 px-3 rounded-[8px] border border-border bg-bg-secondary text-[13.5px] text-text-primary"
        >
          <option value="">— Select —</option>
          {props.templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.language}) — {t.category}
            </option>
          ))}
        </select>
      </div>

      {selected && (
        <>
          {selected.bodyText && (
            <div className="rounded-[8px] border border-border-subtle bg-bg-tertiary/40 p-3">
              <p className="text-[11px] uppercase tracking-wide text-text-tertiary mb-1.5">Preview</p>
              <p className="text-[12.5px] text-text-secondary whitespace-pre-wrap leading-relaxed">
                {highlightVars(selected.bodyText)}
              </p>
            </div>
          )}

          {selected.category === 'MARKETING' && (
            <div className="rounded-[8px] border border-amber-500/40 bg-amber-500/10 p-3">
              <p className="text-[11.5px] text-amber-200">
                <strong>Marketing template.</strong> Only contacts who have opted in to WhatsApp will receive this
                campaign. Others are auto-skipped.
              </p>
            </div>
          )}

          {selected.headerVariableCount > 0 && (
            <VariableMappingGroup
              label="Header variables"
              count={selected.headerVariableCount}
              mapping={props.headerMapping}
              onChange={props.setHeaderMapping}
            />
          )}

          {selected.bodyVariableCount > 0 && (
            <VariableMappingGroup
              label="Body variables"
              count={selected.bodyVariableCount}
              mapping={props.bodyMapping}
              onChange={props.setBodyMapping}
            />
          )}

          {selected.bodyVariableCount === 0 && selected.headerVariableCount === 0 && (
            <p className="text-[12.5px] text-text-tertiary">This template has no variables — nothing to map.</p>
          )}
        </>
      )}
    </div>
  )
}

function VariableMappingGroup({
  label,
  count,
  mapping,
  onChange,
}: {
  label: string
  count: number
  mapping: string[]
  onChange: (next: string[]) => void
}) {
  const safeMapping = mapping.length === count ? mapping : new Array(count).fill('')

  return (
    <div className="space-y-2">
      <Label className="text-[12px]">{label}</Label>
      {Array.from({ length: count }).map((_, idx) => {
        const value = safeMapping[idx] ?? ''
        const isLiteral = value.startsWith('literal:')
        const dropdownValue = isLiteral ? 'literal' : value
        return (
          <div key={idx} className="flex items-start gap-2">
            <span className="mt-1.5 text-[11px] font-mono text-text-tertiary w-12 shrink-0">
              {'{{' + (idx + 1) + '}}'}
            </span>
            <select
              value={dropdownValue}
              onChange={(e) => {
                const next = [...safeMapping]
                if (e.target.value === 'literal') {
                  next[idx] = 'literal:'
                } else {
                  next[idx] = e.target.value
                }
                onChange(next)
              }}
              className="h-9 px-3 rounded-[8px] border border-border bg-bg-secondary text-[12.5px] text-text-primary"
            >
              <option value="">— Source —</option>
              {CONTACT_FIELDS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
              <option value="literal">Literal text…</option>
            </select>
            {isLiteral && (
              <Input
                value={value.slice('literal:'.length)}
                onChange={(e) => {
                  const next = [...safeMapping]
                  next[idx] = `literal:${e.target.value}`
                  onChange(next)
                }}
                placeholder="Literal value"
                className="flex-1 text-[12.5px]"
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function highlightVars(text: string): React.ReactNode {
  const parts = text.split(/(\{\{\d+\}\})/)
  return parts.map((part, i) =>
    /^\{\{\d+\}\}$/.test(part) ? (
      <span key={i} className="px-1 rounded bg-accent/15 text-accent font-mono text-[11.5px]">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}
