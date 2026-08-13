// Batch lookup of the prospecting run that sourced each prospect, so pushes to
// Xmail can carry `customFields.source_run_id` and Xmail can attribute
// outreach outcomes (opens, replies, conversions) back to what it cost to
// source the lead (see xmailRegisterExternalRun in src/lib/xmail/client.ts).
//
// The linkage already exists: POST /api/v1/prospects's recordImport() writes
// a prospect_engagement_events row (event_type: 'imported', payload:
// { source_run_id }) for every prospect it creates/updates. This reads that
// back — no schema change, no new column.

type QueryClient = {
  from(table: string): unknown
}

/**
 * For a batch of prospect entity ids (contacts and/or accounts — the events
 * table is shared across both), resolve each entity's most recent 'imported'
 * engagement event and pull `payload.source_run_id` out of it. One query for
 * the whole batch. Entities with no 'imported' event, or whose event has no
 * source_run_id (e.g. ingested without a prospect_sources run), are simply
 * absent from the returned map.
 */
export async function loadSourceRunIdsForEntities(
  client: QueryClient,
  orgId: string,
  entityIds: string[],
): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(entityIds)]
  if (uniqueIds.length === 0) return new Map()

  // prospect_engagement_events predates the generated Database type in some
  // deployments; keep the cast isolated here, same as website-insights.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any)
    .from('prospect_engagement_events')
    .select('entity_id, payload, created_at')
    .eq('org_id', orgId)
    .eq('event_type', 'imported')
    .in('entity_id', uniqueIds)
    .order('created_at', { ascending: false })

  if (error) throw new Error('Could not load source runs for Xmail')

  const result = new Map<string, string>()
  for (const row of (data ?? []) as Array<{ entity_id: string; payload: unknown }>) {
    // Rows are ordered most-recent-first, so the first time we see an
    // entity_id is its most recent 'imported' event — skip later (older)
    // duplicates for the same entity.
    if (result.has(row.entity_id)) continue
    const payload = row.payload && typeof row.payload === 'object' ? (row.payload as Record<string, unknown>) : null
    const runId = payload && typeof payload.source_run_id === 'string' ? payload.source_run_id : null
    if (runId) result.set(row.entity_id, runId)
  }
  return result
}
