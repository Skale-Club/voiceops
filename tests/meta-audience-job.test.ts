import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const root = process.cwd()
const scriptPath = path.join(root, 'scripts', 'meta-audience-sync.ts')
const workflowPath = path.join(root, '.github', 'workflows', 'meta-audience-sync.yml')

describe('Meta audience scheduler contract', () => {
  it('delegates to the ledger reconciler and has no contacts-only scan', () => {
    const source = readFileSync(scriptPath, 'utf8')
    expect(source).toContain('reconcileMetaAudience')
    expect(source).toContain('SupabaseAudienceReconcileStore')
    expect(source).toContain('OrgOAuthProvider')
    expect(source).not.toContain(".from('contacts')")
    expect(source).not.toContain('syncUsersToAudience')
    expect(source).not.toContain('META_SYSTEM_USER_TOKEN')
  })

  it('supports explicit org, audience, and dry-run constraints', () => {
    const source = readFileSync(scriptPath, 'utf8')
    expect(source).toContain("'--org'")
    expect(source).toContain("'--audience'")
    expect(source).toContain("'--dry-run'")
    expect(source).toContain("query = query.eq('org_id', options.orgId)")
    expect(source).toContain("query = query.eq('id', options.audienceId)")
  })

  it('names every required runtime key and reports a legitimate no-work success', () => {
    const source = readFileSync(scriptPath, 'utf8')
    expect(source).toContain('NEXT_PUBLIC_SUPABASE_URL')
    expect(source).toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(source).toContain('ENCRYPTION_SECRET')
    expect(source).toContain('0 audiences due')
    expect(source).toContain('throw new Error(`Missing required configuration: ${missing.join(\', \')}`)')
  })

  it('keeps an hourly/manual workflow that fails closed without a global Meta token', () => {
    const source = readFileSync(workflowPath, 'utf8')
    const workflow = parse(source) as Record<string, unknown>
    expect(workflow).toBeTruthy()
    expect(source).toContain("cron: '15 * * * *'")
    expect(source).toContain('workflow_dispatch:')
    expect(source).toContain('audience_id:')
    expect(source).toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(source).toContain('ENCRYPTION_SECRET')
    expect(source).not.toContain('META_SYSTEM_USER_TOKEN')
    expect(source).not.toContain('configured=false')
  })
})
