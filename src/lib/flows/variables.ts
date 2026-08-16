// Dynamic-variable catalog for the flow builder's field pickers.
//
// Maps a trigger's event_type to the concrete `{{namespace.field}}` tokens that
// resolve at runtime (see run-flow-sync.ts scope building + the per-event
// emitters in lib/contacts/events.ts, lib/calendar/transition.ts,
// lib/pipeline/events.ts). `trigger.fired_at` is always available.

export interface VariableItem {
  /** Path without braces, e.g. "contact.email". */
  token: string
  /** Human label shown in the picker. */
  label: string
}

export interface VariableGroup {
  label: string
  items: VariableItem[]
}

const v = (token: string, label: string): VariableItem => ({ token, label })

const CONTACT_GROUP: VariableGroup = {
  label: 'Contact',
  items: [
    v('contact.name', 'Full name'),
    v('contact.first_name', 'First name'),
    v('contact.last_name', 'Last name'),
    v('contact.email', 'Email'),
    v('contact.phone', 'Phone'),
    v('contact.company', 'Company'),
    v('contact.notes', 'Notes'),
    v('contact.source', 'Source'),
    v('contact.id', 'Contact ID'),
  ],
}

const LEAD_GROUP: VariableGroup = {
  label: 'Lead',
  items: [
    v('lead.receipt_id', 'Receipt ID'),
    v('lead.occurred_at', 'Captured at'),
    v('lead.classification', 'Classification'),
    v('lead.score', 'Score'),
    v('lead.page_url', 'Source page'),
    v('lead.source.tenant_ref', 'Website tenant'),
    v('lead.source.site_domain', 'Website domain'),
  ],
}

const MEETING_GROUP: VariableGroup = {
  label: 'Meeting',
  items: [
    v('meeting.attendee_contact.name', 'Attendee name'),
    v('meeting.attendee_contact.email', 'Attendee email'),
    v('meeting.attendee_contact.phone', 'Attendee phone'),
    v('meeting.event_type.name', 'Event type'),
    v('meeting.starts_at', 'Starts at'),
    v('meeting.ends_at', 'Ends at'),
    v('meeting.status', 'Status'),
    v('meeting.link', 'Meeting link'),
  ],
}

const OPPORTUNITY_GROUP: VariableGroup = {
  label: 'Opportunity',
  items: [
    v('opportunity.title', 'Title'),
    v('opportunity.value', 'Value'),
    v('opportunity.id', 'Opportunity ID'),
    v('stage.name', 'Stage name'),
    v('pipeline.name', 'Pipeline name'),
  ],
}

const PHONE_GROUP: VariableGroup = {
  label: 'Phone',
  items: [
    v('phone.e164', 'Phone number'),
    v('phone.friendly_name', 'Friendly name'),
    v('phone.inbox_label', 'Inbox label'),
    v('phone.business_purpose', 'Business purpose'),
    v('phone.forward_to_number', 'Transfer target'),
  ],
}

const CALL_GROUP: VariableGroup = {
  label: 'Call',
  items: [
    v('call.direction', 'Direction'),
    v('call.duration_seconds', 'Duration (seconds)'),
    v('call.ended_reason', 'Ended reason'),
    v('call.success_evaluation', 'Outcome'),
    v('call.summary', 'Summary'),
    v('call.recording_url', 'Recording URL'),
    v('call.customer_number', 'Caller number'),
    v('call.customer_name', 'Caller name'),
    v('call.org_number', 'Number called'),
    v('call.external_id', 'Vapi call ID'),
  ],
}

const TRIGGER_GROUP: VariableGroup = {
  label: 'Trigger',
  items: [v('trigger.fired_at', 'Fired at (timestamp)')],
}

/**
 * Variable groups available at a node, given the flow's trigger event_type.
 * Returns the most relevant groups first; `trigger.fired_at` is always last.
 */
export function variablesForTrigger(eventType: string | undefined): VariableGroup[] {
  const e = eventType ?? 'manual'

  if (e === 'lead.captured') return [LEAD_GROUP, CONTACT_GROUP, TRIGGER_GROUP]
  if (e === 'contact.created') return [CONTACT_GROUP, TRIGGER_GROUP]

  if (e === 'booking.created' || e.startsWith('meeting.')) {
    return [MEETING_GROUP, TRIGGER_GROUP]
  }

  if (e.startsWith('opportunity.')) {
    return [OPPORTUNITY_GROUP, CONTACT_GROUP, TRIGGER_GROUP]
  }

  if (e.startsWith('inbound_') || e === 'inbound_sms_to_number' || e === 'inbound_call_to_number') {
    return [PHONE_GROUP, CONTACT_GROUP, TRIGGER_GROUP]
  }

  // Vapi calls expose the call itself plus the number it landed on — the number
  // scope is only populated when that number was imported locally.
  if (e === 'vapi.call.ended') {
    return [CALL_GROUP, PHONE_GROUP, CONTACT_GROUP, TRIGGER_GROUP]
  }

  // Channel-message triggers carry a linked contact when one is resolved.
  if (
    e === 'manychat.inbound' ||
    e === 'meta.message.received' ||
    e === 'chat.message.received'
  ) {
    return [CONTACT_GROUP, TRIGGER_GROUP]
  }

  // manual / webhook.custom / cron — no entity scope, just trigger metadata.
  return [TRIGGER_GROUP]
}

/** Append `{{token}}` to a field value, spacing it from existing content. */
export function appendVariableToken(current: string, token: string): string {
  const tok = `{{${token}}}`
  if (!current) return tok
  return current.endsWith(' ') ? `${current}${tok}` : `${current} ${tok}`
}
