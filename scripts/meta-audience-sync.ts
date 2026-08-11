#!/usr/bin/env tsx
// Hourly recovery worker for tenant-owned Meta Custom Audiences.
// All membership selection, hashing, diffing, locking, and ledger commits live
// in audience-reconcile; this entrypoint only validates runtime configuration,
// constrains the config query, and reports safe aggregate outcomes.

import { createClient } from '@supabase/supabase-js'
import { OrgOAuthProvider } from '../src/lib/meta/audience-provider'
import {
  reconcileMetaAudience,
  SupabaseAudienceReconcileStore,
} from '../src/lib/meta/audience-reconcile'
import type { Database } from '../src/types/database'

export interface AudienceJobOptions {
  orgId: string | null
  audienceId: string | null
  dryRun: boolean
}

export function parseOptions(argv: string[]): AudienceJobOptions {
  const valueAfter = (flag: string): string | null => {
    const index = argv.indexOf(flag)
    if (index === -1) return null
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
    return value
  }
  return {
    orgId: valueAfter('--org'),
    audienceId: valueAfter('--audience'),
    dryRun: argv.includes('--dry-run'),
  }
}

export function requireRuntime(env: NodeJS.ProcessEnv) {
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'ENCRYPTION_SECRET',
  ] as const
  const missing = required.filter((key) => !env[key]?.trim())
  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`)
  }
  if (!/^[0-9a-fA-F]{64}$/.test(env.ENCRYPTION_SECRET!)) {
    throw new Error('Missing required configuration: ENCRYPTION_SECRET must be 64 hex characters')
  }
  return {
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY!,
  }
}

export async function runAudienceJob(options: AudienceJobOptions): Promise<{
  due: number
  succeeded: number
  failed: number
  skipped: number
}> {
  const runtime = requireRuntime(process.env)
  const supabase = createClient<Database>(runtime.supabaseUrl, runtime.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let query = supabase
    .from('meta_audience_config')
    .select('id, org_id, dirty_at, next_sync_at, last_synced_at')
    .eq('sync_enabled', true)
  if (options.orgId) query = query.eq('org_id', options.orgId)
  if (options.audienceId) query = query.eq('id', options.audienceId)

  const { data, error } = await query
  if (error) throw new Error('Could not load due Meta audience configurations')

  const now = Date.now()
  const configs = (data ?? []).filter((config) => {
    if (options.orgId || options.audienceId || options.dryRun) return true
    if (config.dirty_at || !config.last_synced_at || !config.next_sync_at) return true
    const next = Date.parse(config.next_sync_at)
    return !Number.isFinite(next) || next <= now
  })

  if (configs.length === 0) {
    console.log('[meta-audience-sync] 0 audiences due')
    return { due: 0, succeeded: 0, failed: 0, skipped: 0 }
  }

  const store = new SupabaseAudienceReconcileStore(supabase)
  const provider = new OrgOAuthProvider(supabase)
  let succeeded = 0
  let failed = 0
  let skipped = 0

  console.log(`[meta-audience-sync] ${configs.length} audiences due${options.dryRun ? ' (dry-run)' : ''}`)
  for (const config of configs) {
    const result = await reconcileMetaAudience({
      store,
      provider,
      orgId: config.org_id,
      audienceConfigId: config.id,
      trigger: options.dryRun ? 'manual' : 'scheduled',
      dryRun: options.dryRun,
    })
    if (result.status === 'succeeded') {
      succeeded++
      console.log(
        `[meta-audience-sync] org=${config.org_id} audience=${config.id} ` +
        `status=succeeded add=${result.addCount} remove=${result.removeCount} unchanged=${result.unchangedCount}`,
      )
    } else if (result.status === 'skipped') {
      skipped++
      console.log(`[meta-audience-sync] org=${config.org_id} audience=${config.id} status=already_claimed`)
    } else {
      failed++
      console.error(
        `[meta-audience-sync] org=${config.org_id} audience=${config.id} ` +
        `status=failed code=${result.errorCode}`,
      )
    }
  }

  console.log(
    `[meta-audience-sync] finished due=${configs.length} succeeded=${succeeded} failed=${failed} skipped=${skipped}`,
  )
  if (failed > 0) throw new Error(`${failed} Meta audience reconciliation(s) failed`)
  return { due: configs.length, succeeded, failed, skipped }
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  console.log(`[meta-audience-sync] starting${options.dryRun ? ' dry-run' : ''}`)
  await runAudienceJob(options)
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/meta-audience-sync.ts')) {
  main().catch((error) => {
    console.error('[meta-audience-sync] fatal:', error instanceof Error ? error.message : 'unknown error')
    process.exitCode = 1
  })
}
