'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient, getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { seedOrgWorkflows } from '@/lib/workflows/seed-org'
import { slugify } from '@/lib/slug'
import { captureOrgSnapshot } from '@/lib/org-templates/snapshot'
import { installSnapshotIntoOrg } from '@/lib/org-templates/install'
import {
  ASSET_GROUPS,
  type InstallSummary,
  type OrgTemplateAssetGroup,
  type OrgTemplateSnapshot,
  type OrgTemplateStatus,
} from '@/lib/org-templates/types'

const assetGroupSchema = z.enum(ASSET_GROUPS)

const createTemplateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120, 'Name too long'),
  industry: z.string().trim().max(120).optional().or(z.literal('')),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  asset_groups: z.array(assetGroupSchema).min(1, 'Select at least one asset group'),
})

const updateTemplateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120, 'Name too long'),
  industry: z.string().trim().max(120).optional().or(z.literal('')),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  status: z.enum(['draft', 'active', 'archived']),
})

const createOrgSchema = z.object({
  name: z.string().trim().min(1, 'Organization name is required').max(120, 'Name too long'),
})

const SETTINGS_PATH = '/settings/organization-templates'

export interface OrgTemplateListItem {
  id: string
  name: string
  industry: string | null
  description: string | null
  status: OrgTemplateStatus
  asset_groups: OrgTemplateAssetGroup[]
  snapshot_at: string | null
  created_at: string
  updated_at: string
  counts: {
    pipelines: number
    custom_fields: number
    tags: number
    message_templates: number
    workflows: number
    agents: number
  }
}

function snapshotCounts(snapshot: OrgTemplateSnapshot) {
  return {
    pipelines: snapshot.pipelines?.length ?? 0,
    custom_fields: snapshot.custom_fields?.length ?? 0,
    tags: snapshot.tags?.length ?? 0,
    message_templates: snapshot.message_templates?.length ?? 0,
    workflows: snapshot.workflows?.length ?? 0,
    agents: snapshot.agents?.length ?? 0,
  }
}

export async function listOrgTemplates(): Promise<OrgTemplateListItem[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()

  const { data } = await supabase
    .from('org_templates')
    .select('id, name, industry, description, status, asset_groups, snapshot, snapshot_at, created_at, updated_at')
    .order('updated_at', { ascending: false })

  return (data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    industry: t.industry,
    description: t.description,
    status: t.status as OrgTemplateStatus,
    asset_groups: (t.asset_groups ?? []) as OrgTemplateAssetGroup[],
    snapshot_at: t.snapshot_at,
    created_at: t.created_at,
    updated_at: t.updated_at,
    counts: snapshotCounts((t.snapshot ?? {}) as OrgTemplateSnapshot),
  }))
}

export interface OrgTemplateInstallItem {
  id: string
  template_name: string | null
  target_org_name: string | null
  asset_groups: OrgTemplateAssetGroup[]
  installed_at: string
  counts: InstallSummary['counts'] | null
}

export async function listOrgTemplateInstalls(): Promise<OrgTemplateInstallItem[]> {
  const user = await getUser()
  if (!user) return []
  const supabase = await createClient()

  const { data } = await supabase
    .from('org_template_installs')
    .select('id, template_name, target_org_name, asset_groups, summary, installed_at')
    .order('installed_at', { ascending: false })
    .limit(25)

  return (data ?? []).map((i) => {
    const summary = (i.summary ?? null) as InstallSummary | null
    return {
      id: i.id,
      template_name: i.template_name,
      target_org_name: i.target_org_name,
      asset_groups: (i.asset_groups ?? []) as OrgTemplateAssetGroup[],
      installed_at: i.installed_at,
      counts: summary?.counts ?? null,
    }
  })
}

export async function createTemplateFromCurrentOrg(input: {
  name: string
  industry?: string
  description?: string
  asset_groups: string[]
}): Promise<{ error?: string; id?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }

  const parsed = createTemplateSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }

  const supabase = await createClient()
  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No active organization.' }

  const groups = parsed.data.asset_groups as OrgTemplateAssetGroup[]
  const snapshot = await captureOrgSnapshot(supabase, groups, { organizationId: orgId })

  const { data, error } = await supabase
    .from('org_templates')
    .insert({
      owner_org_id: orgId,
      source_org_id: orgId,
      name: parsed.data.name,
      industry: parsed.data.industry || null,
      description: parsed.data.description || null,
      status: 'draft',
      asset_groups: groups,
      snapshot: snapshot as never,
      snapshot_at: new Date().toISOString(),
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }
  revalidatePath(SETTINGS_PATH)
  return { id: data.id }
}

