import { createServiceRoleClient } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/request-ip'
import {
  isRequestAllowed,
  normalizeWidgetUrlMode,
  normalizeWidgetUrlRules,
} from '@/lib/widget/url-rules'
import {
  isVerticallyCentered,
  normalizeWidgetOffset,
  normalizeWidgetPosition,
} from '@/lib/widget/position'

export const runtime = 'nodejs'

// S11 — rate-limit public widget config lookup: 30/min per IP (token enumeration prevention)
const RL_LIMIT = 30
const RL_WINDOW = 60

// The widget fetches this endpoint cross-origin (script served from xphere.app,
// host page on the customer's domain), so CORS is required for the response —
// including the 403 that URL rules return — to be readable by the browser.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const DEFAULT_WIDGET_CONFIG = {
  displayName: 'AI Assistant',
  primaryColor: '#18181B',
  welcomeMessage: 'Hi! How can I help?',
} as const

function normalizeWidgetValue(value: string | null | undefined, fallback: string): string {
  if (typeof value !== 'string') return fallback

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
): Promise<Response> {
  const ip = getClientIp(request)
  const rl = await rateLimit(`widget:config:${ip}`, RL_LIMIT, RL_WINDOW)
  if (!rl.allowed) {
    return Response.json({ error: 'Too many requests' }, { status: 429, headers: CORS_HEADERS })
  }

  const { token } = await params

  const supabase = createServiceRoleClient()
  const { data: org, error } = await supabase
    .from('organizations')
    .select('is_active, widget_display_name, widget_primary_color, widget_welcome_message, widget_avatar_url, accent_color, widget_greeting_enabled, widget_greeting_message, widget_greeting_delay_seconds, widget_url_mode, widget_url_rules, widget_position, widget_offset_x, widget_offset_y')
    .eq('widget_token', token)
    .single()

  if (error || !org || !org.is_active) {
    return Response.json({ error: 'Invalid or inactive token' }, { status: 401, headers: CORS_HEADERS })
  }

  // URL authorization — is the widget allowed to run on the requesting page?
  // Client-side gate: widget.js hides itself when this endpoint returns 403.
  const mode = normalizeWidgetUrlMode(org.widget_url_mode)
  const rules = normalizeWidgetUrlRules(org.widget_url_rules)
  const clientUrl = new URL(request.url).searchParams.get('u')
  const allowed = isRequestAllowed(mode, rules, {
    origin: request.headers.get('origin'),
    referer: request.headers.get('referer'),
    clientUrl,
  })
  if (!allowed) {
    return Response.json({ error: 'not_authorized_for_origin' }, { status: 403, headers: CORS_HEADERS })
  }

  const welcomeMessage = normalizeWidgetValue(org.widget_welcome_message, DEFAULT_WIDGET_CONFIG.welcomeMessage)
  // Clamp the greeting delay to 0–30s so a bad value can't hide the composer forever.
  const rawDelay = typeof org.widget_greeting_delay_seconds === 'number' ? org.widget_greeting_delay_seconds : 3
  const greetingDelaySeconds = Math.max(0, Math.min(30, rawDelay))

  // Placement (migration 1269). The DB has CHECK constraints, but normalize here
  // too so a widget served against an un-migrated column still gets bottom-right
  // rather than an undefined anchor. offsetY is meaningless when centered.
  const position = normalizeWidgetPosition(org.widget_position)

  return Response.json({
    displayName: normalizeWidgetValue(org.widget_display_name, DEFAULT_WIDGET_CONFIG.displayName),
    // Fall back to the company's brand accent so the widget matches the brand
    // out of the box; an explicit widget_primary_color still overrides it.
    primaryColor: normalizeWidgetValue(
      org.widget_primary_color,
      normalizeWidgetValue(org.accent_color, DEFAULT_WIDGET_CONFIG.primaryColor),
    ),
    welcomeMessage,
    avatarUrl: org.widget_avatar_url || null,
    // Greeting composer config (migration 1148). Greeting text falls back to the
    // welcome message when not explicitly set.
    greetingEnabled: org.widget_greeting_enabled !== false,
    greetingMessage: normalizeWidgetValue(org.widget_greeting_message, welcomeMessage),
    greetingDelaySeconds,
    position,
    offsetX: normalizeWidgetOffset(org.widget_offset_x),
    offsetY: isVerticallyCentered(position) ? 0 : normalizeWidgetOffset(org.widget_offset_y),
  }, { headers: CORS_HEADERS })
}
