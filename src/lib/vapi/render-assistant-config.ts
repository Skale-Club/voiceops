// Pure renderer for a Vapi assistant's outbound configuration: system
// prompt, function/tool JSON-Schema parameters, and per-tool spoken messages.
//
// This module has zero imports of @supabase/* or fetch/network APIs — given
// the same input twice, it produces byte-identical output.
//
// It does NOT template tenant facts. That already happened once, at install
// time, into agent_prompt_versions (see src/lib/org-templates/prompt-template.ts):
// a business's name and address do not change between two phone calls, so
// freezing them into the stored prompt is correct.
//
// The service location block is the deliberate exception. `service_location_mode`
// is a live organization setting an operator can change in Settings at any
// moment, and Phase 138's locked decision is that no prompt may hardcode
// "ask" or "never ask" for a customer address — the engine renders it. The
// widget path does this in buildWorkflowTools(); this is the same rendering
// for the voice path, applied at push time so a mode change reaches the
// assistant on the next push rather than requiring a prompt edit. That is why
// `serviceLocationMode` is a required field: a caller cannot forget it and
// silently ship a prompt with no location rule at all.
//
// Function parameters are shaped from each workflow's own input_schema, so a
// future field there (e.g. Phase 138's customerAddress) reaches Vapi
// automatically with no change to this file.
//
// Per-tool spoken messages: an assistant that already carries tuned lines
// keeps them. This renderer has no way to know which tools are slow for an
// org it has never measured, and the generic fallback is deliberately bland
// ("One moment."), so overwriting an operator's tuned phrasing with it would
// be a regression every time. Existing messages are passed in by the caller
// (read off the live assistant immediately before the PATCH) and preserved
// verbatim; only a tool with no message of its own gets the fallback.

import type { InputSchemaField, InputSchemaMap } from '@/lib/workflows/derive-input-schema'
import { renderServiceLocationBlock } from '@/lib/agent-runtime/service-location-prompt'

export interface AssistantConfigWorkflow {
  toolName: string
  description: string
  inputSchema: InputSchemaMap
}

/** One Vapi per-tool spoken message, in Vapi's own shape. */
export interface VapiToolMessage {
  type: string
  content: string
  [key: string]: unknown
}

export interface AssistantConfigSource {
  systemPrompt: string
  workflows: AssistantConfigWorkflow[]
  /**
   * The organization's `service_location_mode`. Required: an unrecognised or
   * missing value renders the `on_premises` block, never no block at all.
   */
  serviceLocationMode: unknown
  /** Messages the live assistant already carries, keyed by tool name. */
  existingToolMessages?: Record<string, VapiToolMessage[]>
  /**
   * IANA timezone the call's "today" is expressed in. Resolved by Vapi at
   * call time, so the pushed prompt never goes stale. Invalid/missing → UTC.
   */
  timeZone?: string
  /**
   * The tenant's weekly opening hours, fetched at push time (see
   * sync-assistant-config.ts). Optional: a tenant with no Xkedule
   * integration, or a fetch failure, pushes with this undefined — the
   * renderer then writes a line telling the model it does not know the
   * hours, rather than inventing or omitting the rule entirely (call 4,
   * 2026-09-05: "we're still open today" at 23:17, invented with no clock
   * and no hours in the prompt at all).
   */
  businessHours?: BusinessHours
}

/** One weekday's hours, in the shape the renderer speaks — never Xkedule's own field names. */
export interface BusinessHoursDay {
  open: boolean
  start?: string
  end?: string
}

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
export type Weekday = (typeof WEEKDAYS)[number]

export interface BusinessHours {
  /** IANA timezone the hours themselves are quoted in (informational — the clock line owns "now"). */
  timezone: string
  days: Partial<Record<Weekday, BusinessHoursDay>>
}

export interface RenderedVapiFunction {
  name: string
  description: string
  parameters: { type: 'object'; properties: Record<string, unknown>; required: string[] }
}

export interface RenderedToolMessage {
  toolName: string
  messages: VapiToolMessage[]
}

export interface RenderedAssistantConfig {
  systemPrompt: string
  functions: RenderedVapiFunction[]
  toolMessages: RenderedToolMessage[]
}

