// OpenRouter is the only LLM credential the platform manages. One key reaches
// Claude, GPT, Llama and the rest; a second provider key was only ever a second
// way to be misconfigured (and silently was — see resolve-provider.ts).
export const MANAGED_PLATFORM_KEYS = [
  'OPENROUTER_API_KEY',
] as const
export type PlatformKey = (typeof MANAGED_PLATFORM_KEYS)[number]

export const PLATFORM_KEY_META: Record<
  PlatformKey,
  { label: string; description: string; tab: string }
> = {
  OPENROUTER_API_KEY: {
    label: 'OpenRouter API Key (platform default)',
    description:
      'The single key behind every AI feature — agents, Copilot, AI workflow builder, knowledge synthesis, AI email generation — for every org that has not connected its own. One key covers Claude, GPT, Llama and the rest. Get it from https://openrouter.ai/keys.',
    tab: 'AI provider',
  },
}

export const PLATFORM_TABS = [...new Set(
  Object.values(PLATFORM_KEY_META).map((m) => m.tab)
)] as string[]

export type PlatformSettingEntry = {
  key: PlatformKey
  hint: string | null
  label: string
  description: string
  tab: string
}
