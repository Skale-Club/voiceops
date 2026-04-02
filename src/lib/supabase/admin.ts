// DANGER: Service role key bypasses ALL RLS policies.
// ONLY import this in /api/vapi/* Edge Function route handlers.
// NEVER import in browser code, dashboard pages, or Server Components.
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export function createServiceRoleClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}
