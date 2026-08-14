/**
 * How a prospect should first be contacted, derived from the identifiers we
 * actually hold.
 *
 * Xcraper computes this rule when it pushes (see
 * xcraper/backend/src/services/xphere.ts), but the ingestion API only ever
 * copied whatever the caller sent. Pushes that predate the field — the
 * `google-maps` source type — therefore left `recommended_channel` NULL, which
 * is exactly the column the prospects list needs in order to hand you a
 * call-ready segment. Deriving it server-side makes every ingestion path
 * correct, not just the one client that remembers to send it.
 *
 * A caller-supplied value always wins: this only fills a gap, it never
 * overrules an explicit decision.
 */

export type DerivedRecommendedChannel = 'email' | 'call' | null

function present(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

export interface ProspectIdentifiers {
  email?: string | null
  phone?: string | null
}

/** Email beats phone; no identifier means no channel worth recommending. */
export function deriveRecommendedChannel(identifiers: ProspectIdentifiers): DerivedRecommendedChannel {
  if (present(identifiers.email)) return 'email'
  if (present(identifiers.phone)) return 'call'
  return null
}

/**
 * Resolve the value to persist on create.
 *
 * `explicit` is the request payload's field: `undefined` means "not supplied"
 * (derive), while an explicit `null` means the caller deliberately cleared it
 * and is preserved as-is.
 */
export function resolveRecommendedChannel<T extends string>(
  explicit: T | null | undefined,
  identifiers: ProspectIdentifiers,
): T | DerivedRecommendedChannel {
  return explicit !== undefined ? explicit : deriveRecommendedChannel(identifiers)
}

/**
 * An account carries no email column — the scraped address lives in
 * `custom_fields.email`, the same place the Meta audience projection reads it
 * from (`accountEmail` in lib/meta/audience-members.ts).
 */
export function accountEmailFromCustomFields(customFields: unknown): string | null {
  if (!customFields || typeof customFields !== 'object' || Array.isArray(customFields)) return null
  const value = (customFields as Record<string, unknown>).email
  return typeof value === 'string' ? value : null
}
