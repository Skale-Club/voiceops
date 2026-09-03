// src/lib/llm/openrouter.ts
// Phase 132 Plan 04 (MODEL-01, MODEL-02): the ONE server-side provider
// resolver + client factory for every Xphere-owned generative call.
//
// Every model this platform runs — Claude, GPT, Llama — is reached through
// exactly one OpenRouter key: the organization's own key first (so an org is
// billed for its own usage), the platform key second. There is no direct
// vendor (Anthropic, OpenAI-direct) generation fallback path; that used to be
// a second, silently-misconfigurable way to authenticate — see
// src/lib/agent-runtime/run-agent.ts and src/lib/copilot/resolve-provider.ts
// for the incident this precedence fixed. The OpenAI SDK remains an allowed
// TRANSPORT — its request/response shape is OpenRouter's native
// chat-completions-compatible API — but it must always be constructed with
// OpenRouter's base URL and an OpenRouter key, never api.openai.com directly
// for generation.
//
// NOT for embeddings: src/lib/knowledge/embed.ts constructs its own
// OpenAI-compatible client against a real embeddings endpoint and is the
// documented, sanctioned exception (132-PROVIDER-DRIFT-INVENTORY.md) —
// changing that would change the vector's dimensionality and require a full
// knowledge-base reindex, which is out of scope here.

import OpenAI from 'openai'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getProviderKey } from '@/lib/integrations/get-provider-key'
import { getPlatformSetting } from '@/lib/platform-settings'
import type { Database } from '@/types/database'

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

export type OpenRouterKeySource = 'organization' | 'platform'

export type OpenRouterCredential = {
  apiKey: string
  source: OpenRouterKeySource
}

/**
 * Resolves the OpenRouter API key to use for this organization's generative
 * calls: the org's own OpenRouter integration key first, then the
 * platform-wide key. Throws `no_openrouter_key` when neither is configured —
 * callers decide how to surface that (usually a 400 "ai_not_configured"
 * response, never a silent fallback to a different provider).
 */
export async function resolveOpenRouterCredential(
  organizationId: string,
  supabase: SupabaseClient<Database>,
): Promise<OpenRouterCredential> {
  const orgKey = await getProviderKey('openrouter', organizationId, supabase)
  if (orgKey) return { apiKey: orgKey, source: 'organization' }

  const platformKey = await getPlatformSetting('OPENROUTER_API_KEY', supabase)
  if (platformKey) return { apiKey: platformKey, source: 'platform' }

  throw new Error('no_openrouter_key')
}

/**
 * Same resolution as resolveOpenRouterCredential(), but returns null instead
 * of throwing — for call sites whose existing contract is "no provider
 * configured" rather than a thrown error.
 */
export async function tryResolveOpenRouterCredential(
  organizationId: string,
  supabase: SupabaseClient<Database>,
): Promise<OpenRouterCredential | null> {
  try {
    return await resolveOpenRouterCredential(organizationId, supabase)
  } catch {
    return null
  }
}

/**
 * Builds the OpenAI-compatible SDK client pointed at OpenRouter. This is the
 * sanctioned way to construct a generative client anywhere in this codebase
 * outside the documented embedding exception (src/lib/knowledge/embed.ts).
 */
export function createOpenRouterClient(apiKey: string): OpenAI {
  return new OpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL })
}

/**
 * Convenience: resolves the credential and builds the client in one call.
 */
export async function getOpenRouterClient(
  organizationId: string,
  supabase: SupabaseClient<Database>,
): Promise<{ client: OpenAI; credential: OpenRouterCredential }> {
  const credential = await resolveOpenRouterCredential(organizationId, supabase)
  return { client: createOpenRouterClient(credential.apiKey), credential }
}
