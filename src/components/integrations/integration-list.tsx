'use client'

// SEED-042 | IntegrationList
// Single grouped list rendered from INTEGRATION_REGISTRY. Each row opens
// the unified IntegrationSheet.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronRight, Target } from 'lucide-react'

import { StatusPill } from '@/components/design-system/status-pill'
import { cn } from '@/lib/utils'

import { IntegrationLogo } from './integration-logo'
import { IntegrationSheet } from './integration-sheet'
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  INTEGRATION_REGISTRY,
  getDefinitionByProvider,
  type IntegrationDefinition,
  type SavedIntegration,
} from '@/lib/integrations/registry'

interface IntegrationListProps {
  /** Indexed by provider id. */
  saved: Record<string, SavedIntegration>
  /** Optional provider id from `?open=...` to open on mount. */
  initialOpen?: string
}

type Status = 'active' | 'connected' | 'inactive' | 'not_connected'

function statusFor(def: IntegrationDefinition, row: SavedIntegration | undefined): Status {
  if (!row) return 'not_connected'
  if (!def.canActivate) return 'connected'
  return row.is_active ? 'active' : 'inactive'
}

const STATUS_LABEL: Record<Status, string> = {
  active: 'Active',
  connected: 'Connected',
  inactive: 'Inactive',
  not_connected: 'Not connected',
}

const STATUS_TONE: Record<Status, 'success' | 'idle'> = {
  active: 'success',
  connected: 'success',
  inactive: 'idle',
  not_connected: 'idle',
}

export function IntegrationList({ saved, initialOpen }: IntegrationListProps) {
  const router = useRouter()
  const params = useSearchParams()
  const [openId, setOpenId] = useState<string | null>(null)

  // Open from `?open=` query param on first render.
  useEffect(() => {
    if (initialOpen && getDefinitionByProvider(initialOpen)) {
      setOpenId(initialOpen)
    }
  }, [initialOpen])

  const grouped = useMemo(() => {
    // Zernio and ManyChat are mutually exclusive inbox providers.
    // When one is active the other is hidden — both can't serve the inbox simultaneously.
    const zernioActive = saved['zernio']?.is_active === true
    const manychatActive = saved['manychat']?.is_active === true

    const out: Record<string, IntegrationDefinition[]> = {}
    for (const def of INTEGRATION_REGISTRY) {
      // 'whatsapp_cloud' is exposed as a tab inside the unified WhatsApp card,
      // not as its own row. The registry entry is kept so workflow specs and
      // active-integration detection still resolve it.
      if (def.id === 'whatsapp_cloud') continue
      // 'meta' is superseded by Zernio for Instagram/Facebook inbox.
      // Existing data is preserved; new connections are disabled.
      if (def.id === 'meta') continue
      // Mutual exclusion: hide ManyChat when Zernio is active, and vice versa.
      if (def.id === 'manychat' && zernioActive) continue
      if (def.id === 'zernio' && manychatActive) continue
      out[def.category] ??= []
      out[def.category].push(def)
    }
    return out
  }, [saved])

  const activeDef = openId ? getDefinitionByProvider(openId) ?? null : null
  const activeRow = openId ? saved[openId] : undefined

  function handleOpenChange(next: boolean) {
    if (!next) {
      setOpenId(null)
      if (params.get('open')) {
        const url = new URL(window.location.href)
        url.searchParams.delete('open')
        router.replace(url.pathname + (url.search ? url.search : ''), { scroll: false })
      }
    }
  }

  return (
    <>
      <div className="space-y-6">
        <section className="space-y-2">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-tertiary">Advertising</h3>
          <Link
            href="/settings/integrations/meta-audience"
            className="group flex w-full items-center gap-4 rounded-[12px] border border-border bg-bg-secondary px-4 py-3 text-left transition-colors hover:bg-bg-tertiary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-blue-600 text-white">
              <Target className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium text-text-primary">Meta Custom Audiences</p>
              <p className="mt-0.5 line-clamp-1 text-[12px] text-text-tertiary">Sync hashed Xcraper prospects to tenant-owned ad audiences.</p>
            </div>
            <ChevronRight className="h-4 w-4 text-text-tertiary transition-transform group-hover:translate-x-0.5" />
          </Link>
        </section>
        {CATEGORY_ORDER.map((cat) => {
          const items = grouped[cat] ?? []
          if (items.length === 0) return null
          return (
            <section key={cat} className="space-y-2">
              <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
                {CATEGORY_LABEL[cat]}
              </h3>
              <div className="overflow-hidden rounded-[12px] border border-border bg-bg-secondary divide-y divide-border-subtle">
                {items.map((def) => {
                  const row = saved[def.id]
                  const status = statusFor(def, row)
                  return (
                    <button
                      key={def.id}
                      type="button"
                      onClick={() => setOpenId(def.id)}
                      className={cn(
                        'group flex w-full items-center gap-4 px-4 py-3 text-left transition-colors',
                        'hover:bg-bg-tertiary/50 focus-visible:bg-bg-tertiary/50 focus-visible:outline-none',
                      )}
                    >
                      <IntegrationLogo logo={def.logo} name={def.name} size={36} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-medium text-text-primary">
                          {def.name}
                        </p>
                        <p className="mt-0.5 line-clamp-1 text-[12px] text-text-tertiary">
                          {def.description}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        {row && (
                          <span className="hidden font-mono text-[11px] text-text-tertiary sm:inline">
                            {row.masked_api_key}
                          </span>
                        )}
                        <StatusPill tone={STATUS_TONE[status]}>
                          {STATUS_LABEL[status]}
                        </StatusPill>
                        <ChevronRight className="h-4 w-4 -translate-x-0.5 text-text-tertiary opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100" />
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>

      <IntegrationSheet
        open={openId !== null}
        onOpenChange={handleOpenChange}
        definition={activeDef}
        existing={activeRow}
      />
    </>
  )
}
