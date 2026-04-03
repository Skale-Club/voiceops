'use server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'

function generateSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

export async function createOrganization(data: { name: string }): Promise<{ error?: string } | void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const admin = createServiceRoleClient()
  const slug = generateSlug(data.name)

  const { data: org, error: orgError } = await admin
    .from('organizations')
    .insert({ name: data.name, slug })
    .select('id')
    .single()
  if (orgError) {
    if (orgError.code === '23505') return { error: 'An organization with this name already exists.' }
    return { error: orgError.message }
  }

  const { error: memberError } = await admin
    .from('org_members')
    .insert({ organization_id: org.id, user_id: user.id, role: 'admin' })
  if (memberError) return { error: memberError.message }

  // Auto-switch to the newly created org
  await supabase
    .from('user_active_org')
    .upsert({ user_id: user.id, organization_id: org.id, updated_at: new Date().toISOString() })

  revalidatePath('/', 'layout')
}

export async function switchOrganization(organizationId: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  // Verify the user is actually a member of this org (security check)
  const { data: member } = await supabase
    .from('org_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('organization_id', organizationId)
    .single()

  if (!member) return { error: 'You are not a member of this organization.' }

  const { error } = await supabase
    .from('user_active_org')
    .upsert({ user_id: user.id, organization_id: organizationId, updated_at: new Date().toISOString() })

  if (error) return { error: error.message }

  revalidatePath('/', 'layout')
  return {}
}

export async function updateOrganization(
  id: string,
  data: { name: string; is_active: boolean }
): Promise<{ error?: string } | void> {
  const supabase = await createClient()
  const slug = generateSlug(data.name)
  const { error } = await supabase
    .from('organizations')
    .update({ name: data.name, slug, is_active: data.is_active })
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/organizations')
}

export async function toggleOrganizationStatus(
  id: string,
  is_active: boolean
): Promise<{ error?: string } | void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('organizations')
    .update({ is_active })
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/organizations')
}
