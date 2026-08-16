function isNonEmpty(value: unknown): boolean {
  return value !== null && value !== undefined && (typeof value !== 'string' || value.trim().length > 0)
}

export function mergePresentJson(existing: unknown, incoming: unknown): Record<string, unknown> {
  const existingRecord = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? existing as Record<string, unknown>
    : {}
  const incomingRecord = incoming && typeof incoming === 'object' && !Array.isArray(incoming)
    ? incoming as Record<string, unknown>
    : {}
  const merged: Record<string, unknown> = { ...existingRecord }
  for (const [key, value] of Object.entries(incomingRecord)) {
    if (!isNonEmpty(value)) continue
    const current = merged[key]
    if (
      value && typeof value === 'object' && !Array.isArray(value) &&
      current && typeof current === 'object' && !Array.isArray(current)
    ) {
      merged[key] = mergePresentJson(current, value)
    } else {
      merged[key] = typeof value === 'string' ? value.trim() : value
    }
  }
  return merged
}

const WEB_PRESENCE_CUSTOM_FIELDS = [
  'website',
  'has_owned_website',
  'web_presence_type',
  'web_presence_url',
  'web_presence_platform',
  'booking_platform',
  'booking_url',
] as const

/** Presence snapshots honor explicit null so re-imports can clear stale data. */
export function mergeProspectCustomFields(existing: unknown, incoming: unknown): Record<string, unknown> {
  const merged = mergePresentJson(existing, incoming)
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return merged
  const source = incoming as Record<string, unknown>
  for (const key of WEB_PRESENCE_CUSTOM_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue
    const value = source[key]
    merged[key] = typeof value === 'string' ? value.trim() || null : value ?? null
  }
  return merged
}

