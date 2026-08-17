// src/lib/calendar/emails.ts
// Booker email notifications for the calendar system.
//
// Contract:
//   - Fire-and-forget. Never throws. Callers do not need try/catch.
//   - Tenant-aware: when `orgId` is passed, the email is sent through
//     sendTenantEmail() (src/lib/email/resend.ts) using the org's own
//     connected Resend integration — same multi-tenant model as every other
//     outbound email in the app. Sent with kind: 'transactional' — booking
//     confirmations/cancellations are not marketing, must never be
//     suppressed by the org's unsubscribe list, and never get the marketing
//     compliance footer. source: 'calendar' tags the email_sends row.
//   - Falls back to sendPlatformEmail() (src/lib/email/resend.ts), which
//     reads the platform's own connected Resend integration from
//     platform_email_settings, when `orgId` is omitted, or when the tenant
//     send fails because the org has no connected email integration.
//   - If neither path is configured (no orgId + no platform integration, or
//     a tenant send failure with no platform integration to fall back to),
//     sendPlatformEmail logs a warning and no-ops. Booking flow continues
//     unchanged either way — a booking must never fail because an email
//     could not be sent.
//
// Templates are inline HTML to avoid a template engine dependency. Dark
// theme matches the booking page (#08090A bg, #FAFAFA text, indigo accent).

