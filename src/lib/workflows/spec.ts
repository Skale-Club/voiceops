// SEED-026 Phase A: org-filtered workflow capability spec.
//
// Single source of truth for everything authorable in the workflow system.
// Consumed by:
//   - the in-app Copilot (system prompt + list_capabilities tool)
//   - external coding agents via /api/workflows/spec
//   - the validator (validate.ts)
//   - the manual workflow builder (palette filtering)
//
// The spec is filtered server-side per org so the AI cannot reference
// disconnected integrations. The list of triggers/nodes is static at the
// platform level; integration availability is dynamic per org.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { listAvailableIntegrations } from '@/lib/workflows/health'
import {
  getWorkflowInputSchema,
  getWorkflowOutputSchema,
  type InputSchemaMap,
} from '@/lib/workflows/derive-input-schema'

export const SPEC_VERSION = '2026.05.20'

// ─── Trigger types ────────────────────────────────────────────────────────────

export interface TriggerSpec {
  type: string
  description: string
  variables: string[]                         // names exposed in scope
  config_schema?: Record<string, unknown>     // JSONSchema for trigger_config
}

export const TRIGGERS: TriggerSpec[] = [
  {
    type: 'tool_call',
    description:
      'Invoked by name from an AI agent, voice call, or chat handler. Use for actions ' +
      'that must be callable by an LLM (send_sms, lookup_contact, etc.).',
    variables: ['trigger.fired_at', 'input.*'],
    config_schema: {
      type: 'object',
      properties: { tool_name: { type: 'string', minLength: 1 } },
      required: ['tool_name'],
    },
  },
  {
    type: 'manual',
    description: 'Run only when explicitly invoked from the UI or API.',
    variables: ['trigger.fired_at', 'input.*'],
  },
  {
    type: 'webhook_url',
    description: 'Receives POST requests at a per-workflow URL. Body is exposed as input.*',
    variables: ['trigger.fired_at', 'input.*', 'trigger.headers'],
  },
  {
    type: 'schedule',
    description: 'Cron-driven recurring trigger. Use for nightly jobs, sweeps, retries.',
    variables: ['trigger.fired_at'],
    config_schema: {
      type: 'object',
      properties: { cron: { type: 'string' } },
      required: ['cron'],
    },
  },

  // ─── Calendar events (SEED-027 | only available once that seed ships;
  // declared here so the spec is the unified registry).
  {
    type: 'event:lead.captured',
    description: 'A unique inbound lead submission was accepted from an external capture source.',
    variables: ['lead.*', 'contact.*', 'trigger.fired_at'],
  },
  {
    type: 'event:contact.created',
    description: 'A new contact row was inserted.',
    variables: ['contact.*', 'trigger.fired_at'],
  },

  // ─── Commerce events (Phase 136). Pushed from the connected Medusa store via
  // POST /api/v1/commerce/events and dispatched by emitCommerceEvent.
  {
    type: 'event:commerce.order.placed',
    description: 'A Medusa order was placed and pushed from the connected store. Exposes order totals, line items, and the resolved contact.',
    variables: ['order.*', 'contact.*', 'trigger.fired_at'],
  },
  {
    type: 'event:commerce.customer.created',
    description: 'A new Medusa customer was created and pushed from the connected store.',
    variables: ['customer.*', 'contact.*', 'trigger.fired_at'],
  },
  {
    type: 'event:workflow.run.failed',
    description: 'A workflow run failed. Payload includes workflow.name and workflow.error.',
    variables: ['workflow.*', 'trigger.fired_at'],
  },
  {
    type: 'event:meeting.requested',
    description:
      'A booking request was received but is still pending/awaiting the provider\'s approval -- may still be rejected. No bookings row exists yet for it.',
    variables: ['meeting.*', 'trigger.fired_at'],
  },
  {
    type: 'event:meeting.scheduled',
    description: 'A new booking row was inserted (any status).',
    variables: ['meeting.*', 'trigger.fired_at'],
  },
  {
    type: 'event:meeting.confirmed',
    description: 'A booking transitioned to confirmed.',
    variables: ['meeting.*', 'trigger.fired_at'],
  },
  {
    type: 'event:meeting.cancelled',
    description: 'A booking was cancelled.',
    variables: ['meeting.*', 'trigger.fired_at'],
  },
  {
    type: 'event:meeting.rescheduled',
    description: 'A booking start_at changed. Payload includes rescheduled_from and rescheduled_to.',
    variables: ['meeting.*', 'meeting.rescheduled_from', 'meeting.rescheduled_to', 'trigger.fired_at'],
  },
  {
    type: 'event:meeting.no_show',
    description: 'A booking was marked no_show.',
    variables: ['meeting.*', 'trigger.fired_at'],
  },
  {
    type: 'event:meeting.completed',
    description: 'A booking transitioned to completed.',
    variables: ['meeting.*', 'trigger.fired_at'],
  },
  {
    type: 'event:meeting.starts_in',
    description:
      'Time-based: fires N units before a booking start_at. Configure offset (e.g. "-5m", "-1h", "-24h").',
    variables: ['meeting.*', 'trigger.fired_at', 'trigger.offset_minutes'],
    config_schema: {
      type: 'object',
      properties: { offset: { type: 'string', pattern: '^-?\\d+[smhd]$' } },
      required: ['offset'],
    },
  },
  {
    type: 'event:meeting.ended',
    description: 'Time-based: fires when a booking end_at passes.',
    variables: ['meeting.*', 'trigger.fired_at'],
  },

  // ─── Pipeline events (SEED-036). Emitted by lib/pipeline/events.ts when
  // the user (or another workflow) mutates an opportunity.
  {
    type: 'event:opportunity.created',
    description: 'A new opportunity was inserted into the pipeline.',
    variables: ['opportunity.*', 'contact.*', 'stage.*', 'pipeline.*', 'trigger.fired_at'],
  },
  {
    type: 'event:opportunity.stage_changed',
    description:
      'An opportunity was moved between stages (excludes won/lost | those have their own events).',
    variables: ['opportunity.*', 'contact.*', 'stage.from.*', 'stage.to.*', 'pipeline.*', 'trigger.fired_at'],
  },
  {
    type: 'event:opportunity.won',
    description: 'An opportunity was moved to a stage flagged is_won.',
    variables: ['opportunity.*', 'contact.*', 'stage.*', 'pipeline.*', 'trigger.fired_at'],
  },
  {
    type: 'event:opportunity.lost',
    description: 'An opportunity was moved to a stage flagged is_lost.',
    variables: ['opportunity.*', 'contact.*', 'stage.*', 'pipeline.*', 'trigger.fired_at'],
  },
  {
    type: 'event:opportunity.updated',
    description: 'An opportunity field was edited. Payload includes a changes object with {from, to} per field.',
    variables: ['opportunity.*', 'contact.*', 'changes.*', 'trigger.fired_at'],
  },
  {
    type: 'event:opportunity.assigned',
    description: 'The assigned_to user on an opportunity changed.',
    variables: ['opportunity.*', 'contact.*', 'changes.*', 'trigger.fired_at'],
  },
  {
    type: 'event:opportunity.value_changed',
    description: 'The value of an opportunity changed.',
    variables: ['opportunity.*', 'contact.*', 'changes.*', 'trigger.fired_at'],
  },

  // ─── Pipeline time-based events (SEED-036). Emitted by the calendar
  // tick cron (src/app/api/cron/calendar-tick/route.ts).
  {
    type: 'event:opportunity.aged_in_stage',
    description:
      'Time-based: an open opportunity has spent N days in its current stage. Configure via trigger_config.days (and optional stage_id).',
    variables: ['opportunity.*', 'contact.*', 'stage.*', 'pipeline.*', 'trigger.fired_at'],
  },
  {
    type: 'event:opportunity.no_activity',
    description:
      'Time-based: no activities (notes, calls, messages, etc.) have been recorded on the opportunity for N days. Configure via trigger_config.days.',
    variables: ['opportunity.*', 'contact.*', 'stage.*', 'pipeline.*', 'trigger.fired_at'],
  },
  {
    type: 'event:opportunity.close_date_approaching',
    description:
      'Time-based: expected_close_date is N days away. Configure via trigger_config.days_before.',
    variables: ['opportunity.*', 'contact.*', 'stage.*', 'pipeline.*', 'trigger.fired_at'],
  },
  {
    type: 'event:opportunity.close_date_passed',
    description:
      'Time-based: expected_close_date has passed and the opportunity is still open.',
    variables: ['opportunity.*', 'contact.*', 'stage.*', 'pipeline.*', 'trigger.fired_at'],
  },
  {
    type: 'event:opportunity.stale',
    description:
      'Time-based: opportunity updated_at has not changed for N days. Configure via trigger_config.days.',
    variables: ['opportunity.*', 'contact.*', 'stage.*', 'pipeline.*', 'trigger.fired_at'],
  },

  // ─── Inbound phone-number events (phone-numbers project Phase 3).
  // Emitted by src/lib/twilio/events.ts after process-sms upserts a
  // conversation or the voice route logs an incoming call.
  // Optional trigger_config.phone_number_id restricts the workflow to a
  // specific number; if omitted the trigger fires for every number in the org.
  {
    type: 'event:inbound_sms_to_number',
    description:
      'An inbound SMS arrived on a configured Twilio number. Variables expose the ' +
      'phone, the resolved contact (if any), and trigger metadata.',
    variables: ['phone.*', 'contact.*', 'trigger.fired_at'],
    config_schema: {
      type: 'object',
      properties: {
        phone_number_id: {
          type: 'string',
          description: 'Optional twilio_phone_numbers.id. If set, only fires for that number.',
        },
      },
    },
  },
  {
    type: 'event:inbound_call_to_number',
    description:
      'An inbound call arrived on a configured Twilio number. Variables expose the ' +
      'phone, the resolved contact (if any), and trigger metadata.',
    variables: ['phone.*', 'contact.*', 'trigger.fired_at'],
    config_schema: {
      type: 'object',
      properties: {
        phone_number_id: {
          type: 'string',
          description: 'Optional twilio_phone_numbers.id. If set, only fires for that number.',
        },
      },
    },
  },

  // ─── Vapi AI call events. Emitted by src/lib/vapi/events.ts from the
  // end-of-call webhook, only when the `calls` insert actually won (so a Vapi
  // retry can't re-fire the workflow). Works for Vapi-native numbers with no
  // Twilio account attached — phone.* is populated whenever the number was
  // imported locally.
  {
    type: 'event:vapi.call.ended',
    description:
      'A Vapi AI call ended. Variables expose the call (outcome, transcript summary, ' +
      'recording), the number it landed on, and the resolved contact (if any).',
    variables: ['call.*', 'phone.*', 'contact.*', 'trigger.fired_at'],
    config_schema: {
      type: 'object',
      properties: {
        phone_number_id: {
          type: 'string',
          description: 'Optional twilio_phone_numbers.id. If set, only fires for that number.',
        },
      },
    },
  },

  // ─── Social comment events (Zernio). Emitted by lib/zernio/events.ts after
  // processCommentReceived stores the comment and runs any agent reply.
  {
    type: 'event:comment.received',
    description:
      'A comment was received on an Instagram or Facebook post managed via Zernio. ' +
      'Exposes comment text, author info, and post identifiers.',
    variables: [
      'comment.platform', 'comment.post_id', 'comment.comment_id',
      'comment.text', 'comment.author_id', 'comment.author_name',
      'comment.author_username', 'comment.is_reply', 'comment.is_ad_comment',
      'comment.conversation_id', 'comment.contact_id',
      'contact.*', 'trigger.fired_at',
    ],
  },

  // ─── Analytics events (Analytics module). Tenant-scoped only — emitted by the
  // ingest pipeline when a visitor or session event matches a conversion or
  // behavioral condition. NOT available in Superadmin Analytics scope.
  {
    type: 'event:analytics.pageview',
    description: 'A visitor viewed a page on the tenant website. Includes URL, path, session, and UTM data.',
    variables: ['analytics.session.*', 'analytics.visitor.*', 'analytics.pageview.*', 'trigger.fired_at'],
    config_schema: {
      type: 'object',
      properties: {
        path_contains: { type: 'string', description: 'Optional: only fire if path contains this substring.' },
      },
    },
  },
  {
    type: 'event:analytics.conversion',
    description: 'A visitor triggered a conversion event (form_submit, call_started, booking_completed, etc.).',
    variables: ['analytics.session.*', 'analytics.visitor.*', 'analytics.event.*', 'trigger.fired_at'],
    config_schema: {
      type: 'object',
      properties: {
        event_type: {
          type: 'string',
          enum: ['form_submit', 'phone_click', 'sms_click', 'call_started', 'chat_started', 'booking_started', 'booking_completed', 'contact_created', 'opportunity_created', 'deal_won', 'custom_conversion'],
          description: 'Optional: filter to a specific conversion event type.',
        },
      },
    },
  },
  {
    type: 'event:analytics.session_started',
    description: 'A new website session started. Includes UTM attribution and device info.',
    variables: ['analytics.session.*', 'analytics.visitor.*', 'trigger.fired_at'],
    config_schema: {
      type: 'object',
      properties: {
        utm_source: { type: 'string', description: 'Optional: only fire if utm_source matches.' },
        utm_campaign: { type: 'string', description: 'Optional: only fire if utm_campaign matches.' },
      },
    },
  },
]

