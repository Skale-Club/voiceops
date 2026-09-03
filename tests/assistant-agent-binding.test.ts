import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/1290_omnichannel_agent_invocation_foundation.sql',
)

describe('migration 1290 omnichannel agent invocation foundation', () => {
  const sql = readFileSync(migrationPath, 'utf8')

  it('adds voice to the shared agent channel enum idempotently', () => {
    expect(sql).toContain("ALTER TYPE public.agent_channel ADD VALUE IF NOT EXISTS 'voice'")
  })

  it('binds an assistant only to an agent in the same organization', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS entry_agent_id uuid')
    expect(sql).toContain('UNIQUE (organization_id, id)')
    expect(sql).toContain('FOREIGN KEY (organization_id, entry_agent_id)')
    expect(sql).toContain('REFERENCES public.agents(organization_id, id)')
  })

  it('does not backfill or create assistant mappings', () => {
    expect(sql).not.toMatch(/UPDATE\s+public\.assistant_mappings/i)
    expect(sql).not.toMatch(/INSERT\s+INTO\s+public\.assistant_mappings/i)
  })

  it('documents NULL as the legacy-routing compatibility value', () => {
    expect(sql).toContain('NULL preserves legacy direct-workflow routing')
  })
})
