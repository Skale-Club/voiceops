// Prompt templating for the agent-mesh org-template asset group.
//
// "A template carries behaviour; a tenant supplies its facts"
// (139-CONTEXT.md, Locked decisions). This module is the mechanism that
// makes that literal: a captured prompt may contain `{{business_name}}` /
// `{{business_location}}` tokens, and this module turns them into concrete
// text for one target organization.
//
// This module carries NO tenant-specific string anywhere — no "Cuts &
// Culture", no "Newbury Street". It is reusable platform code. The six live
// prompts that currently hardcode those facts are fixed by a separate,
// tenant-scoped script, not by this module.
//
// resolveTenantFacts() is read-only: it never inserts, updates, or upserts
// any row. It never throws — a target org with no integration connected yet
// (the normal case for a fresh org just installed from a template) falls
// back to the organization's own name/address columns.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { getXkeduleCredentialsForOrg } from '@/lib/xkedule/credentials'
import { xkeduleFetchJson } from '@/lib/xkedule/client'

export interface TenantFacts {
  businessName: string
  businessAddress: string | null
}

interface XkeduleBusinessInfoResponse {
  businessName?: string | null
  address?: string | null
}

/**
 * Render a prompt template's tenant-fact tokens with concrete values.
 *
 * `{{business_name}}` -> facts.businessName
 * `{{business_location}}` -> "businessName, businessAddress", or just
 *   businessName when businessAddress is null/empty (no dangling comma).
 *
 * A template with neither token round-trips unchanged.
 */
export function renderPromptTemplate(template: string, facts: TenantFacts): string {
  const location =
    facts.businessAddress && facts.businessAddress.trim().length > 0
      ? `${facts.businessName}, ${facts.businessAddress}`
      : facts.businessName

  return template
    .replaceAll('{{business_location}}', location)
    .replaceAll('{{business_name}}', facts.businessName)
}

function assembleAddressFromOrgRow(org: {
  address_line1: string | null
  address_line2: string | null
  address_city: string | null
  address_state: string | null
  address_postal_code: string | null
}): string | null {
  const cityState = [org.address_city, org.address_state].filter(Boolean).join(', ')
  const parts = [org.address_line1, org.address_line2, cityState, org.address_postal_code].filter(
    (part): part is string => !!part && part.trim().length > 0
  )
  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * Resolve a target organization's business facts for prompt rendering.
 *
 * Prefers live Xkedule business-info when the org has an active connection;
 * falls back to the organization's own name/address columns otherwise. Never
 * throws — any failure resolving or calling Xkedule (no integration,
 * decrypt error, network error, timeout) is swallowed and the organizations-
 * row values are used instead. Read-only: never writes to any table.
 */
export async function resolveTenantFacts(
  admin: SupabaseClient<Database>,
  orgId: string
): Promise<TenantFacts> {
  const { data: org } = await admin
    .from('organizations')
    .select(
      'name, address_line1, address_line2, address_city, address_state, address_postal_code, address_country'
    )
    .eq('id', orgId)
    .maybeSingle()

  const fallback: TenantFacts = {
    businessName: org?.name ?? '',
    businessAddress: org ? assembleAddressFromOrgRow(org) : null,
  }

  try {
    const credentials = await getXkeduleCredentialsForOrg(orgId, admin)
    if (!credentials) return fallback

    const info = await xkeduleFetchJson<XkeduleBusinessInfoResponse>(
      '/api/v1/business-info',
      'GET',
      null,
      credentials
    )

    return {
      businessName: info.businessName && info.businessName.trim().length > 0 ? info.businessName : fallback.businessName,
      businessAddress: info.address && info.address.trim().length > 0 ? info.address : fallback.businessAddress,
    }
  } catch {
    // Xkedule not connected, decrypt failure, network error, timeout — all
    // normal for a fresh org from a template. Fall back silently.
    return fallback
  }
}
