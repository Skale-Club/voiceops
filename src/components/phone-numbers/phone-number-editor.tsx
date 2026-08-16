'use client'

/**
 * Calls > Phone Numbers > [id] editor (phone-numbers project Phase 5).
 *
 * The single full-edit surface for a number: identity (inbox_label,
 * business_purpose), capabilities (voice/sms/mms) + default routing mode,
 * the per-number vapi_assistant_id override, responsible owner, and notes.
 *
 * Only provider credentials (Account SID, Auth Token, Voice SDK, SIP) live on
 * the Twilio integration page (/integrations/twilio) — numbers are managed here.
 */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Star, Power, PowerOff, Bot } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  updateTwilioNumber,
  setDefaultTwilioNumber,
  softDeleteTwilioNumber,
  type OrgMemberOption,
  type TwilioPhoneNumberRow,
} from '@/app/(dashboard)/integrations/twilio/numbers-actions'
import { formatEmailDisplay } from '@/lib/email-addresses/format'

interface Props {
  number: TwilioPhoneNumberRow
  members: OrgMemberOption[]
  /** When provided (e.g. rendered in a dialog), called after a successful save/archive. */
  onClose?: () => void
}

const UNASSIGNED = '__unassigned__'
const ROUTING_NONE = '__none__'
const E164_REGEX = /^\+[1-9]\d{6,14}$/

type RoutingMode = 'browser' | 'sip' | 'forward'

