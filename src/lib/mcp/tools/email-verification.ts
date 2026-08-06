// MCP tool: email_verification_status — read-only poll of the verification
// providers' credit balances plus a breakdown of prospects by email_status
// in the calling org. This is what Hermes polls for its low-credit alert
// cron (src/lib/email-verification/credits.ts never throws, so this tool
// always returns a usable payload even if both providers are down).

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { getVerificationCreditStatus } from '@/lib/email-verification/credits'
import type { EmailStatus } from '@/lib/email-verification/types'
import type { McpToolDef } from '../tool-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  return createServiceRoleClient()
}

const EMAIL_STATUSES: EmailStatus[] = ['ok', 'catch_all', 'unknown', 'disposable', 'invalid', 'bounced']

async function countByStatus(orgId: string, table: 'contacts' | 'accounts'): Promise<Record<string, number>> {
  const counts: Record<string, number> = { not_verified: 0 }
  for (const status of EMAIL_STATUSES) counts[status] = 0

  const [notVerified, ...byStatus] = await Promise.all([
    db().from(table).select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('lifecycle_stage', 'prospect').is('email_status', null),
    ...EMAIL_STATUSES.map((status) =>
      db().from(table).select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('lifecycle_stage', 'prospect').eq('email_status', status),
    ),
  ])

  counts.not_verified = notVerified.count ?? 0
  EMAIL_STATUSES.forEach((status, i) => {
    counts[status] = byStatus[i].count ?? 0
  })
  return counts
}

export const emailVerificationTools: McpToolDef[] = [
  {
    name: 'email_verification_status',
    title: 'Email verification credit + status overview',
    description:
      'Read-only status check for the email-verification chain (MillionVerifier + NeverBounce): each provider\'s configured/credits/ok state, whether both are effectively out of credits, and a breakdown of this org\'s prospects (contacts + accounts) by email_status. Poll this before a bulk outreach push, or on a schedule to alert on low credits.',
    area: 'general_xphere',
    inputSchema: z.object({}).strict(),
    handler: async (_input, { auth }) => {
      const [credits, contactsByStatus, accountsByStatus] = await Promise.all([
        getVerificationCreditStatus(),
        countByStatus(auth.orgId, 'contacts'),
        countByStatus(auth.orgId, 'accounts'),
      ])

      const combined: Record<string, number> = { not_verified: contactsByStatus.not_verified + accountsByStatus.not_verified }
      for (const status of EMAIL_STATUSES) combined[status] = contactsByStatus[status] + accountsByStatus[status]

      return {
        credits,
        prospects_by_email_status: {
          contacts: contactsByStatus,
          accounts: accountsByStatus,
          combined,
        },
        warning: !credits.anyAvailable
          ? 'Both verification providers are unavailable (unconfigured or out of credits) — outreach sends will be blocked until this is fixed.'
          : credits.lowCredit
            ? `Verification credit balance is at or below the low-credit threshold (${credits.lowCreditThreshold}).`
            : undefined,
      }
    },
  },
]
