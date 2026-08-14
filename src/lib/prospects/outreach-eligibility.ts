type QueryResult = {
  data: Array<{ email: string | null }> | null
  error: unknown
}

type SuppressionClient = {
  from(table: 'email_unsubscribes'): {
    select(columns: 'email'): {
      eq(column: 'org_id', value: string): {
        in(column: 'email', values: string[]): PromiseLike<QueryResult>
      }
    }
  }
}

export type OutreachChannel = 'email' | 'sms'

export function normalizeOutreachEmail(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase()
  return normalized && normalized.includes('@') ? normalized : null
}

export function isDndBlocked(
  enabled: boolean | null | undefined,
  channels: string[] | null | undefined,
  channel: OutreachChannel,
): boolean {
  if (!enabled) return false
  const normalized = new Set((channels ?? []).map((value) => value.trim().toLowerCase()))
  return normalized.has('all') || normalized.has(channel)
}

export async function loadEmailSuppressions(
  client: SuppressionClient,
  orgId: string,
  emails: Array<string | null | undefined>,
): Promise<Set<string>> {
  const normalized = [...new Set(emails.map(normalizeOutreachEmail).filter((email): email is string => Boolean(email)))]
  if (normalized.length === 0) return new Set()

  const suppressed = new Set<string>()
  const chunkSize = 200
  for (let offset = 0; offset < normalized.length; offset += chunkSize) {
    const chunk = normalized.slice(offset, offset + chunkSize)
    const { data, error } = await client
      .from('email_unsubscribes')
      .select('email')
      .eq('org_id', orgId)
      .in('email', chunk)
    if (error) throw new Error('Could not verify email suppression status')
    for (const row of data ?? []) {
      const email = normalizeOutreachEmail(row.email)
      if (email) suppressed.add(email)
    }
  }
  return suppressed
}
