'use client'

/**
 * EmailVerificationBadge
 *
 * Visual indicator for `contacts.email_status` / `accounts.email_status`
 * (migration 1264 — see src/lib/email-verification/{types,risk-policy}.ts).
 * Renders wherever a prospect/contact/account's email address is shown so a
 * user can see, at a glance, whether that address is safe to send to.
 *
 * Unlike IdentityStatusBadge (src/components/contacts/identity-status-badge.tsx),
 * a null/absent status is NOT hidden here — it renders a neutral "Not
 * verificado" badge, because "never checked" is meaningfully different from
 * "checked and fine" for a deliverability signal the user is about to act on.
 *
 * pt-BR labels/copy — matches the Prospects verification spec. Note the rest
 * of the Prospects/Contacts screens this badge is embedded in are in English;
 * this is a deliberate, spec-driven exception (see PR description).
 */

import * as React from 'react'
import { CheckCircle2, HelpCircle, ShieldAlert, ShieldX, XCircle } from 'lucide-react'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useOrgSettings } from '@/components/providers/org-settings-provider'
import { formatDateTime } from '@/lib/datetime'

export type EmailVerificationStatus =
  | 'ok'
  | 'catch_all'
  | 'unknown'
  | 'disposable'
  | 'invalid'
  | 'bounced'

export interface EmailVerificationBadgeProps {
  status?: string | null
  /**
   * Accepted for API parity with the email_risk column, but not currently
   * used to drive the visual — the per-status color mapping below (CONFIG)
   * already encodes risk (ok=low, catch_all/unknown=medium,
   * disposable/invalid/bounced=high per riskForStatus in risk-policy.ts), so
   * every status maps to exactly one badge appearance today.
   */
  risk?: string | null
  verifiedAt?: string | null
  provider?: string | null
  size?: 'sm' | 'md'
  showLabel?: boolean
  className?: string
}

interface StatusConfig {
  variant: BadgeProps['variant']
  label: string
  icon: React.ComponentType<{ className?: string }>
  description: string
}

const CONFIG: Record<EmailVerificationStatus, StatusConfig> = {
  ok: {
    variant: 'success',
    label: 'Verified',
    icon: CheckCircle2,
    description: 'E-mail verificado — a caixa existe e aceita mensagens.',
  },
  catch_all: {
    variant: 'warning',
    label: 'Catch-all',
    icon: ShieldAlert,
    description:
      'The domain accepts any address, so the mailbox cannot be confirmed. Sendable, with risk.',
  },
  unknown: {
    variant: 'warning',
    label: 'Unconfirmed',
    icon: HelpCircle,
    description: 'The verifier could not confirm this address (greylisting/timeout). Sendable.',
  },
  disposable: {
    variant: 'danger',
    label: 'Disposable',
    icon: ShieldX,
    description: 'Disposable/temporary email domain — blocked from sending.',
  },
  invalid: {
    variant: 'danger',
    label: 'Invalid',
    icon: XCircle,
    description: 'Invalid address — the mailbox does not exist. Blocked from sending.',
  },
  bounced: {
    variant: 'danger',
    label: 'Bounce',
    icon: XCircle,
    description: 'This address bounced — permanently blocked.',
  },
}

const UNVERIFIED: StatusConfig = {
  variant: 'outline',
  label: 'Not verified',
  icon: HelpCircle,
  description: 'This email has not been verified yet.',
}

const PROVIDER_LABEL: Record<string, string> = {
  millionverifier: 'MillionVerifier',
  neverbounce: 'NeverBounce',
  bounce: 'bounce reportado',
}

function isKnownStatus(status: string | null | undefined): status is EmailVerificationStatus {
  return Boolean(status && status in CONFIG)
}

export function EmailVerificationBadge({
  status,
  verifiedAt,
  provider,
  size = 'sm',
  showLabel = true,
  className,
}: EmailVerificationBadgeProps) {
  const { timezone } = useOrgSettings()

  const cfg = isKnownStatus(status) ? CONFIG[status] : UNVERIFIED
  const Icon = cfg.icon
  const providerLabel = provider ? (PROVIDER_LABEL[provider] ?? provider) : null

  const badge = (
    <Badge variant={cfg.variant} className={className}>
      <Icon className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      {showLabel && <span>{cfg.label}</span>}
    </Badge>
  )

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
            {badge}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[240px] whitespace-normal text-left">
          <div className="space-y-0.5">
            <p>{cfg.description}</p>
            {verifiedAt && (
              <p className="text-text-tertiary">
                Verified on {formatDateTime(verifiedAt, timezone)}
                {providerLabel ? ` via ${providerLabel}` : ''}
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
