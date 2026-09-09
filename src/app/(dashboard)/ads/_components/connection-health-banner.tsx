import Link from 'next/link'
import { AlertTriangle, PlugZap } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { daysUntilExpiry, EXPIRY_WARNING_DAYS } from '@/lib/ads/connection-health'

export type ConnectionHealthRow = {
  ad_account_id: string
  ad_account_name: string | null
  status: string
  health: string
  connection_error: string | null
  token_expires_at: string | null
}

const PLATFORM_LABEL: Record<string, string> = {
  meta: 'Meta',
  google: 'Google Ads',
}

/**
 * The banner's "this connection is broken" predicate, pulled out so it is
 * directly testable (including from the round-trip regression test — see
 * tests/ads-connection-health.test.ts) without rendering the component.
 * `health` is the sole signal as of migration 1300 — `status` is
 * selection-only and no longer ever holds 'error'.
 */
export function isBroken(connection: Pick<ConnectionHealthRow, 'health'>): boolean {
  return connection.health === 'error'
}

/**
 * Surfaces credentials that are broken or about to break.
 *
 * Meta access tokens expire roughly 60 days after the grant, and Meta also
 * invalidates them on a password change or permission revocation. Nothing used
 * to tell the operator: reports simply started returning 502s, and the CAPI
 * worker quietly lost its fallback token. This turns that into a visible,
 * actionable state before the account goes dark.
 */
export function ConnectionHealthBanner({
  platform,
  connections,
  connectHref,
}: {
  platform: 'meta' | 'google'
  connections: ConnectionHealthRow[]
  connectHref: string
}) {
  const broken = connections.filter(isBroken)

  const expiring = connections.filter((c) => {
    if (isBroken(c)) return false
    const days = daysUntilExpiry(c.token_expires_at)
    return days !== null && days > 0 && days <= EXPIRY_WARNING_DAYS
  })

  if (broken.length === 0 && expiring.length === 0) return null

  const label = PLATFORM_LABEL[platform] ?? platform
  const hasBroken = broken.length > 0
  const affected = hasBroken ? broken : expiring

  const names = affected
    .map((c) => c.ad_account_name ?? c.ad_account_id)
    .slice(0, 3)
    .join(', ')
  const more = affected.length > 3 ? ` and ${affected.length - 3} more` : ''

  // A dead credential blocks reporting outright; an expiring one does not yet.
  // Different severity, different colour, same call to action.
  const tone = hasBroken
    ? 'border-danger/30 bg-danger/10 text-danger'
    : 'border-warning/30 bg-warning/10 text-warning'

  return (
    <div className={`flex flex-wrap items-start gap-3 rounded-lg border px-4 py-3 ${tone}`} role="alert">
      {hasBroken ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      ) : (
        <PlugZap className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      )}

      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-[13px] font-medium">
          {hasBroken
            ? `${label} reporting is paused for ${names}${more}.`
            : `${label} access for ${names}${more} expires soon.`}
        </p>
        <p className="text-[12px] opacity-90">
          {affected[0]?.connection_error ??
            (hasBroken
              ? 'The stored access token was rejected. Reconnect the account to resume reporting.'
              : 'Reconnect now to avoid an interruption in reporting.')}
        </p>
      </div>

      <Button size="sm" variant={hasBroken ? 'default' : 'outline'} asChild>
        <Link href={connectHref}>Reconnect</Link>
      </Button>
    </div>
  )
}
