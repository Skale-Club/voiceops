// src/lib/obs/alerts.ts
// O3: observability alerting. Sends messages + errors to Telegram and dedupes
// repeat notifications via the obs_alert_log table. Used by the obs-alerts cron.
//
// Config:
//   TELEGRAM_BOT_TOKEN         - Bot token from @BotFather, for this app's own alerts.
//   TELEGRAM_ALERT_CHAT_ID     - Target chat/channel/group id (e.g. -1001234567890).
//   TELEGRAM_BOT_TOKEN_OPS     - Optional. Bot token for an ops-wide destination shared
//                                across apps (xphere, xkedule, skaleclub, xtimator, ...).
//   TELEGRAM_ALERT_CHAT_ID_OPS - Optional. Chat id to pair with TELEGRAM_BOT_TOKEN_OPS.
// When TELEGRAM_BOT_TOKEN / TELEGRAM_ALERT_CHAT_ID are unset, this app's own alerts
// (sendTelegramAlert() with no destination override) are a no-op (telegramConfigured()
// === false). resolveOpsTelegramDestination() prefers the OPS pair when set and falls
// back to the app's own pair, for signals that span multiple apps on this ops hub.

import type { SupabaseClient } from '@supabase/supabase-js'

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
