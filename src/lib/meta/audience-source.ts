/**
 * Single definition of "who belongs to a Meta audience".
 *
 * This lived in three places that had to agree but had no way to enforce it:
 * `isSelected` in audience-members.ts (projection), `asSourceDefinition` in
 * audience-dirty.ts (scheduling), and `sourceDefinition` in
 * audience-reconcile.ts (the database query). A scope that disagreed between
 * them would schedule a sync that then projected a different member set, or
 * quietly skip entities the query never fetched. One implementation removes
 * that class of bug.
 *
 * `xcraper_master` selects scraped prospects. It matches a SET of source types
 * because scraping has shipped under more than one: `xcraper` (the current
 * push in xcraper/backend/src/services/xphere.ts) and `google-maps` (an
 * earlier path). Both are the same act of scraping a business off Google Maps,
 * and an audience of "everyone we scraped" has to contain both.
 */

export const DEFAULT_SCRAPE_SOURCE_TYPES = ['xcraper', 'google-maps'] as const

export type AudienceSourceDefinition =
  | { kind: 'xcraper_master'; sourceTypes: string[] }
  | { kind: 'prospect_segment'; entityKeys: string[] }

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : []
}

/**
 * Resolve the source types a stored `xcraper_master` definition selects.
 *
 * An explicit singular `sourceType` is honoured EXACTLY as configured and is
 * never widened: it is a deliberate narrowing someone saved (a scope pinned to
 * one provider), and silently adding source types to it would change an
 * existing audience's membership behind their back. Only an unset definition
 * falls back to every known scrape source.
 */
function readSourceTypes(record: Record<string, unknown>): string[] {
  const plural = strings(record.sourceTypes)
  if (plural.length > 0) return [...new Set(plural)]

  const singular = record.sourceType
  if (typeof singular === 'string' && singular.trim() !== '') return [singular]

  return [...DEFAULT_SCRAPE_SOURCE_TYPES]
}

/** Normalize a persisted `source_definition` JSON column into a usable definition. */
export function normalizeAudienceSourceDefinition(
  audienceKind: string | null | undefined,
  raw: unknown,
): AudienceSourceDefinition {
  const record = asRecord(raw)

  if (audienceKind === 'prospect_segment') {
    return { kind: 'prospect_segment', entityKeys: strings(record.entityKeys) }
  }

  return { kind: 'xcraper_master', sourceTypes: readSourceTypes(record) }
}

/** Source types to filter on, or null when the definition does not select by source. */
export function audienceSourceTypes(definition: AudienceSourceDefinition): string[] | null {
  return definition.kind === 'xcraper_master' ? definition.sourceTypes : null
}

/** Whether an entity's `source_type` falls inside a source-selecting definition. */
export function matchesAudienceSourceType(
  sourceType: string | null | undefined,
  definition: AudienceSourceDefinition,
): boolean {
  if (definition.kind !== 'xcraper_master') return false
  return typeof sourceType === 'string' && definition.sourceTypes.includes(sourceType)
}
