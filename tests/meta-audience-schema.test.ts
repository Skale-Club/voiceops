import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Database } from '@/types/database'

const migration = readFileSync(
  'supabase/migrations/1271_meta_prospect_audiences.sql',
  'utf8',
)
const databaseTypes = readFileSync('src/types/database.ts', 'utf8')

function withoutSqlComments(sql: string) {
  return sql.replace(/--.*$/gm, '')
}

function sectionBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  expect(startIndex, `missing section start: ${start}`).toBeGreaterThanOrEqual(0)
  expect(endIndex, `missing section end: ${end}`).toBeGreaterThan(startIndex)
  return source.slice(startIndex, endIndex)
}

type AudienceConfig = Database['public']['Tables']['meta_audience_config']
type AudienceMembership = Database['public']['Tables']['meta_audience_memberships']
type AudienceRun = Database['public']['Tables']['meta_audience_sync_runs']

const typedRows: [
  AudienceConfig['Row'] | null,
  AudienceConfig['Insert'] | null,
  AudienceConfig['Update'] | null,
  AudienceMembership['Row'] | null,
  AudienceMembership['Insert'] | null,
  AudienceMembership['Update'] | null,
  AudienceRun['Row'] | null,
  AudienceRun['Insert'] | null,
  AudienceRun['Update'] | null,
] = [null, null, null, null, null, null, null, null, null]

describe('Meta prospect audience schema', () => {
  it('evolves the existing config table without replacing it or restoring one-audience-per-org', () => {
    const sql = withoutSqlComments(migration)

    expect(sql).not.toMatch(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?meta_audience_config/i)
    expect(sql).not.toMatch(/UNIQUE\s*\(\s*org_id\s*\)/i)
    expect(sql).toContain('cardinality(c.conkey) = 1')
    expect(sql).toContain('idx_meta_audience_config_remote_audience')
    expect(sql).toContain('(org_id, meta_ad_account_id, custom_audience_id)')
  })

  it('enforces stable entity membership uniqueness and hash-only persistence', () => {
    const memberships = sectionBetween(
      migration,
      'CREATE TABLE IF NOT EXISTS public.meta_audience_memberships',
      'CREATE INDEX IF NOT EXISTS idx_meta_audience_memberships_org_config',
    )
    const runs = sectionBetween(
      migration,
      'CREATE TABLE IF NOT EXISTS public.meta_audience_sync_runs',
      'CREATE INDEX IF NOT EXISTS idx_meta_audience_sync_runs_org_config',
    )

    expect(memberships).toContain('UNIQUE (audience_config_id, entity_type, entity_id)')
    expect(memberships).toContain('submitted_email_hash')
    expect(memberships).toContain('submitted_phone_hash')
    expect(memberships).toContain('eligibility_fingerprint')
    expect(`${memberships}\n${runs}`).not.toMatch(
      /^\s*(?:raw_?email|raw_?phone|access_?token|encrypted_?access_?token)\s+/gim,
    )
  })

  it.each([
    'meta_audience_config',
    'meta_audience_memberships',
    'meta_audience_sync_runs',
  ])('enables RLS and declares four tenant policies for %s', (table) => {
    expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`)
    for (const operation of ['select', 'insert', 'update', 'delete']) {
      expect(migration).toContain(`CREATE POLICY ${table}_${operation} ON public.${table}`)
    }
  })

  it('keeps manual Row, Insert, and Update types for all audience ledger tables', () => {
    expect(typedRows).toHaveLength(9)
    for (const table of [
      'meta_audience_config',
      'meta_audience_memberships',
      'meta_audience_sync_runs',
    ]) {
      const tableTypes = sectionBetween(databaseTypes, `${table}: {`, 'Relationships: [')
      expect(tableTypes).toContain('Row: {')
      expect(tableTypes).toContain('Insert: {')
      expect(tableTypes).toContain('Update: {')
    }
  })

  it('commits membership and successful run state in one service-role-only transaction', () => {
    const commit = sectionBetween(
      migration,
      'CREATE OR REPLACE FUNCTION public.commit_meta_audience_sync',
      'CREATE OR REPLACE FUNCTION public.complete_meta_audience_dry_run',
    )
    expect(commit).toContain('FOR UPDATE')
    expect(commit).toContain('DELETE FROM public.meta_audience_memberships')
    expect(commit).toContain('INSERT INTO public.meta_audience_memberships')
    expect(commit).toContain("SET status = 'succeeded'")
    expect(commit).toContain("operational_status = 'synced'")
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.commit_meta_audience_sync(uuid, uuid, uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated',
    )
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.commit_meta_audience_sync(uuid, uuid, uuid, uuid, jsonb, jsonb) TO service_role',
    )
  })
})