export function PhoneNumberEditor({ number, members, onClose }: Props) {
  const router = useRouter()
  const isVapi = number.provider === 'vapi'
  const [saving, setSaving] = React.useState(false)
  const [actionLoading, setActionLoading] = React.useState<'default' | 'archive' | null>(null)

  const [friendlyName, setFriendlyName] = React.useState(number.friendly_name ?? '')
  const [inboxLabel, setInboxLabel] = React.useState(number.inbox_label ?? '')
  const [businessPurpose, setBusinessPurpose] = React.useState(number.business_purpose ?? '')
  const [vapiAssistantId, setVapiAssistantId] = React.useState(number.vapi_assistant_id ?? '')
  const [vapiAssistants, setVapiAssistants] = React.useState<Array<{ id: string; name: string }>>([])
  const [loadingAssistants, setLoadingAssistants] = React.useState(false)

  React.useEffect(() => {
    setLoadingAssistants(true)
    fetch('/api/vapi/assistants')
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setVapiAssistants(Array.isArray(data) ? data : []))
      .catch(() => setVapiAssistants([]))
      .finally(() => setLoadingAssistants(false))
  }, [])
  const [responsibleUserId, setResponsibleUserId] = React.useState<string>(
    number.responsible_user_id ?? UNASSIGNED,
  )
  const [notes, setNotes] = React.useState(number.notes ?? '')

  const [capVoice, setCapVoice] = React.useState(number.capability_voice)
  const [capSms, setCapSms] = React.useState(number.capability_sms)
  const [capMms, setCapMms] = React.useState(number.capability_mms)
  const [routingMode, setRoutingMode] = React.useState<'none' | RoutingMode>(
    (number.default_routing_mode as RoutingMode | null) ?? 'none',
  )
  const [forwardTo, setForwardTo] = React.useState(number.forward_to_number ?? '')

  const handleSave = React.useCallback(async () => {
    // Vapi numbers don't show the capability picker (voice-only by construction)
    // or the TwiML routing modes, so neither rule applies to them.
    if (!isVapi && !capVoice && !capSms && !capMms) {
      toast.error('Enable at least one capability (Voice, SMS, or MMS).')
      return
    }
    const trimmedForward = forwardTo.trim()
    if (isVapi) {
      if (trimmedForward && !E164_REGEX.test(trimmedForward)) {
        toast.error('Transfer target must be a valid E.164 number.')
        return
      }
    } else if (routingMode === 'forward' && !E164_REGEX.test(trimmedForward)) {
      toast.error('Forward target must be a valid E.164 number.')
      return
    }
    setSaving(true)
    try {
      const result = await updateTwilioNumber(number.id, {
        provider: number.provider,
        friendly_name: friendlyName.trim() || number.friendly_name,
        inbox_label: inboxLabel.trim() || '',
        business_purpose: businessPurpose.trim() || '',
        vapi_assistant_id: vapiAssistantId.trim() || '',
        responsible_user_id: responsibleUserId === UNASSIGNED ? null : responsibleUserId,
        notes: notes.trim() || '',
        ...(isVapi
          ? { forward_to_number: trimmedForward }
          : {
              capability_voice: capVoice,
              capability_sms: capSms,
              capability_mms: capMms,
              default_routing_mode: routingMode === 'none' ? null : routingMode,
              forward_to_number: routingMode === 'forward' ? trimmedForward : '',
            }),
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Phone number updated.')
      router.refresh()
      onClose?.()
    } finally {
      setSaving(false)
    }
  }, [
    number.id,
    number.friendly_name,
    number.provider,
    isVapi,
    friendlyName,
    inboxLabel,
    businessPurpose,
    vapiAssistantId,
    responsibleUserId,
    notes,
    capVoice,
    capSms,
    capMms,
    routingMode,
    forwardTo,
    router,
    onClose,
  ])

  const handleSetDefault = React.useCallback(async () => {
    setActionLoading('default')
    try {
      const result = await setDefaultTwilioNumber(number.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Set as default.')
      router.refresh()
    } finally {
      setActionLoading(null)
    }
  }, [number.id, router])

  const handleArchive = React.useCallback(async () => {
    if (!confirm('Archive this number? It will stop receiving inbound traffic.')) return
    setActionLoading('archive')
    try {
      const result = await softDeleteTwilioNumber(number.id)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Phone number archived.')
      if (onClose) {
        router.refresh()
        onClose()
      } else {
        router.push('/calls?settings=numbers')
      }
    } finally {
      setActionLoading(null)
    }
  }, [number.id, router, onClose])

  return (
    <div className="space-y-8">
      {/* Status / quick actions row */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle bg-bg-secondary/50 px-4 py-3 text-sm">
        <span className="font-mono text-text-primary">{number.e164}</span>
        {number.is_default && (
          <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-1.5 py-0.5 text-[10.5px] font-medium text-success">
            <Star className="h-2.5 w-2.5" /> Default
          </span>
        )}
        <span className="text-text-tertiary">·</span>
        <span className="text-text-tertiary">
          {[
            number.capability_voice && 'Voice',
            number.capability_sms && 'SMS',
            number.capability_mms && 'MMS',
          ]
            .filter(Boolean)
            .join(' · ') || 'No capabilities enabled'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {!number.is_default && number.is_active && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleSetDefault}
              disabled={actionLoading !== null}
            >
              {actionLoading === 'default' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Star className="mr-1 h-3.5 w-3.5" /> Set as default
                </>
              )}
            </Button>
          )}
          {number.is_active ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleArchive}
              disabled={actionLoading !== null}
            >
              {actionLoading === 'archive' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <PowerOff className="mr-1 h-3.5 w-3.5" /> Archive
                </>
              )}
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] text-text-tertiary">
              <Power className="h-3 w-3" /> Inactive
            </span>
          )}
        </div>
      </div>

      {/* Operational identity */}
      <section className="space-y-4">
        <header>
          <h3 className="text-sm font-semibold text-text-primary">Identity</h3>
          <p className="text-[11px] text-text-tertiary">
            How this number appears in the inbox, conversation headers, and reports.
          </p>
        </header>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="friendly_name">Friendly name</Label>
            <Input
              id="friendly_name"
              value={friendlyName}
              onChange={(e) => setFriendlyName(e.target.value)}
              placeholder="Sales line"
              maxLength={64}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inbox_label">Inbox label</Label>
            <Input
              id="inbox_label"
              value={inboxLabel}
              onChange={(e) => setInboxLabel(e.target.value)}
              placeholder="Falls back to friendly name when empty"
              maxLength={64}
            />
          </div>
          <div className="md:col-span-2 space-y-1.5">
            <Label htmlFor="business_purpose">Business purpose</Label>
            <Input
              id="business_purpose"
              value={businessPurpose}
              onChange={(e) => setBusinessPurpose(e.target.value)}
              placeholder="e.g. Sales — Brazil, Customer support tier 1"
              maxLength={120}
            />
          </div>
        </div>
      </section>

      {/* Capabilities & routing — Twilio only.
          A Vapi-native number has no Twilio capabilities to mirror, and the
          routing modes below are all TwiML (browser dialer, SIP, <Dial>), which
          never runs for a call Vapi answers itself. Vapi numbers get the
          transfer target instead. */}
      {isVapi ? (
        <section className="space-y-4">
          <header>
            <h3 className="text-sm font-semibold text-text-primary">Call transfer</h3>
            <p className="text-[11px] text-text-tertiary">
              Where the assistant sends the caller when it hands off to a human.
            </p>
          </header>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="forward_to">Transfer to (E.164)</Label>
              <Input
                id="forward_to"
                value={forwardTo}
                onChange={(e) => setForwardTo(e.target.value)}
                placeholder="+14155557890"
                className="font-mono text-[12.5px]"
                autoComplete="off"
              />
              <p className="text-[11px] text-text-tertiary">
                Available to workflows as{' '}
                <code className="font-mono">{'{{phone.forward_to_number}}'}</code>. The assistant&apos;s
                own transfer destination is still configured in Vapi.
              </p>
            </div>
          </div>
        </section>
      ) : (
        <section className="space-y-4">
          <header>
            <h3 className="text-sm font-semibold text-text-primary">Capabilities & routing</h3>
            <p className="text-[11px] text-text-tertiary">
              Mark the capabilities enabled on the Twilio side, and how inbound calls to this
              number are routed by default.
            </p>
          </header>
          <div className="space-y-2">
            <Label>Capabilities</Label>
            <div className="flex flex-wrap items-center gap-4">
              <CapabilityCheckbox label="Voice" checked={capVoice} onChange={setCapVoice} />
              <CapabilityCheckbox label="SMS" checked={capSms} onChange={setCapSms} />
              <CapabilityCheckbox label="MMS" checked={capMms} onChange={setCapMms} />
            </div>
            <p className="text-[11px] text-text-tertiary">
              Xphere refuses to send SMS from a number without the SMS capability.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="routing_mode">Default routing mode</Label>
              <Select
                value={routingMode === 'none' ? ROUTING_NONE : routingMode}
                onValueChange={(v) =>
                  setRoutingMode(v === ROUTING_NONE ? 'none' : (v as RoutingMode))
                }
              >
                <SelectTrigger id="routing_mode">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ROUTING_NONE}>None | handled per call</SelectItem>
                  <SelectItem value="browser">Browser dialer</SelectItem>
                  <SelectItem value="sip">SIP (Zoiper, softphone)</SelectItem>
                  <SelectItem value="forward">Forward to number</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {routingMode === 'forward' && (
              <div className="space-y-1.5">
                <Label htmlFor="forward_to">Forward to (E.164)</Label>
                <Input
                  id="forward_to"
                  value={forwardTo}
                  onChange={(e) => setForwardTo(e.target.value)}
                  placeholder="+14155557890"
                  className="font-mono text-[12.5px]"
                  autoComplete="off"
                />
              </div>
            )}
          </div>
        </section>
      )}

      {/* Assistant & ownership */}
      <section className="space-y-4">
        <header>
          <h3 className="text-sm font-semibold text-text-primary">Assistant & ownership</h3>
          <p className="text-[11px] text-text-tertiary">
            Per-number overrides for the org-level Vapi mapping and the human accountable for
            this line.
          </p>
        </header>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="vapi_assistant_id">Vapi assistant</Label>
            {loadingAssistants ? (
              <div className="flex h-9 items-center gap-2 rounded-md border border-border-subtle bg-bg-secondary px-3 text-[12.5px] text-text-tertiary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading assistants…
              </div>
            ) : vapiAssistants.length === 0 ? (
              // Fallback to free-text if Vapi isn't connected or returned nothing.
              <Input
                id="vapi_assistant_id"
                value={vapiAssistantId}
                onChange={(e) => setVapiAssistantId(e.target.value)}
                placeholder="asst_… — leave blank to use org-level mapping"
                maxLength={128}
              />
            ) : (
              <Select
                value={vapiAssistantId || '__none__'}
                onValueChange={(v) => setVapiAssistantId(v === '__none__' ? '' : v)}
              >
                <SelectTrigger id="vapi_assistant_id">
                  <SelectValue placeholder="Use org-level mapping" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    <span className="text-text-tertiary">Use org-level mapping</span>
                  </SelectItem>
                  {vapiAssistants.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="inline-flex items-center gap-1.5">
                        <Bot className="h-3.5 w-3.5 text-text-tertiary" />
                        {a.name || a.id}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-[11px] text-text-tertiary">
              When set, inbound voice uses this assistant for this number instead of the org default.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="responsible_user_id">Responsible owner</Label>
            <Select value={responsibleUserId} onValueChange={setResponsibleUserId}>
              <SelectTrigger id="responsible_user_id">
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.display_name}
                    {m.email && m.email !== m.display_name && (
                      <span className="ml-1 text-text-tertiary">({formatEmailDisplay(m.email)})</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-text-tertiary">
              Shown in the inbox to identify the human accountable for this line.
            </p>
          </div>
        </div>
      </section>

      {/* Notes */}
      <section className="space-y-4">
        <header>
          <h3 className="text-sm font-semibold text-text-primary">Notes</h3>
          <p className="text-[11px] text-text-tertiary">
            Internal context for teammates. Not surfaced to contacts.
          </p>
        </header>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={500}
          rows={4}
          placeholder="Setup history, vendor links, escalation contacts…"
        />
      </section>

      <div className="flex items-center justify-end gap-2 border-t border-border-subtle pt-4">
        <Button variant="ghost" onClick={() => router.refresh()} disabled={saving}>
          Reset
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save changes
        </Button>
      </div>
    </div>
  )
}

function CapabilityCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  const id = `cap-${label.toLowerCase()}`
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <Label htmlFor={id} className="cursor-pointer text-[13px] font-medium">
        {label}
      </Label>
    </div>
  )
}
