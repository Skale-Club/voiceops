import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const hasConfig = Boolean(url && anonKey && serviceKey)
const suite = hasConfig ? describe : describe.skip

// TEN-02 acceptance gate — cross-org data isolation via RLS.
// Seeds two orgs + three users with the service-role client, then issues
// queries through authenticated (anon + JWT) clients to verify policies hold.
suite('TEN-02: RLS cross-org data isolation', () => {
  const suffix = Math.random().toString(36).slice(2, 10)
  const userAEmail = `rls-a-${suffix}@example.test`
  const userBEmail = `rls-b-${suffix}@example.test`
  const userCEmail = `rls-c-${suffix}@example.test`
  const password = `Rls-Test-${suffix}!`

  let admin: SupabaseClient
  let clientA: SupabaseClient
  let clientB: SupabaseClient
  let clientC: SupabaseClient

  let orgAId = ''
  let orgBId = ''
  let userAId = ''
  let userBId = ''
  let userCId = ''
  let mappingAId = ''
  let mappingBId = ''

  beforeAll(async () => {
    admin = createClient(url!, serviceKey!, { auth: { persistSession: false } })

    const { data: orgA, error: orgAErr } = await admin
      .from('organizations')
      .insert({ name: `RLS A ${suffix}`, slug: `rls-a-${suffix}`, widget_token: `rls-tok-a-${suffix}` })
      .select('id')
      .single()
    if (orgAErr) throw orgAErr
    orgAId = orgA.id

    const { data: orgB, error: orgBErr } = await admin
      .from('organizations')
      .insert({ name: `RLS B ${suffix}`, slug: `rls-b-${suffix}`, widget_token: `rls-tok-b-${suffix}` })
      .select('id')
      .single()
    if (orgBErr) throw orgBErr
    orgBId = orgB.id

    const { data: uA, error: uAErr } = await admin.auth.admin.createUser({
      email: userAEmail,
      password,
      email_confirm: true,
    })
    if (uAErr) throw uAErr
    userAId = uA.user!.id

    const { data: uB, error: uBErr } = await admin.auth.admin.createUser({
      email: userBEmail,
      password,
      email_confirm: true,
    })
    if (uBErr) throw uBErr
    userBId = uB.user!.id

    const { data: uC, error: uCErr } = await admin.auth.admin.createUser({
      email: userCEmail,
      password,
      email_confirm: true,
    })
    if (uCErr) throw uCErr
    userCId = uC.user!.id

    const { error: memErr } = await admin.from('org_members').insert([
      { user_id: userAId, organization_id: orgAId, role: 'admin' },
      { user_id: userBId, organization_id: orgBId, role: 'admin' },
    ])
    if (memErr) throw memErr

    const { data: mA, error: mAErr } = await admin
      .from('assistant_mappings')
      .insert({
        organization_id: orgAId,
        vapi_assistant_id: `rls-asst-a-${suffix}`,
        name: 'Assistant A',
      })
      .select('id')
      .single()
    if (mAErr) throw mAErr
    mappingAId = mA.id

    const { data: mB, error: mBErr } = await admin
      .from('assistant_mappings')
      .insert({
        organization_id: orgBId,
        vapi_assistant_id: `rls-asst-b-${suffix}`,
        name: 'Assistant B',
      })
      .select('id')
      .single()
    if (mBErr) throw mBErr
    mappingBId = mB.id

    const makeClient = () =>
      createClient(url!, anonKey!, { auth: { persistSession: false } })
    clientA = makeClient()
    clientB = makeClient()
    clientC = makeClient()

    const signIns = await Promise.all([
      clientA.auth.signInWithPassword({ email: userAEmail, password }),
      clientB.auth.signInWithPassword({ email: userBEmail, password }),
      clientC.auth.signInWithPassword({ email: userCEmail, password }),
    ])
    for (const { error } of signIns) if (error) throw error
  }, 60000)

  afterAll(async () => {
    if (!admin) return
    const cleanups: Promise<unknown>[] = []
    if (userAId) cleanups.push(admin.auth.admin.deleteUser(userAId))
    if (userBId) cleanups.push(admin.auth.admin.deleteUser(userBId))
    if (userCId) cleanups.push(admin.auth.admin.deleteUser(userCId))
    await Promise.allSettled(cleanups)
    if (orgAId) await admin.from('organizations').delete().eq('id', orgAId)
    if (orgBId) await admin.from('organizations').delete().eq('id', orgBId)
  }, 60000)

  it('User A querying organizations returns only Org A record (not Org B)', async () => {
    const { data, error } = await clientA
      .from('organizations')
      .select('id')
      .in('id', [orgAId, orgBId])
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].id).toBe(orgAId)
  })

  it('User A querying org_members returns only Org A members', async () => {
    const { data, error } = await clientA.from('org_members').select('user_id, organization_id')
    expect(error).toBeNull()
    expect(data).toBeTruthy()
    expect(data!.length).toBeGreaterThan(0)
    for (const row of data!) {
      expect(row.organization_id).toBe(orgAId)
    }
  })

  it('User A querying assistant_mappings returns only Org A mappings', async () => {
    const { data, error } = await clientA
      .from('assistant_mappings')
      .select('id, organization_id')
      .in('id', [mappingAId, mappingBId])
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].id).toBe(mappingAId)
    expect(data![0].organization_id).toBe(orgAId)
  })

  it('User A INSERT into assistant_mappings with org_b_id is rejected by WITH CHECK policy', async () => {
    const { data, error } = await clientA.from('assistant_mappings').insert({
      organization_id: orgBId,
      vapi_assistant_id: `rls-evil-${suffix}`,
      name: 'Cross-tenant attack',
    })
    expect(data).toBeNull()
    expect(error).toBeTruthy()

    // Verify the row was NOT written — service-role check bypasses RLS
    const { data: check } = await admin
      .from('assistant_mappings')
      .select('id')
      .eq('vapi_assistant_id', `rls-evil-${suffix}`)
    expect(check ?? []).toHaveLength(0)
  })

  it('User with no org_members record gets empty result (not error) on any query', async () => {
    const { data: orgs, error: orgsErr } = await clientC.from('organizations').select('id')
    expect(orgsErr).toBeNull()
    expect(orgs).toEqual([])

    const { data: mappings, error: mErr } = await clientC
      .from('assistant_mappings')
      .select('id')
    expect(mErr).toBeNull()
    expect(mappings).toEqual([])

    const { data: members, error: memErr } = await clientC.from('org_members').select('user_id')
    expect(memErr).toBeNull()
    expect(members).toEqual([])
  })

  it('User B cannot read Org A data (reverse-direction isolation)', async () => {
    const { data, error } = await clientB
      .from('assistant_mappings')
      .select('id, organization_id')
      .in('id', [mappingAId, mappingBId])
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].id).toBe(mappingBId)
  })
})
