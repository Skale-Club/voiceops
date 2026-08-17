/**
 * Materializes a campaign's `audience_filter` into `campaign_recipients`
 * rows (status='pending').
 *
 * The gap this closes: `campaign_recipients` is read by every dispatcher
 * (whatsapp-dispatcher.ts, and now email-dispatcher.ts) but nothing writes
 * to it — the campaign wizard collects `audience_filter` on the campaign
 * and never turns it into rows. Without this, a launch dispatches into an
 * empty recipient set and immediately marks itself completed.
 *
 * Supports the two `audience_filter` shapes the wizard actually produces
 * today (src/app/(dashboard)/campaigns/_components/new-campaign-wizard.tsx):
 *   {}                 → every contact in the org
 *   { tag: "<value>" } → contacts matching a tag. The wizard's tag field is
 *                         free text (a tag *name*, not an id), so resolution
 *                         follows the exact same order as the existing
 *                         contacts list filter
 *                         (src/app/(dashboard)/contacts/actions.ts, ~line 232):
 *                         try id/slug/name match against the `tags` table +
 *                         `contact_tags` junction first, and only fall back
 *                         to the legacy `contacts.tags` text[] `contains`
 *                         match when no `tags` row matches.
 *
 * Channel-agnostic by design (the same missing-write-path gap affects
 * WhatsApp campaigns too — see whatsapp-dispatcher.ts's `status='pending'`
 * read), but only EMAIL campaigns get the "must have an email address"
 * requirement applied at enrollment time in this pass. A contact with no
 * email is not a recipient at all for an email campaign — it should never
 * become a row that a dispatcher then has to skip.
 *
 * Idempotent: relies on migration 1279's unique index on
 * (campaign_id, contact_id) and upserts with `ignoreDuplicates: true`, so
 * calling this twice (e.g. a retried or double-clicked launch) never
 * double-enrolls a contact.
 */

import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { CampaignChannel } from '@/types/database'

export interface EnrollResult {
  ok: boolean
  error?: string
  /** Number of contacts newly enrolled (rows actually inserted, not re-enrolled duplicates). */
  enrolled: number
}

export async function enrollCampaignRecipients(campaignId: string): Promise<EnrollResult> {
  const supabase = createServiceRoleClient()

  const { data: campaign, error: campErr } = await supabase
    .from('campaigns')
    .select('id, organization_id, channel, audience_filter')
    .eq('id', campaignId)
    .maybeSingle()

  if (campErr || !campaign) {
    return { ok: false, error: 'Campaign not found', enrolled: 0 }
  }

  const orgId = campaign.organization_id
  const channel = campaign.channel as CampaignChannel
  const filter = (campaign.audience_filter ?? {}) as Record<string, unknown>
  const tagValue = typeof filter.tag === 'string' ? filter.tag.trim() : ''

  // Resolve the tag filter (if any) to a concrete tag id, or to a legacy
  // contacts.tags `contains` value. Mirrors the resolution order in
  // src/app/(dashboard)/contacts/actions.ts exactly (id/slug/name via the
  // `tags` table first, text[] contains as the fallback for un-migrated tag
  // values).
  let resolvedTagId: string | null = null
  let legacyTagValue: string | null = null

  if (tagValue) {
    const { data: tagRows, error: tagsErr } = await supabase
      .from('tags')
      .select('id, slug, name')
      .eq('org_id', orgId)
    if (tagsErr) return { ok: false, error: tagsErr.message, enrolled: 0 }

    const tagObj = (tagRows ?? []).find(
      (t) => t.id === tagValue || t.slug === tagValue || t.name === tagValue,
    )

    if (tagObj) {
      resolvedTagId = tagObj.id
    } else {
      legacyTagValue = tagValue
    }
  }

  // Supabase projects commonly cap a SELECT response at 1,000 rows. Page by
  // UUID key instead of silently enrolling only the first page. Tag-junction
  // pages are kept separate so we also avoid an enormous `.in(...)` URL.
  const PAGE_SIZE = 500
  let enrolled = 0

  async function insertRecipients(contactIds: string[]): Promise<string | null> {
    if (contactIds.length === 0) return null

    const rows = contactIds.map((contactId) => ({
      campaign_id: campaignId,
      contact_id: contactId,
      status: 'pending' as const,
    }))

    // Idempotent upsert: the unique index from migration 1279 is the
    // conflict target. Existing terminal rows are never reset to pending.
    const { data: inserted, error: insertErr } = await supabase
      .from('campaign_recipients')
      .upsert(rows, { onConflict: 'campaign_id,contact_id', ignoreDuplicates: true })
      .select('id')

    if (insertErr) return insertErr.message
    enrolled += inserted?.length ?? 0
    return null
  }

  async function enrollEligibleContactIds(contactIds: string[]): Promise<string | null> {
    let query = supabase
      .from('contacts')
      .select('id')
      .eq('org_id', orgId) // service role bypasses RLS: this is mandatory.
      .order('id', { ascending: true })

    query = query.in('id', contactIds)
    if (legacyTagValue) query = query.contains('tags', [legacyTagValue])

    if (channel === 'email') {
      query = query.not('email', 'is', null).neq('email', '')
    } else if (channel === 'whatsapp') {
      query = query.or('phone_e164.not.is.null,phone.not.is.null')
    }

    const { data: contacts, error: contactsErr } = await query
    if (contactsErr) return contactsErr.message
    return insertRecipients((contacts ?? []).map((contact) => contact.id))
  }

  if (resolvedTagId) {
    let lastContactId = ''
    while (true) {
      let tagQuery = supabase
        .from('contact_tags')
        .select('contact_id')
        .eq('tag_id', resolvedTagId)
        .order('contact_id', { ascending: true })
        .limit(PAGE_SIZE)
      if (lastContactId) tagQuery = tagQuery.gt('contact_id', lastContactId)

      const { data: tagRows, error: tagError } = await tagQuery
      if (tagError) return { ok: false, error: tagError.message, enrolled }
      if (!tagRows?.length) break

      const error = await enrollEligibleContactIds(tagRows.map((row) => row.contact_id))
      if (error) return { ok: false, error, enrolled }

      lastContactId = tagRows[tagRows.length - 1].contact_id
      if (tagRows.length < PAGE_SIZE) break
    }
  } else {
    let lastContactId = ''
    while (true) {
      let pageQuery = supabase
        .from('contacts')
        .select('id')
        .eq('org_id', orgId)
        .order('id', { ascending: true })
        .limit(PAGE_SIZE)
      if (lastContactId) pageQuery = pageQuery.gt('id', lastContactId)
      if (legacyTagValue) pageQuery = pageQuery.contains('tags', [legacyTagValue])
      if (channel === 'email') {
        pageQuery = pageQuery.not('email', 'is', null).neq('email', '')
      } else if (channel === 'whatsapp') {
        pageQuery = pageQuery.or('phone_e164.not.is.null,phone.not.is.null')
      }

      const { data: contacts, error: contactsErr } = await pageQuery
      if (contactsErr) return { ok: false, error: contactsErr.message, enrolled }
      if (!contacts?.length) break

      const error = await insertRecipients(contacts.map((contact) => contact.id))
      if (error) return { ok: false, error, enrolled }

      lastContactId = contacts[contacts.length - 1].id
      if (contacts.length < PAGE_SIZE) break
    }
  }

  return { ok: true, enrolled }
}