// ─── Node types ───────────────────────────────────────────────────────────────

export interface NodeSpec {
  type: string
  kind: 'action' | 'condition' | 'wait' | 'agent' | 'end'
  description: string
  integration_required?: string[]             // matches integrations.provider
  params_schema?: Record<string, unknown>     // JSONSchema for node.data.config
  examples?: Array<Record<string, unknown>>
}

export const NODES: NodeSpec[] = [
  // ─── Action | booking (Xkedule)
  {
    type: 'xkedule_get_services',
    kind: 'action',
    description: "List the Xkedule tenant's bookable services with starting prices and staff.",
    integration_required: ['xkedule'],
    params_schema: { type: 'object', properties: {} },
    examples: [{}],
  },
  {
    type: 'xkedule_check_availability',
    kind: 'action',
    description:
      'Check open time slots in Xkedule. Pass `date` for one day, or `startDate`+`endDate` to scan a range and get the next available opening. Duration is derived from the services. Set `includeStaff` to learn who can take each slot (single date only).',
    integration_required: ['xkedule'],
    params_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD — a single day' },
        startDate: { type: 'string', description: 'YYYY-MM-DD — start of a range scan (use with endDate, instead of date)' },
        endDate: { type: 'string', description: 'YYYY-MM-DD — end of a range scan (use with startDate, instead of date)' },
        serviceIds: { type: 'string', description: 'Comma-separated service ids (or a single id)' },
        staffId: { type: 'number', description: 'Optional staff member id' },
        includeStaff: { type: 'boolean', description: 'Return which staff member can take each slot. Single date only; ignored when staffId is set.' },
      },
      required: ['serviceIds'],
    },
    examples: [
      { date: '2026-06-20', serviceIds: '5' },
      { startDate: '2026-06-20', endDate: '2026-06-27', serviceIds: '5' },
      { date: '2026-06-20', serviceIds: '5', includeStaff: true },
    ],
  },
  {
    type: 'xkedule_create_booking',
    kind: 'action',
    description: 'Request a booking in Xkedule after customer confirmation. Without confirmed:true this only returns a read-back. Voice also requires the server-issued confirmationToken and a later affirmative customer turn. The returned status may be pending business approval.',
    integration_required: ['xkedule'],
    params_schema: {
      type: 'object',
      properties: {
        serviceIds: { type: 'string', description: 'Comma-separated service ids (or a single id)' },
        bookingDate: { type: 'string', description: 'YYYY-MM-DD' },
        startTime: { type: 'string', description: 'HH:MM' },
        staffMemberId: { type: 'number', description: 'Optional staff member id' },
        customerName: { type: 'string' },
        customerPhone: { type: 'string' },
        customerEmail: { type: 'string' },
        customerAddress: { type: 'string' },
        confirmed: { type: 'boolean', description: 'True only after the customer confirms the full read-back.' },
        confirmationToken: { type: 'string', description: 'Voice only: copy the token from the previous unconfirmed booking response, with unchanged details.' },
        notes: { type: 'string', description: "What the customer asked for in their own words, e.g. 'short on the sides'." },
      },
      required: ['serviceIds', 'bookingDate', 'startTime', 'customerName', 'customerPhone'],
    },
    examples: [
      { serviceIds: '5', bookingDate: '2026-06-20', startTime: '14:00', customerName: 'Maria', customerPhone: '+551199999999' },
    ],
  },
  {
    type: 'xkedule_cancel_booking',
    kind: 'action',
    description: 'Cancel an existing Xkedule booking by id. Idempotent — cancelling an already-cancelled booking just returns its current state.',
    integration_required: ['xkedule'],
    params_schema: {
      type: 'object',
      properties: {
        bookingId: { type: 'number', description: 'The Xkedule booking id to cancel.' },
      },
      required: ['bookingId'],
    },
    examples: [{ bookingId: 1042 }],
  },
  {
    type: 'xkedule_reschedule_booking',
    kind: 'action',
    description: 'Move an existing Xkedule booking to a new date/time (and optionally a different staff member). Xkedule re-validates the slot and rejects a cancelled/completed booking.',
    integration_required: ['xkedule'],
    params_schema: {
      type: 'object',
      properties: {
        bookingId: { type: 'number', description: 'The Xkedule booking id to reschedule.' },
        bookingDate: { type: 'string', description: 'YYYY-MM-DD' },
        startTime: { type: 'string', description: 'HH:MM' },
        staffMemberId: { type: 'number', description: 'Optional: reassign to a different staff member.' },
      },
      required: ['bookingId', 'bookingDate', 'startTime'],
    },
    examples: [{ bookingId: 1042, bookingDate: '2026-06-21', startTime: '15:00' }],
  },
  {
    type: 'xkedule_quote',
    kind: 'action',
    description: 'Price a cart of Xkedule services WITHOUT creating a booking, so the agent can quote a real total before asking the customer to confirm.',
    integration_required: ['xkedule'],
    params_schema: {
      type: 'object',
      properties: {
        serviceIds: { type: 'string', description: 'Comma-separated service ids (or a single id)' },
      },
      required: ['serviceIds'],
    },
    examples: [{ serviceIds: '5,7' }],
  },
  {
    type: 'xkedule_business_info',
    kind: 'action',
    description:
      "Read the business's opening hours, address, timezone, service area and booking policies (cancellation, no-show, late arrival, deposit) from Xkedule. Use it instead of guessing — unpublished policies come back marked as such.",
    integration_required: ['xkedule'],
    params_schema: { type: 'object', properties: {} },
    examples: [{}],
  },
  {
    type: 'xkedule_lookup_customer',
    kind: 'action',
    description: 'Resolve a phone number to the matching Xkedule customer and their upcoming bookings, so the agent can recognize a returning caller.',
    integration_required: ['xkedule'],
    params_schema: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: 'Customer phone number.' },
      },
      required: ['phone'],
    },
    examples: [{ phone: '+15551234567' }],
  },
  // ─── Action | commerce (Medusa)
  {
    type: 'medusa_search_products',
    kind: 'action',
    description: 'Search the connected Medusa store for products (region-correct prices).',
    integration_required: ['medusa'],
    params_schema: { type: 'object', properties: { query: { type: 'string' }, category: { type: 'string' } } },
    examples: [{ query: 'sweatshirt' }],
  },
  {
    type: 'medusa_get_product',
    kind: 'action',
    description: 'Get one store product by id or handle.',
    integration_required: ['medusa'],
    params_schema: { type: 'object', properties: { product_id: { type: 'string' }, handle: { type: 'string' } } },
    examples: [{ handle: 'sweatshirt' }],
  },
  {
    type: 'medusa_get_cart',
    kind: 'action',
    description: "Show the visitor's current cart. No parameters — the cart is pinned to the conversation.",
    integration_required: ['medusa'],
    params_schema: { type: 'object', properties: {} },
    examples: [{}],
  },
  {
    type: 'medusa_add_to_cart',
    kind: 'action',
    description: "Add a product to the visitor's cart (creates the cart if none). Quantity clamped 1-10.",
    integration_required: ['medusa'],
    params_schema: {
      type: 'object',
      properties: {
        product_id: { type: 'string' },
        variant_id: { type: 'string' },
        quantity: { type: 'number' },
      },
    },
    examples: [{ product_id: 'prod_123', quantity: 1 }],
  },
  {
    type: 'medusa_update_cart_item',
    kind: 'action',
    description: "Change an item's quantity in the visitor's cart, or remove it (quantity 0).",
    integration_required: ['medusa'],
    params_schema: {
      type: 'object',
      properties: {
        item_title_or_variant: { type: 'string' },
        quantity: { type: 'number' },
      },
    },
    examples: [{ item_title_or_variant: 'Sweatshirt', quantity: 2 }],
  },
  {
    type: 'medusa_wishlist_add',
    kind: 'action',
    description: "Save a product to the visitor's wishlist (owner bound to the conversation).",
    integration_required: ['medusa'],
    params_schema: { type: 'object', properties: { product_id: { type: 'string' }, variant_id: { type: 'string' } } },
    examples: [{ product_id: 'prod_123' }],
  },
  {
    type: 'medusa_wishlist_remove',
    kind: 'action',
    description: "Remove a product from the visitor's wishlist.",
    integration_required: ['medusa'],
    params_schema: { type: 'object', properties: { product_id: { type: 'string' }, variant_id: { type: 'string' } } },
    examples: [{ product_id: 'prod_123' }],
  },
  {
    type: 'medusa_wishlist_list',
    kind: 'action',
    description: "List the visitor's wishlist. No parameters — the wishlist is pinned to the conversation.",
    integration_required: ['medusa'],
    params_schema: { type: 'object', properties: {} },
    examples: [{}],
  },
  {
    type: 'medusa_get_order_status',
    kind: 'action',
    description: "Get the status of the visitor's order. Logged-in customers only — the customer is pinned to the conversation.",
    integration_required: ['medusa'],
    params_schema: { type: 'object', properties: { display_id: { type: 'number', description: 'Optional order number' } } },
    examples: [{}],
  },
  // ─── Action | messaging
  {
    type: 'send_sms',
    kind: 'action',
    description: 'Send an SMS via a connected SMS integration (Twilio or GoHighLevel).',
    integration_required: ['twilio', 'gohighlevel'],
    params_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient phone (E.164 or {{variable}})' },
        body: { type: 'string', description: 'Message body, supports {{variables}}' },
        phone_number_id: {
          type: 'string',
          description:
            'Optional twilio_phone_numbers.id to send from. Overrides the org default. ' +
            'Use {{phone.id}} inside inbound-to-number workflows to reply from the same number.',
        },
      },
      required: ['to', 'body'],
    },
    examples: [
      { to: '{{contact.phone}}', body: 'Your appointment is in 5 min: {{meeting.link}}' },
      { to: '{{contact.phone}}', body: 'Thanks for texting.', phone_number_id: '{{phone.id}}' },
    ],
  },
  {
    type: 'send_whatsapp_message',
    kind: 'action',
    description: 'Send a WhatsApp message via Evolution.',
    integration_required: ['evolution'],
    params_schema: {
      type: 'object',
      properties: {
        to: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['to', 'body'],
    },
  },
  {
    type: 'send_whatsapp_template',
    kind: 'action',
    description: 'Send a Meta-approved WhatsApp template via the official Cloud API. Used for compliant outbound (mandatory outside the 24h customer service window).',
    integration_required: ['whatsapp_cloud'],
    params_schema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Recipient phone in E.164 format (with or without leading +)',
        },
        template_id: {
          type: 'string',
          description: 'UUID of the row in whatsapp_templates (must be APPROVED)',
        },
        body_values: {
          type: 'array',
          items: { type: 'string' },
          description: 'Values for body {{1}}, {{2}}, ... placeholders (in order)',
        },
        header_values: {
          type: 'array',
          items: { type: 'string' },
          description: 'Values for header placeholders (in order)',
        },
      },
      required: ['to', 'template_id'],
    },
  },
  {
    type: 'manychat_send_message',
    kind: 'action',
    description: 'Send a ManyChat message to a subscriber.',
    integration_required: ['manychat'],
    params_schema: {
      type: 'object',
      properties: {
        subscriber_id: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['subscriber_id', 'message'],
    },
  },
  {
    type: 'send_telegram_notification',
    kind: 'action',
    description: 'Send a Telegram message to a group, channel, or DM (supports HTML).',
    integration_required: ['telegram'],
    params_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Message content; supports HTML when parse_mode=HTML.' },
        chat_id: { type: 'string', description: 'Override target chat ID. Falls back to the bot\'s configured notification_chat_ids.' },
        parse_mode: { type: 'string', enum: ['HTML', 'Markdown', 'plain'], description: 'Default HTML.' },
        disable_notification: { type: 'boolean' },
      },
      required: ['text'],
    },
    examples: [
      { text: '🆕 <b>Novo lead</b>\n{{contact.name}} | {{contact.phone}}', parse_mode: 'HTML' },
    ],
  },

  // ─── Action | Xphere
  {
    type: 'create_contact',
    kind: 'action',
    description: 'Create a contact in GoHighLevel.',
    integration_required: ['gohighlevel'],
    params_schema: {
      type: 'object',
      properties: {
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
      },
    },
  },
  {
    type: 'contact_create',
    kind: 'action',
    description:
      "Create or update a contact in Xphere's own CRM. Deduplicates by phone, then email. " +
      'Emits contact.created on a real insert. Needs no integration — use this instead of ' +
      'create_contact when the org has no external CRM connected.',
    params_schema: {
      type: 'object',
      properties: {
        name:       { type: 'string', description: 'Full name. Falls back to first_name + last_name.' },
        first_name: { type: 'string' },
        last_name:  { type: 'string' },
        phone:      { type: 'string', description: 'Any format; normalized to E.164' },
        email:      { type: 'string' },
        company:    { type: 'string' },
        notes:      { type: 'string', description: 'Appended to existing notes on a known contact' },
        country:    { type: 'string', description: 'ISO 3166-1 alpha-2 hint for parsing a national-format phone' },
        source: {
          type: 'string',
          enum: [
            'manual', 'whatsapp', 'sms', 'instagram', 'facebook',
            'messenger', 'csv_import', 'ghl_sync', 'api', 'voice_call',
          ],
          description: "Origin channel. Use 'voice_call' when captured during a phone call. Defaults to 'manual'.",
        },
      },
    },
    examples: [
      { name: '{{input.name}}', phone: '{{input.phone}}', notes: '{{input.reason}}', source: 'voice_call' },
    ],
  },
  {
    type: 'google_contacts_create',
    kind: 'action',
    description: 'Create a contact in the connected Google account.',
    integration_required: ['google_contacts'],
    params_schema: {
      type: 'object',
      properties: {
        name:    { type: 'string', description: 'Full name (e.g. "João Silva")' },
        email:   { type: 'string', description: 'Email address' },
        phone:   { type: 'string', description: 'Phone number' },
        company: { type: 'string', description: 'Company / organization name' },
        notes:   { type: 'string', description: 'Free-text notes / biography' },
      },
    },
  },
  {
    type: 'google_contacts_update',
    kind: 'action',
    description: 'Update an existing Google contact located by email.',
    integration_required: ['google_contacts'],
    params_schema: {
      type: 'object',
      required: ['email'],
      properties: {
        email:   { type: 'string', description: 'Email used to find the contact (required)' },
        name:    { type: 'string', description: 'New full name' },
        phone:   { type: 'string', description: 'New phone number' },
        company: { type: 'string', description: 'New company / organization name' },
        notes:   { type: 'string', description: 'New free-text notes' },
      },
    },
  },
  {
    type: 'google_contacts_find',
    kind: 'action',
    description: 'Search a Google contact by email or phone. Returns name, email and phone of the first match.',
    integration_required: ['google_contacts'],
    params_schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Email to search for' },
        phone: { type: 'string', description: 'Phone to search for (used when email is absent)' },
      },
    },
  },
  {
    type: 'google_contacts_delete',
    kind: 'action',
    description: 'Delete a Google contact located by email.',
    integration_required: ['google_contacts'],
    params_schema: {
      type: 'object',
      required: ['email'],
      properties: {
        email: { type: 'string', description: 'Email used to find and delete the contact' },
      },
    },
  },

  // ─── Action | platform tasks & notes
  {
    type: 'create_task',
    kind: 'action',
    description: 'Creates a task in Xphere. Tasks can be linked to a contact, account, or opportunity.',
    params_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        due_date: { type: 'string', description: 'ISO timestamp' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        entity_type: { type: 'string', enum: ['contact', 'account', 'opportunity'] },
        entity_id: { type: 'string' },
      },
      required: ['title'],
    },
  },
  {
    type: 'create_note',
    kind: 'action',
    description: 'Creates a note in Xphere. Notes can be linked to a contact, account, or opportunity.',
    params_schema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        title: { type: 'string' },
        pinned: { type: 'boolean' },
        entity_type: { type: 'string', enum: ['contact', 'account', 'opportunity'] },
        entity_id: { type: 'string' },
      },
      required: ['content'],
    },
  },

  // ─── Action | knowledge
  {
    type: 'knowledge_base',
    kind: 'action',
    description: 'Query the org knowledge base; returns a string answer suitable for chat replies.',
    params_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },

  // ─── Action | Zernio (Instagram / Facebook DMs)
  {
    type: 'send_zernio_dm',
    kind: 'action',
    description:
      'Send a private Instagram or Facebook DM to the author of a comment. ' +
      'Use in flows triggered by event:comment.received. ' +
      'Pass {{comment.conversation_id}} as conversation_id to address the commenter automatically.',
    integration_required: ['zernio'],
    params_schema: {
      type: 'object',
      properties: {
        conversation_id: {
          type: 'string',
          description: 'Xphere conversation ID for the comment (use {{comment.conversation_id}}).',
        },
        message: {
          type: 'string',
          description: 'Text to send as a private DM. Supports {{variables}}.',
        },
      },
      required: ['conversation_id', 'message'],
    },
    examples: [
      {
        conversation_id: '{{comment.conversation_id}}',
        message: 'Oi {{comment.author_name}}, obrigado pelo comentário! Veja nossa oferta em: ...',
      },
    ],
  },

  // ─── Action | webhook escape hatch
  {
    type: 'custom_webhook',
    kind: 'action',
    description: 'Send a configurable HTTP request to an external URL.',
    integration_required: ['custom_webhook'],
    params_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', format: 'uri' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] },
        headers: { type: 'object' },
        body: {},
      },
    },
  },

  // ─── Action | pipeline (SEED-036). Built-in nodes; no integration required.
  {
    type: 'pipeline_move_opportunity',
    kind: 'action',
    description: 'Move an opportunity to a different stage. Resolves stage by id or by name (case-insensitive).',
    params_schema: {
      type: 'object',
      properties: {
        opportunity_id: { type: 'string' },
        stage_id: { type: 'string', description: 'Target stage UUID. Either this or stage_name is required.' },
        stage_name: { type: 'string', description: 'Target stage name; resolved within the opportunity\'s pipeline.' },
      },
      required: ['opportunity_id'],
    },
    examples: [
      { opportunity_id: '{{opportunity.id}}', stage_name: 'Onboarding' },
    ],
  },
  {
    type: 'pipeline_update_opportunity',
    kind: 'action',
    description: 'Update one or more fields on an opportunity.',
    params_schema: {
      type: 'object',
      properties: {
        opportunity_id: { type: 'string' },
        title: { type: 'string' },
        value: { type: 'number' },
        expected_close_date: { type: 'string', description: 'ISO date (YYYY-MM-DD).' },
        assigned_to: { type: 'string', description: 'User UUID.' },
        status: { type: 'string', enum: ['open', 'won', 'lost'] },
      },
      required: ['opportunity_id'],
    },
  },
  {
    type: 'pipeline_mark_won',
    kind: 'action',
    description: 'Move the opportunity to the first stage flagged is_won in its pipeline.',
    params_schema: {
      type: 'object',
      properties: { opportunity_id: { type: 'string' } },
      required: ['opportunity_id'],
    },
  },
  {
    type: 'pipeline_mark_lost',
    kind: 'action',
    description: 'Move the opportunity to the first stage flagged is_lost; optional reason note.',
    params_schema: {
      type: 'object',
      properties: {
        opportunity_id: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['opportunity_id'],
    },
  },
  {
    type: 'pipeline_add_note',
    kind: 'action',
    description: 'Append a note to the opportunity activity feed.',
    params_schema: {
      type: 'object',
      properties: {
        opportunity_id: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['opportunity_id', 'content'],
    },
  },
  {
    type: 'pipeline_assign_user',
    kind: 'action',
    description: 'Set the assigned_to user on an opportunity.',
    params_schema: {
      type: 'object',
      properties: {
        opportunity_id: { type: 'string' },
        user_id: { type: 'string' },
      },
      required: ['opportunity_id', 'user_id'],
    },
  },
  {
    type: 'pipeline_create_opportunity',
    kind: 'action',
    description:
      'Create a new opportunity. Defaults to the org default pipeline and the first stage when not specified. ' +
      'contact_id is optional; contact_phone triggers a lookup if contact_id is not known.',
    params_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        pipeline_id: { type: 'string' },
        stage_id: { type: 'string' },
        stage_name: { type: 'string' },
        contact_id: { type: 'string' },
        contact_phone: { type: 'string', description: 'E.164 phone; if matched in contacts, links the opportunity.' },
        value: { type: 'number' },
        assigned_to: { type: 'string' },
      },
      required: ['title'],
    },
  },

  // ─── Action | booking status
  {
    type: 'update_booking_status',
    kind: 'action',
    description: 'Update the status of a booking. Use after service completion to mark a booking as showed.',
    params_schema: {
      type: 'object',
      properties: {
        booking_id: { type: 'string', description: 'Booking UUID (use {{meeting.id}}).' },
        status: {
          type: 'string',
          enum: ['confirmed', 'cancelled', 'no_show', 'showed'],
          description: 'New booking status.',
        },
      },
      required: ['booking_id', 'status'],
    },
    examples: [
      { booking_id: '{{meeting.id}}', status: 'showed' },
    ],
  },

  // ─── Action | contact
  {
    type: 'update_contact',
    kind: 'action',
    description: 'Update fields on an existing contact. Resolves contact by contact_id or contact_phone.',
    params_schema: {
      type: 'object',
      properties: {
        contact_id: { type: 'string', description: 'Contact UUID. Either this or contact_phone is required.' },
        contact_phone: { type: 'string', description: 'E.164 phone to look up the contact.' },
        lifecycle_stage: {
          type: 'string',
          enum: ['prospect', 'lead', 'opportunity', 'customer', 'lost', 'archived'],
          description: 'CRM lifecycle stage.',
        },
        name: { type: 'string' },
        email: { type: 'string' },
        company: { type: 'string' },
        notes: { type: 'string' },
        assigned_to: { type: 'string', description: 'User UUID to assign this contact to.' },
      },
    },
    examples: [
      { contact_phone: '{{meeting.attendee_contact.phone}}', lifecycle_stage: 'customer' },
    ],
  },

  {
    type: 'contact_add_tag',
    kind: 'action',
    description: 'Add a tag to a contact by name. Creates the tag if it does not exist (idempotent).',
    params_schema: {
      type: 'object',
      properties: {
        contact_id: { type: 'string', description: 'Contact UUID. Either this or contact_phone is required.' },
        contact_phone: { type: 'string', description: 'E.164 phone to look up the contact.' },
        tag_name: { type: 'string', description: 'Tag name to add (e.g. "customer").' },
      },
      required: ['tag_name'],
    },
    examples: [
      { contact_id: '{{meeting.attendee_contact.id}}', tag_name: 'customer' },
    ],
  },

  // ─── Action | email
  {
    type: 'send_email',
    kind: 'action',
    description: 'Send a transactional email using the platform Resend settings.',
    params_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address.' },
        subject: { type: 'string' },
        body: { type: 'string', description: 'HTML email body.' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    type: 'send_tenant_email',
    kind: 'action',
    description: "Send a transactional email using the org's own Resend integration (from the org's configured sender address).",
    params_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address. Skipped silently if empty.' },
        subject: { type: 'string' },
        body: { type: 'string', description: 'HTML email body. Also accepted as "html".' },
        reply_to: { type: 'string', description: 'Reply-to address.' },
        kind: { type: 'string', enum: ['transactional', 'marketing'], description: 'Default: transactional.' },
      },
      required: ['to', 'subject', 'body'],
    },
    examples: [
      { to: '{{meeting.attendee_contact.email}}', subject: 'Your appointment is confirmed', body: '<p>Hi {{meeting.attendee_contact.first_name}}, ...</p>' },
    ],
  },
  {
    type: 'send_email_template',
    kind: 'action',
    description:
      'Send a builder email template (from Email Templates) to a recipient, with ' +
      'merge-tag personalization. Loads the template html_snapshot/plain_text_snapshot, fills ' +
      '{{variables}} from the provided variables object, and sends via the org\'s tenant Resend ' +
      "integration (sendTenantEmail) — honouring the unsubscribe suppression list and, for " +
      "kind:'marketing' (the default), adding the compliance footer and List-Unsubscribe headers. " +
      'Subject is optional: it falls back to the template\'s own subject line (set in the builder\'s ' +
      'Document inspector) when omitted — the send only fails if neither is set. ' +
      'The template must be published unless allow_draft is set.',
    // Org-gated: only appears in the spec when the org has Resend/email connected.
    integration_required: ['resend'],
    params_schema: {
      type: 'object',
      properties: {
        template_id: {
          type: 'string',
          description: 'UUID of the email_templates row to send (must have an html_snapshot).',
        },
        to: { type: 'string', description: 'Recipient email address.' },
        subject: {
          type: 'string',
          description:
            'Optional. Subject line; supports {{variables}}. Falls back to the template\'s own subject line ' +
            '(set in the builder\'s Document inspector) when omitted — the send fails only if neither is set.',
        },
        variables: {
          type: 'object',
          description: 'Merge-tag values, e.g. { "contact": { "first_name": "Ana" } }. Fills {{contact.first_name}} etc.',
        },
        kind: {
          type: 'string',
          enum: ['marketing', 'transactional'],
          description:
            "Default: 'marketing' (suppression list honoured, compliance footer + one-click unsubscribe added). " +
            "Pass 'transactional' as an explicit escape hatch for non-marketing sends (receipts, confirmations).",
        },
        allow_draft: {
          type: 'boolean',
          description: 'Send an unpublished (draft) template. Default false — unpublished templates are rejected.',
        },
      },
      required: ['template_id', 'to'],
    },
    examples: [
      {
        template_id: '00000000-0000-0000-0000-000000000000',
        to: '{{contact.email}}',
        subject: 'Welcome, {{contact.first_name}}!',
        variables: { contact: { first_name: '{{contact.first_name}}', email: '{{contact.email}}' } },
      },
    ],
  },

  // ─── Control flow
  {
    type: 'condition',
    kind: 'condition',
    description: 'Branch on a boolean expression. Use to gate downstream nodes.',
    params_schema: {
      type: 'object',
      properties: { expression: { type: 'string' } },
      required: ['expression'],
    },
  },
  {
    type: 'wait',
    kind: 'wait',
    description:
      'Pause execution for a duration ("5m", "1h", "24h") or until a future timestamp variable.',
    params_schema: {
      type: 'object',
      properties: {
        duration: { type: 'string' },
        until: { type: 'string', description: 'ISO datetime or {{variable}}' },
      },
    },
  },
  {
    type: 'end',
    kind: 'end',
    description: 'Terminal node. Marks a branch as completed successfully.',
  },
]

