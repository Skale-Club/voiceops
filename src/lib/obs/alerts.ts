// src/lib/obs/alerts.ts
// O3: observability alerting. Sends messages + errors to Telegram and/or email,
// and dedupes repeat notifications via the obs_alert_log table. Used by the
// obs-alerts cron.
//
// Config:
//   TELEGRAM_BOT_TOKEN         - Bot token from @BotFather, for this app's own alerts.
//   TELEGRAM_ALERT_CHAT_ID     - Target chat/channel/group id (e.g. -1001234567890).
//   TELEGRAM_BOT_TOKEN_OPS     - Optional. Bot token for an ops-wide destination shared
//                                across apps (xphere, xkedule, skaleclub, xtimator, ...).
//   TELEGRAM_ALERT_CHAT_ID_OPS - Optional. Chat id to pair with TELEGRAM_BOT_TOKEN_OPS.
//   PLATFORM_ADMIN_EMAIL       - Recipient for the email alert channel. Sent via
//                                sendPlatformEmail() (platform_email_settings / Resend).
// When TELEGRAM_BOT_TOKEN / TELEGRAM_ALERT_CHAT_ID are unset, this app's own alerts
// (sendTelegramAlert() with no destination override) are a no-op (telegramConfigured()
// === false). resolveOpsTelegramDestination() prefers the OPS pair when set and falls
// back to the app's own pair, for signals that span multiple apps on this ops hub.
//
// Email is the floor, not the ceiling: Telegram is faster and better suited to
// on-call (push notification, group chat, mobile), but it requires a human to
// sit in the Telegram app and create a bot + chat before it can carry a single
// message - a channel that requires a human to exist is not a channel you can
// rely on having. Email needs zero setup beyond an already-configured Resend
// integration and an admin address, both of which this platform has by
// default, so deliverAlert() always falls through to it. Callers that just
// want "get this alert out, best effort" should use deliverAlert() rather than
// picking a single channel by hand.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createLogger } from '@/lib/obs/logger'
import { sendPlatformEmail } from '@/lib/email/resend'

export type AlertSeverity = 'warning' | 'critical'

export interface Alert {
  /** Stable dedupe key (e.g. `cost:<org>:<yyyy-mm-dd>`). */
  key: string
  title: string
  severity: AlertSeverity
  fields?: Record<string, string | number>
}

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const TELEGRAM_ALERT_CHAT_ID = process.env.TELEGRAM_ALERT_CHAT_ID
const TELEGRAM_BOT_TOKEN_OPS = process.env.TELEGRAM_BOT_TOKEN_OPS
const TELEGRAM_ALERT_CHAT_ID_OPS = process.env.TELEGRAM_ALERT_CHAT_ID_OPS

export function telegramConfigured(): boolean {
  return Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_ALERT_CHAT_ID)
}

export interface TelegramDestination {
  botToken: string
  chatId: string
}

/**
 * True when an ops-wide alert has somewhere to go - either the dedicated OPS
 * bot/chat, or (as a fallback) this app's own bot/chat.
 */
export function opsTelegramConfigured(): boolean {
  return Boolean(TELEGRAM_BOT_TOKEN_OPS && TELEGRAM_ALERT_CHAT_ID_OPS) || telegramConfigured()
}

/**
 * Resolves where an ops-wide alert should go (e.g. cron heartbeat staleness,
 * which can be reported by a job belonging to any app on this ops hub, not
 * just xphere). Prefers the dedicated OPS bot/chat when both are set, and
 * falls back to this app's own bot/chat otherwise. Returns null when neither
 * pair is configured.
 */
export function resolveOpsTelegramDestination(): TelegramDestination | null {
  if (TELEGRAM_BOT_TOKEN_OPS && TELEGRAM_ALERT_CHAT_ID_OPS) {
    return { botToken: TELEGRAM_BOT_TOKEN_OPS, chatId: TELEGRAM_ALERT_CHAT_ID_OPS }
  }
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_ALERT_CHAT_ID) {
    return { botToken: TELEGRAM_BOT_TOKEN, chatId: TELEGRAM_ALERT_CHAT_ID }
  }
  return null
}

// ─── Pure evaluation helpers (unit-tested) ────────────────────────────────────

export function costSeverity(pct: number): AlertSeverity {
  return pct >= 100 ? 'critical' : 'warning'
}

/** True when cost has reached the alert threshold (>= 80% of cap). */
export function costBreached(costUsd: number, capUsd: number): boolean {
  if (capUsd <= 0) return false
  return (costUsd / capUsd) * 100 >= 80
}

/** True when the error rate over a window is concerning (enough volume + ratio). */
export function errorRateBreached(total: number, errors: number, minVolume = 20, ratio = 0.25): boolean {
  if (total < minVolume) return false
  return errors / total >= ratio
}

// ─── Telegram delivery ─────────────────────────────────────────────────────────

/**
 * Sends an alert to Telegram. Defaults to this app's own bot/chat
 * (TELEGRAM_BOT_TOKEN / TELEGRAM_ALERT_CHAT_ID); pass `destination` (e.g.
 * from resolveOpsTelegramDestination()) to send elsewhere instead - used for
 * ops-wide signals that aren't specific to this app.
 */
export async function sendTelegramAlert(alert: Alert, destination?: TelegramDestination): Promise<boolean> {
  const botToken = destination?.botToken ?? TELEGRAM_BOT_TOKEN
  const chatId = destination?.chatId ?? TELEGRAM_ALERT_CHAT_ID
  if (!botToken || !chatId) return false
  const icon = alert.severity === 'critical' ? '🔴' : '🟠'
  const lines = [`${icon} *${alert.title}*`]
  for (const [k, v] of Object.entries(alert.fields ?? {})) lines.push(`• ${k}: ${v}`)
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: lines.join('\n'),
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    })
    return res.ok
  } catch {
    return false
  }
}

