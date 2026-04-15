// src/lib/action-engine/resolve-tool.ts
// Resolves (orgId, toolName) → tool_config with nested integration credentials
// Called as second step in the webhook hot path (expect ~10-25ms with composite index)

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// ToolConfigWithIntegration: the shape returned by the joined query
// Used by the webhook route to get both tool config and credentials in one DB call
export type ToolConfigWithIntegration = {
  id: string
  organization_id: string
  integration_id: string
  tool_name: string
  action_type: Database['public']['Enums']['action_type']
  config: Database['public']['Tables']['tool_configs']['Row']['config']
  fallback_message: string
  is_active: boolean
  integrations: {
    id: string
    encrypted_api_key: string
    location_id: string | null
    provider: Database['public']['Enums']['integration_provider']
    config: Database['public']['Tables']['integrations']['Row']['config']
  }
}

export async function resolveTool(
  orgId: string,
  toolName: string,
  supabase: SupabaseClient<Database>
): Promise<ToolConfigWithIntegration | null> {
  // !inner forces the join to be non-optional, so `integrations` is a single object
  // rather than `object | null` in the inferred response type.
  const { data, error } = await supabase
    .from('tool_configs')
    .select('*, integrations!inner(*)')
    .eq('organization_id', orgId)
    .eq('tool_name', toolName)
    .eq('is_active', true)
    .single<ToolConfigWithIntegration>()

  if (error || !data?.integrations?.encrypted_api_key) return null
  return data
}