// ─── Variable namespaces ──────────────────────────────────────────────────────

export const VARIABLE_NAMESPACES = {
  trigger: 'Fields populated by the trigger that started this run.',
  input: 'Free-form payload passed to the trigger (tool-call args, webhook body, etc.).',
  contact: 'Contact fields when the trigger has a linked contact.',
  meeting: 'Booking fields when the trigger is a calendar event (SEED-027).',
  opportunity: 'Opportunity fields when the trigger is a pipeline event (SEED-036).',
  stage: 'Pipeline stage fields (with stage.from / stage.to on stage_changed).',
  pipeline: 'Pipeline metadata (id, name) for pipeline events.',
  changes: 'Diff of changed fields ({ from, to } per field) on opportunity.updated/assigned/value_changed.',
  phone:
    'Phone number metadata for inbound SMS/call events. Exposes phone.id, phone.e164, ' +
    'phone.friendly_name, phone.inbox_label, phone.business_purpose.',
  comment:
    'Comment fields for event:comment.received. Includes platform, post_id, comment_id, ' +
    'text, author_id, author_name, author_username, is_reply, is_ad_comment, ' +
    'conversation_id, contact_id.',
  order:
    'Medusa order fields for event:commerce.order.placed. Exposes order_id, display_id, ' +
    'email, currency_code, total, cart_id, items (major-unit money, never cents).',
  customer:
    'Medusa customer fields for event:commerce.customer.created. Exposes customer_id, ' +
    'email, first_name, last_name.',
}