import { format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { meetingLocationLabel, resolveMeetingLocation } from '@/lib/calendar/location-resolver'
import type { LocationKind } from '@/lib/calendar/location-resolver'
import { sendTenantEmail, sendPlatformEmail, type EmailAttachment } from '@/lib/email/resend'

// Organizer address for the .ics ORGANIZER line when neither `params.hostEmail`
// nor a tenant/platform "from" address is available at generateIcs() call time
// (it runs before the send call, so it can't know which path — or which org's
// from-address — will end up handling the send). Not a real mailbox; RFC 5545
// only requires ORGANIZER to be a syntactically valid mailto: URI, and
// calendar clients display CN (organizerName) rather than this address.
const ICS_ORGANIZER_FALLBACK = 'bookings@xphere.app'

function formatStart(startAt: Date | string, timezone: string): string {
  const start = typeof startAt === 'string' ? new Date(startAt) : startAt
  const zoned = toZonedTime(start, timezone)
  // e.g. "Tuesday, May 19 2026 · 14:30"
  return format(zoned, 'EEEE, MMMM d yyyy · HH:mm')
}

// Format a Date to the iCal DTSTART/DTEND format (UTC): 20260519T143000Z
function toIcalDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

// Escape special chars in iCal property values (RFC 5545 §3.3.11)
function icalEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

// Generate a minimal iCal (.ics) string for a single booking event.
function generateIcs(params: {
  uid: string
  title: string
  startAt: Date | string
  endAt: Date | string
  timezone: string
  description?: string
  location?: string
  url?: string
  organizerEmail: string
  organizerName: string
  attendeeEmail: string
}): string {
  const start = toIcalDate(params.startAt)
  const end = toIcalDate(params.endAt)
  const now = toIcalDate(new Date())
  const locationLine = params.location ? `LOCATION:${icalEscape(params.location)}\r\n` : ''
  const urlLine = params.url ? `URL:${icalEscape(params.url)}\r\n` : ''
  const descLine = params.description
    ? `DESCRIPTION:${icalEscape(params.description)}\r\n`
    : ''

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Xphere Scheduling//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${params.uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${icalEscape(params.title)}`,
    descLine.trimEnd(),
    locationLine.trimEnd(),
    urlLine.trimEnd(),
    `ORGANIZER;CN=${icalEscape(params.organizerName)}:mailto:${params.organizerEmail}`,
    `ATTENDEE;CN=${icalEscape(params.attendeeEmail)};RSVP=TRUE:mailto:${params.attendeeEmail}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter((line) => line !== '')
    .join('\r\n')
}

const BASE_STYLE = `
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background-color: #08090A;
  color: #FAFAFA;
  padding: 32px 24px;
  margin: 0;
  line-height: 1.5;
`
const CARD_STYLE = `
  max-width: 560px;
  margin: 0 auto;
  background-color: #111113;
  border: 1px solid #2A2A2F;
  border-radius: 12px;
  padding: 32px;
`
const MUTED = 'color: #A1A1AA;'
const BUTTON = `
  display: inline-block;
  padding: 12px 24px;
  background-color: #6366F1;
  color: #FFFFFF !important;
  text-decoration: none;
  border-radius: 8px;
  font-weight: 600;
  margin-top: 16px;
`

// ──────────────────────────────────────────────────────────────────────────────
// sendBookingConfirmation | sent after createBooking succeeds.
// ──────────────────────────────────────────────────────────────────────────────

export interface BookingConfirmationParams {
  bookerEmail: string
  bookerName: string
  hostName: string
  hostEmail?: string
  eventTitle: string
  startAt: Date | string
  endAt: Date | string
  timezone: string
  cancelUrl: string
  bookingId?: string
  // Location fields (optional | omit for legacy bookings without location data)
  locationKind?: string
  meetingUrl?: string
  meetingPhone?: string
  locationAddress?: string
  // Org that owns this booking. When present, sent via sendTenantEmail()
  // using the org's connected Resend integration. Omit when no org id is
  // resolvable at the call site (falls back to the platform Resend client).
  orgId?: string
}

export async function sendBookingConfirmation(
  params: BookingConfirmationParams,
): Promise<void> {
  try {
    const subject = `Booking confirmed: ${params.eventTitle} with ${params.hostName}`
    const when = formatStart(params.startAt, params.timezone)

    // Build location row and optional join-link button
    let locationRow = ''
    let joinButton = ''

    if (params.locationKind) {
      const resolved = resolveMeetingLocation({
        kind: params.locationKind as LocationKind,
        meeting_url: params.meetingUrl ?? null,
        meeting_phone: params.meetingPhone ?? null,
        location_data: params.locationAddress ? { address: params.locationAddress } : {},
      })

      const locationText = meetingLocationLabel({
        kind: params.locationKind as LocationKind,
        meeting_url: params.meetingUrl ?? null,
        meeting_phone: params.meetingPhone ?? null,
        location_data: params.locationAddress ? { address: params.locationAddress } : {},
      })

      locationRow = `<tr><td style="${MUTED} padding: 6px 0; width: 100px;">Where</td><td>${escapeHtml(locationText)}</td></tr>`

      // Video call: show a "Join meeting" button
      if (
        ['google_meet', 'zoom', 'whereby', 'custom_link', 'video'].includes(params.locationKind) &&
        resolved.link
      ) {
        joinButton = `
    <p style="margin-top: 20px;">
      <a href="${escapeHtml(resolved.link)}" style="${BUTTON}">Join meeting</a>
    </p>`
      }
      // Phone call: show a tel: link
      else if (
        ['phone_call', 'custom_phone', 'phone'].includes(params.locationKind) &&
        resolved.phone
      ) {
        joinButton = `
    <p style="margin-top: 16px; font-size: 14px;">
      <span style="${MUTED}">Call: </span>
      <a href="tel:${encodeURIComponent(resolved.phone.replace(/[^+\d]/g, ''))}" style="color: #6366F1; text-decoration: none;">${escapeHtml(resolved.phone)}</a>
    </p>`
      }
      // In-person: show a maps link
      else if (
        ['store_location', 'client_address', 'custom_address', 'in_person'].includes(params.locationKind) &&
        resolved.link
      ) {
        joinButton = `
    <p style="margin-top: 16px; font-size: 14px;">
      <a href="${escapeHtml(resolved.link)}" style="color: #6366F1; text-decoration: none;">View on maps</a>
    </p>`
      }
    }

    const html = `<!doctype html>
<html><body style="${BASE_STYLE}">
  <div style="${CARD_STYLE}">
    <h1 style="margin: 0 0 8px; font-size: 22px;">Booking confirmed</h1>
    <p style="${MUTED} margin: 0 0 24px;">Hi ${escapeHtml(params.bookerName)}, your meeting is on the calendar.</p>

    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      <tr><td style="${MUTED} padding: 6px 0; width: 100px;">Event</td><td>${escapeHtml(params.eventTitle)}</td></tr>
      <tr><td style="${MUTED} padding: 6px 0;">Host</td><td>${escapeHtml(params.hostName)}</td></tr>
      <tr><td style="${MUTED} padding: 6px 0;">When</td><td>${escapeHtml(when)}</td></tr>
      <tr><td style="${MUTED} padding: 6px 0;">Timezone</td><td>${escapeHtml(params.timezone)}</td></tr>
      ${locationRow}
    </table>
    ${joinButton}

    <p style="margin-top: 28px;">
      <a href="${params.cancelUrl}" style="${BUTTON}">Cancel booking</a>
    </p>

    <p style="${MUTED} font-size: 12px; margin-top: 32px;">
      Powered by Xphere
    </p>
  </div>
</body></html>`

    // Build ICS location string (used in LOCATION field)
    let icsLocation: string | undefined
    let icsUrl: string | undefined
    if (params.locationKind) {
      const icsResolved = resolveMeetingLocation({
        kind: params.locationKind as LocationKind,
        meeting_url: params.meetingUrl ?? null,
        meeting_phone: params.meetingPhone ?? null,
        location_data: params.locationAddress ? { address: params.locationAddress } : {},
      })
      icsLocation = meetingLocationLabel({
        kind: params.locationKind as LocationKind,
        meeting_url: params.meetingUrl ?? null,
        meeting_phone: params.meetingPhone ?? null,
        location_data: params.locationAddress ? { address: params.locationAddress } : {},
      }) || undefined
      if (icsResolved.link && icsResolved.link.startsWith('http')) {
        icsUrl = icsResolved.link
      }
    }

    const icsUid = params.bookingId
      ? `booking-${params.bookingId}@xphere.app`
      : `booking-${Date.now()}@xphere.app`

    const icsContent = generateIcs({
      uid: icsUid,
      title: `${params.eventTitle} with ${params.hostName}`,
      startAt: params.startAt,
      endAt: params.endAt,
      timezone: params.timezone,
      description: `Booked via Xphere Scheduling. Cancel: ${params.cancelUrl}`,
      location: icsLocation,
      url: icsUrl,
      organizerEmail: params.hostEmail ?? ICS_ORGANIZER_FALLBACK,
      organizerName: params.hostName,
      attendeeEmail: params.bookerEmail,
    })

    const icsAttachment: EmailAttachment = {
      filename: 'invite.ics',
      content: Buffer.from(icsContent, 'utf-8').toString('base64'),
    }

    // Tenant path: send through the org's own connected Resend integration.
    // Transactional — never suppressed by the marketing unsubscribe list,
    // never gets the compliance footer.
    if (params.orgId) {
      const result = await sendTenantEmail(
        params.orgId,
        params.bookerEmail,
        subject,
        html,
        undefined,
        { kind: 'transactional', source: 'calendar', attachments: [icsAttachment] },
      )
      if (!result.error) return
      console.warn(
        `[calendar/emails] tenant send failed for org ${params.orgId}, falling back to platform Resend:`,
        result.error,
      )
    }

    // Fallback: platform-level Resend integration (platform_email_settings).
    // sendPlatformEmail() never throws and logs its own email_sends row on
    // every outcome, including a no-op when the platform has no connected
    // integration — nothing further to do here on failure.
    await sendPlatformEmail(params.bookerEmail, subject, html, undefined, {
      source: 'calendar',
      attachments: [icsAttachment],
    })
  } catch (err) {
    console.warn(
      '[calendar/emails] sendBookingConfirmation failed:',
      err instanceof Error ? err.message : err,
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// sendBookingCancellation | sent after a booking moves to status='cancelled'.
// ──────────────────────────────────────────────────────────────────────────────

export interface BookingCancellationParams {
  bookerEmail: string
  bookerName: string
  hostName: string
  eventTitle: string
  startAt: Date | string
  timezone: string
  rebookUrl: string
  // Org that owns this booking. When present, sent via sendTenantEmail()
  // using the org's connected Resend integration. Omit when no org id is
  // resolvable at the call site (falls back to the platform Resend client).
  orgId?: string
}

export async function sendBookingCancellation(
  params: BookingCancellationParams,
): Promise<void> {
  try {
    const subject = `Booking cancelled: ${params.eventTitle} with ${params.hostName}`
    const when = formatStart(params.startAt, params.timezone)

    const html = `<!doctype html>
<html><body style="${BASE_STYLE}">
  <div style="${CARD_STYLE}">
    <h1 style="margin: 0 0 8px; font-size: 22px;">Booking cancelled</h1>
    <p style="${MUTED} margin: 0 0 24px;">Hi ${escapeHtml(params.bookerName)}, your booking with ${escapeHtml(params.hostName)} has been cancelled.</p>

    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      <tr><td style="${MUTED} padding: 6px 0; width: 100px;">Event</td><td>${escapeHtml(params.eventTitle)}</td></tr>
      <tr><td style="${MUTED} padding: 6px 0;">Was</td><td>${escapeHtml(when)} (${escapeHtml(params.timezone)})</td></tr>
    </table>

    <p style="margin-top: 28px;">
      <a href="${params.rebookUrl}" style="${BUTTON}">Book a new time</a>
    </p>

    <p style="${MUTED} font-size: 12px; margin-top: 32px;">
      Powered by Xphere
    </p>
  </div>
</body></html>`

    // Tenant path: send through the org's own connected Resend integration.
    // Transactional — never suppressed by the marketing unsubscribe list,
    // never gets the compliance footer. No attachment on cancellations.
    if (params.orgId) {
      const result = await sendTenantEmail(
        params.orgId,
        params.bookerEmail,
        subject,
        html,
        undefined,
        { kind: 'transactional', source: 'calendar' },
      )
      if (!result.error) return
      console.warn(
        `[calendar/emails] tenant send failed for org ${params.orgId}, falling back to platform Resend:`,
        result.error,
      )
    }

    // Fallback: platform-level Resend integration (platform_email_settings).
    // No attachment on cancellations. sendPlatformEmail() never throws and
    // logs its own email_sends row on every outcome, including a no-op when
    // the platform has no connected integration.
    await sendPlatformEmail(params.bookerEmail, subject, html, undefined, {
      source: 'calendar',
    })
  } catch (err) {
    console.warn(
      '[calendar/emails] sendBookingCancellation failed:',
      err instanceof Error ? err.message : err,
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
