// Shared AI provider resolver for all AI features (copilot, workflow builder,
// knowledge synthesis, /api/email-templates/generate, AI email marketing, etc).
//
// OpenRouter is the platform default | one key covers Claude, GPT, Llama, etc.
// Platform-level keys are managed by the super admin under /admin/settings
// (encrypted in platform_settings table, never read from env).
//
// Resolution order:
//   1. Org-stored OpenRouter key       (org BYOK)
//   2. Platform OpenRouter key         (super admin, applies to all orgs)
//   3. Org-stored Anthropic key        (org BYOK, legacy/direct)
//   4. Platform Anthropic key          (super admin fallback)

import { createClient } from '@/lib/supabase/server'
import { getProviderKey } from '@/lib/integrations/get-provider-key'
import { getPlatformSetting } from '@/lib/platform-settings'

export type ProviderChoice =
  | { kind: 'openrouter'; apiKey: string; model: string }
  | { kind: 'anthropic';  apiKey: string; model: string }

// Default model per provider. Callers can override via the optional `model`
// param when they need a specific Haiku/Opus/etc.
export const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-sonnet-4.5'
export const DEFAULT_ANTHROPIC_MODEL  = 'claude-sonnet-4-6'

// Org-selectable model tiers (Settings → Copilot). Each tier maps to a
// concrete model id per provider so the org picks a speed/quality trade-off
// without caring which provider path their key resolves to.
export type CopilotModelTier = 'fast' | 'default' | 'max'

export const COPILOT_MODEL_TIERS: Record<
  CopilotModelTier,
  { openrouterModel: string; anthropicModel: string }
> = {
  fast:    { openrouterModel: 'anthropic/claude-haiku-4.5', anthropicModel: 'claude-haiku-4-5' },
  default: { openrouterModel: DEFAULT_OPENROUTER_MODEL,     anthropicModel: DEFAULT_ANTHROPIC_MODEL },
  max:     { openrouterModel: 'anthropic/claude-opus-4.5',  anthropicModel: 'claude-opus-4-5' },
}

export function isCopilotModelTier(v: unknown): v is CopilotModelTier {
  return v === 'fast' || v === 'default' || v === 'max'
}

export async function resolveCopilotProvider(
  orgId: string,
  overrides?: { openrouterModel?: string; anthropicModel?: string },
): Promise<ProviderChoice | null> {
  const supabase = await createClient()

  const orModel = overrides?.openrouterModel ?? DEFAULT_OPENROUTER_MODEL
  const anModel = overrides?.anthropicModel ?? DEFAULT_ANTHROPIC_MODEL

  // 1. Org-level OpenRouter
  const orgOr = await getProviderKey('openrouter', orgId, supabase)
  if (orgOr) {
    return { kind: 'openrouter', apiKey: orgOr, model: orModel }
  }

  // 2. Platform-level OpenRouter (super admin → /admin/settings)
  const platformOr = await getPlatformSetting('OPENROUTER_API_KEY')
  if (platformOr) {
    return { kind: 'openrouter', apiKey: platformOr, model: orModel }
  }

  // No third and fourth step on purpose. Every model runs through OpenRouter,
  // 100% of the time. The direct-Anthropic fallback that used to sit here was a
  // second way to be misconfigured and silently was one: agent runs failed with
  // `no_anthropic_key` while a working OpenRouter key sat in platform_settings.
  // The `anthropic` variant of ProviderChoice is now unreachable; call sites
  // that still branch on it are dead code pending cleanup.
  return null
}

// Approximate token → USD cost. Numbers are rough; real spend tracking is
// best-effort at v1 (operator owns the key + the real invoice).
//
// Lookup order: exact id (after normalizing away the OpenRouter `vendor/`
// prefix and dotted versions) → model family → Sonnet-rate fallback, so an
// unknown-but-named Haiku/Opus still debits at roughly the right rate.
const PRICING_PER_MTOK_USD: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-haiku-4-5':  { input: 1, output: 5 },
  'claude-opus-4-5':   { input: 5, output: 25 },
  'claude-opus-4-1':   { input: 15, output: 75 },
}

const FAMILY_PRICING: Array<{ match: string; input: number; output: number }> = [
  { match: 'haiku',  input: 1,  output: 5 },
  { match: 'opus',   input: 5,  output: 25 },
  { match: 'sonnet', input: 3,  output: 15 },
]

function rateFor(model: string): { input: number; output: number } {
  const normalized = model.toLowerCase().split('/').pop()!.replace(/\./g, '-')
  const exact = PRICING_PER_MTOK_USD[normalized]
  if (exact) return exact
  const family = FAMILY_PRICING.find((f) => normalized.includes(f.match))
  return family ?? { input: 3, output: 15 }
}

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = rateFor(model)
  const usd = (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000
  return Math.round(usd * 10000) / 10000
}