const DEFAULT_REQUEST_START = 'One moment.'

/**
 * A business name as it should be SPOKEN. Text-to-speech reads "&" as
 * "ampersand" often enough to matter on a greeting; nothing else in a name
 * is touched, so the tenant still hears its own name.
 */
export function spokenName(name: string): string {
  return name.replace(/\s*&\s*/g, ' and ').replace(/\s{2,}/g, ' ').trim()
}

/**
 * The token a prompt uses to place the service location rule itself. A prompt
 * without it still gets the rule, appended as its own section — a prompt can
 * never end up with no location rule.
 */
export const SERVICE_LOCATION_TOKEN = '{{service_location_block}}'

/** Maps one input_schema field to a JSON-Schema property. No Zod involved. */
function inputSchemaFieldToJsonSchema(field: InputSchemaField): Record<string, unknown> {
  const type = field.type ?? 'string'
  const knownTypes = ['string', 'number', 'integer', 'boolean', 'array', 'object']
  const jsonSchema: Record<string, unknown> = {
    type: knownTypes.includes(type) ? type : 'string',
  }
  if (field.description) jsonSchema.description = field.description
  if (field.enum) jsonSchema.enum = field.enum
  return jsonSchema
}

function renderFunction(workflow: AssistantConfigWorkflow): RenderedVapiFunction {
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const [key, field] of Object.entries(workflow.inputSchema)) {
    properties[key] = inputSchemaFieldToJsonSchema(field)
    if (field.required) required.push(key)
  }

  return {
    name: workflow.toolName,
    description: workflow.description,
    parameters: { type: 'object', properties, required },
  }
}

/**
 * The token a prompt uses to place the opening-hours rule itself. A prompt
 * without it still gets the rule, appended as its own section — like
 * SERVICE_LOCATION_TOKEN, a prompt can never end up with no hours rule.
 */
export const BUSINESS_HOURS_TOKEN = '{{business_hours_block}}'

const NO_HOURS_TEXT =
  'Opening hours: you do not know them. Never state whether the shop is open, closed, or ' +
  'what its hours are from memory or a guess — call business_info if the caller asks, and if ' +
  "that also has nothing, say you'll have the shop confirm."

/** "9 AM", "9:30 AM", "12 PM" — no leading zero, minutes only when not on the hour. */
function formatClockTime(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':')
  const hour24 = Number(hStr)
  const minute = Number(mStr ?? '0')
  if (!Number.isFinite(hour24) || !Number.isFinite(minute)) return hhmm
  const period = hour24 >= 12 ? 'PM' : 'AM'
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  return minute === 0 ? `${hour12} ${period}` : `${hour12}:${String(minute).padStart(2, '0')} ${period}`
}

/** One day's spoken label: an hours range, or "closed". */
function dayHoursLabel(day: BusinessHoursDay | undefined): string {
  if (!day || day.open === false || !day.start || !day.end) return 'closed'
  return `${formatClockTime(day.start)} to ${formatClockTime(day.end)}`
}

const WEEKDAY_LABEL: Record<Weekday, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
}

/** Groups consecutive weekdays sharing the same hours: "Monday to Friday 9 AM to 6 PM". */
function groupBusinessHours(days: Partial<Record<Weekday, BusinessHoursDay>>): string {
  const entries = WEEKDAYS.map((day) => ({ day, label: dayHoursLabel(days[day]) }))
  const groups: { start: Weekday; end: Weekday; label: string }[] = []
  for (const entry of entries) {
    const last = groups[groups.length - 1]
    if (last && last.label === entry.label) {
      last.end = entry.day
    } else {
      groups.push({ start: entry.day, end: entry.day, label: entry.label })
    }
  }
  return groups
    .map((g) => {
      const span = g.start === g.end ? WEEKDAY_LABEL[g.start] : `${WEEKDAY_LABEL[g.start]} to ${WEEKDAY_LABEL[g.end]}`
      return g.label === 'closed' ? `${span} closed` : `${span} ${g.label}`
    })
    .join(', ')
}

/**
 * Renders the "## Opening hours" block. Fails to a stated-unknown line
 * (never a guess) when no hours were resolved at push time.
 */