// ─── Spec assembly ────────────────────────────────────────────────────────────

// SEED-033: each org-defined kind='tool'/'flow' workflow callable via
// `tool_call` shows up here so AI surfaces (Copilot, agent runtime) know
// what's available and can satisfy the input contract.
export interface WorkflowToolSpec {
  id: string
  tool_name: string
  name: string
  description: string | null
  kind: 'tool' | 'flow'
  is_active: boolean
  health_blocked: boolean
  input_schema: InputSchemaMap
  output_schema: InputSchemaMap
}

export interface WorkflowSpec {
  version: string
  org_id: string
  available_integrations: string[]
  triggers: TriggerSpec[]
  nodes: NodeSpec[]
  variable_namespaces: typeof VARIABLE_NAMESPACES
  workflows: WorkflowToolSpec[]
}

// Build the org-filtered spec. Nodes are filtered out when their
// `integration_required` lists no available connected integration.
export async function getWorkflowSpec(
  orgId: string,
  supabase: SupabaseClient<Database>,
): Promise<WorkflowSpec> {
  const integrations = await listAvailableIntegrations(orgId, supabase)
  const availableProviders = new Set(integrations.map((i) => i.provider))

  const filteredNodes = NODES.filter((n) => {
    if (!n.integration_required || n.integration_required.length === 0) return true
    return n.integration_required.some((p) => availableProviders.has(p))
  })

  // SEED-033: list org workflows callable by name. Includes both kind='tool'
  // (single-action) and kind='flow' (multi-step). Health-blocked entries are
  // included but flagged so the AI can warn the user.
  const { data: workflowRows } = await supabase
    .from('workflows')
    .select('id, name, tool_name, description, kind, is_active, health_blocked, current_version_id, trigger_type')
    .eq('org_id', orgId)
    .in('kind', ['tool', 'flow'])
    .eq('trigger_type', 'tool_call')

  const versionIds = (workflowRows ?? [])
    .map((w) => w.current_version_id)
    .filter((id): id is string => Boolean(id))

  const definitionsById = new Map<string, unknown>()
  if (versionIds.length > 0) {
    const { data: versions } = await supabase
      .from('workflow_versions')
      .select('id, definition')
      .in('id', versionIds)
    for (const v of versions ?? []) {
      definitionsById.set(v.id as string, v.definition)
    }
  }

  const workflows: WorkflowToolSpec[] = (workflowRows ?? [])
    .filter((w) => Boolean(w.tool_name))
    .map((w) => {
      const def = w.current_version_id
        ? definitionsById.get(w.current_version_id)
        : null
      return {
        id: w.id as string,
        tool_name: w.tool_name as string,
        name: w.name as string,
        description: (w.description as string | null) ?? null,
        kind: w.kind as 'tool' | 'flow',
        is_active: w.is_active as boolean,
        health_blocked: w.health_blocked as boolean,
        input_schema: getWorkflowInputSchema(def),
        output_schema: getWorkflowOutputSchema(def),
      }
    })

  return {
    version: SPEC_VERSION,
    org_id: orgId,
    available_integrations: Array.from(availableProviders).sort(),
    triggers: TRIGGERS,
    nodes: filteredNodes,
    variable_namespaces: VARIABLE_NAMESPACES,
    workflows,
  }
}
