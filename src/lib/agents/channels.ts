/**
 * Mirrors the public.agent_channel enum (migration 034).
 */
// User-facing chat channels (shown in pickers: allowed channels, channel defaults).
export const PUBLIC_AGENT_CHANNELS = [
  'web_widget',
  'sms',
  'whatsapp',
  'messenger',
  'instagram',
  'manychat',
  'telegram',
  'zernio',
  'voice',
] as const

// Full channel domain. 'workflow' is server-initiated (a flow agent node), NOT a
// public channel — it's part of the type but excluded from UI pickers.
export const AGENT_CHANNELS = [...PUBLIC_AGENT_CHANNELS, 'workflow'] as const

export type AgentChannel = (typeof AGENT_CHANNELS)[number]
export type PublicAgentChannel = (typeof PUBLIC_AGENT_CHANNELS)[number]

export const AGENT_CHANNEL_LABELS: Record<AgentChannel, string> = {
  web_widget: 'Web Widget',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  messenger: 'Messenger',
  instagram: 'Instagram',
  manychat: 'ManyChat',
  telegram: 'Telegram',
  zernio: 'Zernio',
  voice: 'Voice (Vapi)',
  workflow: 'Workflow',
}
