import { buildWebsiteInsights, hasWebsiteInsights, type WebsiteInsights } from '@/services/website-analyzer/outreach-insights'

type QueryClient = {
  from(table: string): unknown
}

/**
 * Load the latest completed analysis per account under an explicit tenant
 * boundary. Existing analyses are derived on read until the next analyzer run
 * persists the multilingual map introduced by migration 1272.
 */
export async function loadWebsiteInsightsForAccounts(
  client: QueryClient,
  orgId: string,
  accountIds: string[],
): Promise<Map<string, WebsiteInsights>> {
  const uniqueIds = [...new Set(accountIds)]
  if (uniqueIds.length === 0) return new Map()

  // website_analyses predates the generated Database type; keep the cast isolated
  // here and retain explicit org_id + account_id filters because callers may use
  // the service-role client.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any)
    .from('website_analyses')
    .select('account_id, url, services, raw_evidence, outreach_insights, created_at')
    .eq('org_id', orgId)
    .in('account_id', uniqueIds)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })

  if (error) throw new Error('Could not load website insights for Xmail')
  const result = new Map<string, WebsiteInsights>()
  for (const row of data ?? []) {
    if (result.has(row.account_id)) continue
    result.set(
      row.account_id,
      hasWebsiteInsights(row.outreach_insights)
        ? row.outreach_insights
        : buildWebsiteInsights({ url: row.url, services: row.services, rawEvidence: row.raw_evidence }),
    )
  }
  return result
}
