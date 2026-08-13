// Batch lookup of the prospecting run that sourced each prospect, so pushes to
// Xmail can carry `customFields.source_run_id` and Xmail can attribute
// outreach outcomes (opens, replies, conversions) back to what it cost to
// source the lead (see xmailRegisterExternalRun in src/lib/xmail/client.ts).
//
// The linkage already exists: POST /api/v1/prospects's recordImport() writes
// a prospect_engagement_events row (event_type: 'imported', payload:
// { source_run_id }) for every prospect it creates/updates. This reads that
// back — no schema change, no new column.
//
// IMPORTANT: `payload.source_run_id` is `prospect_sources.id` — a
// Xphere-internal UUID. That is NOT what Xmail keys its run on. Xmail
// registers the run under `prospect_sources.external_run_id` (the xcraper
// searchId — see external-run-mapping.ts, which passes `externalRunId` into
// `prospecting_runs.idempotency_key` on the Xmail side). So this function
// resolves each entity's `prospect_sources.id` through to its
// `external_run_id` and returns THAT, in one additional batched query — the
// internal UUID never leaves this file. If a `prospect_sources` row has no
// `external_run_id` (non-xcraper source, or a run that predates external-run
// registration), the entity is omitted entirely: a value that can never join
// on the Xmail side is worse than an absent one, since it looks like valid
// attribution and silently never matches.

type QueryClient = {
  from(table: string): unknown
}

/**
 * For a batch of prospect entity ids (contacts and/or accounts — the events
 * table is shared across both), resolve each entity's most recent 'imported'
 * engagement event, follow its `payload.source_run_id` (a `prospect_sources.id`)
 * through to that source's `external_run_id`, and return THAT value — the
 * identifier Xmail's `prospecting_runs.idempotency_key` was registered under
 * (see external-run-mapping.ts). Two queries total for the whole batch: one
 * for the events, one batched lookup of every distinct source id referenced.
 *
 * Entities with no 'imported' event, whose event has no source_run_id, or
 * whose resolved `prospect_sources` row has a null/empty `external_run_id`,
 * are simply absent from the returned map — never defaulted to the internal
 * source id, since that would silently never match on the Xmail side.
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

  // entity_id -> prospect_sources.id (internal), most-recent 'imported' event only.
  const entityToSourceId = new Map<string, string>()
  for (const row of (data ?? []) as Array<{ entity_id: string; payload: unknown }>) {
    // Rows are ordered most-recent-first, so the first time we see an
    // entity_id is its most recent 'imported' event — skip later (older)
    // duplicates for the same entity.
    if (entityToSourceId.has(row.entity_id)) continue
    const payload = row.payload && typeof row.payload === 'object' ? (row.payload as Record<string, unknown>) : null
    const sourceId = payload && typeof payload.source_run_id === 'string' ? payload.source_run_id : null
    if (sourceId) entityToSourceId.set(row.entity_id, sourceId)
  }

  const result = new Map<string, string>()
  if (entityToSourceId.size === 0) return result

  const uniqueSourceIds = [...new Set(entityToSourceId.values())]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: sourceRows, error: sourceError } = await (client as any)
    .from('prospect_sources')
    .select('id, external_run_id')
    .eq('org_id', orgId)
    .in('id', uniqueSourceIds)

  if (sourceError) throw new Error('Could not load source runs for Xmail')

  // prospect_sources.id -> external_run_id (only when present/non-empty).
  const sourceIdToExternalRunId = new Map<string, string>()
  for (const row of (sourceRows ?? []) as Array<{ id: string; external_run_id: string | null }>) {
    const externalRunId = typeof row.external_run_id === 'string' ? row.external_run_id.trim() : ''
    if (externalRunId) sourceIdToExternalRunId.set(row.id, externalRunId)
  }

  for (const [entityId, sourceId] of entityToSourceId) {
    const externalRunId = sourceIdToExternalRunId.get(sourceId)
    if (externalRunId) result.set(entityId, externalRunId)
  }

  return result
}