export function renderBusinessHoursBlock(businessHours: BusinessHours | undefined): string {
  if (!businessHours) return NO_HOURS_TEXT
  const grouped = groupBusinessHours(businessHours.days)
  return (
    `Opening hours: ${grouped}. Whether the shop is open or closed right now comes ONLY from ` +
    "these hours combined with today's date and time — never from memory or a guess. " +
    'Availability for booking comes ONLY from check_availability; the hours never substitute for calling it.'
  )
}

/**
 * Places the engine-rendered service location and opening-hours rules into a
 * prompt: at each token when the prompt declares one, appended as its own
 * section otherwise.
 */
export function renderSystemPrompt(
  template: string,
  serviceLocationMode: unknown,
  timeZone?: string,
  businessHours?: BusinessHours
): string {
  const locationBlock = renderServiceLocationBlock(serviceLocationMode)
  const hoursBlock = renderBusinessHoursBlock(businessHours)

  const withLocation = template.includes(SERVICE_LOCATION_TOKEN)
    ? template.replaceAll(SERVICE_LOCATION_TOKEN, locationBlock)
    : `${template}${template.endsWith('\n') ? '\n' : '\n\n'}## Service location\n${locationBlock}\n`

  const withHours = withLocation.includes(BUSINESS_HOURS_TOKEN)
    ? withLocation.replaceAll(BUSINESS_HOURS_TOKEN, hoursBlock)
    : `${withLocation}${withLocation.endsWith('\n') ? '\n' : '\n\n'}## Opening hours\n${hoursBlock}\n`

  return `${withHours}${withHours.endsWith('\n') ? '\n' : '\n\n'}${todayLineForVapi(timeZone)}\n`
}

/**
 * The widget gets "Today is …" from the runtime on every turn. Voice cannot:
 * the prompt lives inside Vapi between pushes. Vapi's Liquid `date` filter
 * resolves it per call, in the tenant's own timezone — without this the model
 * guessed "the 8th" as October (rehearsal, 2026-09-05).
 *
 * Call 4 (2026-09-05 23:17): the model said "we're still open today" with no
 * clock in the prompt at all — it had a date but no time of day. Now both
 * are resolved by Vapi at call time, from the same two `date` filter calls.
 */
export function todayLineForVapi(timeZone?: string): string {
  const zone = isValidTimeZone(timeZone) ? (timeZone as string) : 'UTC'
  return (
    `Today is {{"now" | date: "%A, %Y-%m-%d", "${zone}"}} and the time is ` +
    `{{"now" | date: "%I:%M %p", "${zone}"}} (${zone}). Resolve every relative day ("tomorrow", ` +
    '"Monday", "the 8th") to a full YYYY-MM-DD date, counting forward from today across month ' +
    'and year boundaries when necessary, before using it.'
  )
}

function isValidTimeZone(tz: unknown): boolean {
  if (typeof tz !== 'string' || !tz.trim()) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/**
 * Renders an assistant's system prompt, function schemas, and per-tool
 * spoken messages from plain data — no network, no Supabase, deterministic.
 */
export function renderAssistantConfig(source: AssistantConfigSource): RenderedAssistantConfig {
  // A live read happened when `existingToolMessages` is present. Then a tool
  // with no message is a deliberate silence (the lookup and the write tools
  // are tuned that way: the caller must not hear "One moment" as the first
  // words, and the prepare call must not promise a booking). The generic
  // fallback only exists for a push with no live read at all.
  const liveRead = source.existingToolMessages !== undefined
  const existing = source.existingToolMessages ?? {}

  return {
    systemPrompt: renderSystemPrompt(
      source.systemPrompt,
      source.serviceLocationMode,
      source.timeZone,
      source.businessHours
    ),
    functions: source.workflows.map(renderFunction),
    toolMessages: source.workflows.map((w) => {
      const kept = existing[w.toolName]
      return {
        toolName: w.toolName,
        messages:
          kept && kept.length > 0
            ? kept
            : liveRead
              ? []
              : [{ type: 'request-start', content: DEFAULT_REQUEST_START }],
      }
    }),
  }
}