// ─── Email delivery ─────────────────────────────────────────────────────────

/** True when the email alert channel has somewhere to send to. */
export function alertEmailConfigured(): boolean {
  return Boolean(process.env.PLATFORM_ADMIN_EMAIL)
}

function severityLabel(severity: AlertSeverity): string {
  return severity === 'critical' ? 'CRITICAL' : 'WARNING'
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Renders an Alert as a small, scannable HTML email plus a plain-text alternative. */
function renderAlertEmail(alert: Alert): { html: string; text: string } {
  const fields = Object.entries(alert.fields ?? {})
  const color = alert.severity === 'critical' ? '#dc2626' : '#d97706'

  const htmlRows = fields
    .map(
      ([k, v]) => `
        <tr>
          <td style="padding:4px 12px 4px 0;color:#6b7280;font-family:Arial,Helvetica,sans-serif;font-size:13px;white-space:nowrap;vertical-align:top;">${escapeHtml(k)}</td>
          <td style="padding:4px 0;color:#111827;font-family:Arial,Helvetica,sans-serif;font-size:13px;">${escapeHtml(String(v))}</td>
        </tr>`,
    )
    .join('')

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;">
      <span style="display:inline-block;padding:2px 8px;border-radius:4px;background:${color};color:#ffffff;font-size:12px;font-weight:600;letter-spacing:0.03em;">${severityLabel(alert.severity)}</span>
      <h2 style="margin:12px 0 16px;color:#111827;font-size:18px;line-height:1.3;">${escapeHtml(alert.title)}</h2>
      ${fields.length ? `<table style="border-collapse:collapse;">${htmlRows}</table>` : ''}
      <p style="margin-top:20px;color:#9ca3af;font-family:Arial,Helvetica,sans-serif;font-size:11px;">alert key: ${escapeHtml(alert.key)}</p>
    </div>`

  const text = [
    `[${severityLabel(alert.severity)}] ${alert.title}`,
    '',
    ...fields.map(([k, v]) => `${k}: ${v}`),
    '',
    `alert key: ${alert.key}`,
  ].join('\n')

  return { html, text }
}

/**
 * Sends an alert by email to PLATFORM_ADMIN_EMAIL via sendPlatformEmail().
 * Never throws - a failing alert channel must not break the caller. Returns
 * true only when the send actually succeeded.
 */
export async function sendAlertEmail(alert: Alert): Promise<boolean> {
  const to = process.env.PLATFORM_ADMIN_EMAIL
  if (!to) return false
  try {
    const subject = `[${severityLabel(alert.severity)}] ${alert.title}`
    const { html, text } = renderAlertEmail(alert)
    const { error } = await sendPlatformEmail(to, subject, html, text, { source: 'obs-alerts' })
    return !error
  } catch {
    return false
  }
}

// ─── Unified delivery ───────────────────────────────────────────────────────

/** True when at least one alert channel (Telegram or email) has somewhere to send to. */
export function anyAlertChannelConfigured(): boolean {
  return opsTelegramConfigured() || alertEmailConfigured()
}

/**
 * Single entry point callers should use to deliver an alert. Tries Telegram
 * first when configured (passing `opts.telegramDestination` through, e.g.
 * from resolveOpsTelegramDestination()), then email - email is the
 * always-available floor described at the top of this file, so it's always
 * attempted regardless of whether Telegram succeeded. Returns true if any
 * channel delivered. Never throws.
 */
export async function deliverAlert(
  alert: Alert,
  opts?: { telegramDestination?: TelegramDestination },
): Promise<boolean> {
  const log = createLogger({ route: 'obs-alerts', alertKey: alert.key })
  let delivered = false

  const telegramAttempted = Boolean(opts?.telegramDestination) || telegramConfigured()
  if (telegramAttempted) {
    const ok = await sendTelegramAlert(alert, opts?.telegramDestination)
    if (ok) {
      delivered = true
      log.info('alert_channel_delivered', { channel: 'telegram' })
    } else {
      log.warn('alert_channel_failed', { channel: 'telegram' })
    }
  }

  // Email is the fallback, not a second copy. Once a Telegram bot exists,
  // delivering through both would mean every alert pages twice — noise that
  // trains people to ignore the channel, which is how alerting dies. Email is
  // the floor because it needs no setup, so it runs only when the faster
  // channel is absent or failed.
  const emailAttempted = !delivered && alertEmailConfigured()
  if (emailAttempted) {
    const ok = await sendAlertEmail(alert)
    if (ok) {
      delivered = true
      log.info('alert_channel_delivered', { channel: 'email' })
    } else {
      log.warn('alert_channel_failed', { channel: 'email' })
    }
  }

  if (!delivered) {
    log.warn('alert_delivery_failed', { telegramAttempted, emailAttempted })
  }

  return delivered
}

// ─── Dedupe (obs_alert_log) ───────────────────────────────────────────────────
// `supabase` is the service-role client. Typed loosely so this works without
// adding obs_alert_log to the generated Database types.

export async function alreadyAlerted(
  supabase: SupabaseClient,
  key: string,
  windowMinutes: number,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString()
  const { data } = await supabase
    .from('obs_alert_log')
    .select('id')
    .eq('alert_key', key)
    .gte('sent_at', since)
    .limit(1)
    .maybeSingle()
  return Boolean(data)
}

export async function recordAlert(supabase: SupabaseClient, key: string): Promise<void> {
  await supabase.from('obs_alert_log').insert({ alert_key: key })
}