export async function updateOrgTemplate(
  id: string,
  input: { name: string; industry?: string; description?: string; status: string }
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }

  const parsed = updateTemplateSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('org_templates')
    .update({
      name: parsed.data.name,
      industry: parsed.data.industry || null,
      description: parsed.data.description || null,
      status: parsed.data.status as OrgTemplateStatus,
    })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath(SETTINGS_PATH)
}

/** Re-capture the snapshot from the current org using the template's groups. */
export async function refreshTemplateSnapshot(
  id: string
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }

  const supabase = await createClient()
  const { data: tmpl } = await supabase
    .from('org_templates')
    .select('asset_groups')
    .eq('id', id)
    .maybeSingle()
  if (!tmpl) return { error: 'Template not found.' }

  const { data: orgId } = await supabase.rpc('get_current_org_id')
  if (!orgId) return { error: 'No active organization.' }

  const groups = (tmpl.asset_groups ?? []) as OrgTemplateAssetGroup[]
  const snapshot = await captureOrgSnapshot(supabase, groups, { organizationId: orgId })

  const { error } = await supabase
    .from('org_templates')
    .update({ snapshot: snapshot as never, snapshot_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath(SETTINGS_PATH)
}

export async function deleteOrgTemplate(id: string): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { error } = await supabase.from('org_templates').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath(SETTINGS_PATH)
}

export async function createOrgFromTemplate(
  templateId: string,
  input: { name: string }
): Promise<{ error?: string; summary?: InstallSummary; orgId?: string; orgName?: string }> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }

  const parsed = createOrgSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' }
  }

  const supabase = await createClient()
  const { data: ownerOrgId } = await supabase.rpc('get_current_org_id')
  if (!ownerOrgId) return { error: 'No active organization.' }

  // Read the template through the RLS-scoped client so only templates owned by
  // the current org are reachable.
  const { data: tmpl } = await supabase
    .from('org_templates')
    .select('id, name, asset_groups, snapshot')
    .eq('id', templateId)
    .maybeSingle()
  if (!tmpl) return { error: 'Template not found.' }

  const admin = createServiceRoleClient()
  const slug = slugify(parsed.data.name)

  const { data: org, error: orgError } = await admin
    .from('organizations')
    .insert({ name: parsed.data.name, slug, widget_token: crypto.randomUUID() })
    .select('id')
    .single()
  if (orgError) {
    if (orgError.code === '23505') {
      return { error: 'An organization with this name already exists.' }
    }
    return { error: orgError.message }
  }

  // The creator is the org Owner (top of the RBAC hierarchy; can manage roles).
  const { error: memberError } = await admin
    .from('org_members')
    .insert({ organization_id: org.id, user_id: user.id, role: 'owner' })
  if (memberError) return { error: memberError.message }

  const groups = (tmpl.asset_groups ?? []) as OrgTemplateAssetGroup[]

  // Every new org gets the baseline platform-default workflows, just like a
  // normal org creation. Awaited (not fire-and-forget) so the template import
  // below sees a deterministic starting state and can skip any slug that the
  // platform defaults already occupy.
  await seedOrgWorkflows(org.id).catch(() => {})

  const summary = await installSnapshotIntoOrg(
    admin,
    org.id,
    (tmpl.snapshot ?? {}) as OrgTemplateSnapshot,
    groups,
    user.id
  )

  await admin.from('org_template_installs').insert({
    owner_org_id: ownerOrgId,
    template_id: tmpl.id,
    template_name: tmpl.name,
    target_org_id: org.id,
    target_org_name: parsed.data.name,
    asset_groups: groups,
    summary: summary as never,
    installed_by: user.id,
  })

  revalidatePath(SETTINGS_PATH)
  revalidatePath('/organizations')
  return { summary, orgId: org.id, orgName: parsed.data.name }
}
