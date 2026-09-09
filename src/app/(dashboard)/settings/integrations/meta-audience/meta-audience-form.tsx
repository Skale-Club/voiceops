'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  previewMetaAudience,
  runMetaAudience,
  saveMetaAudienceConfig,
  toggleMetaAudienceSync,
  type MetaAudienceConfigRow,
  type MetaAudienceConnectionOption,
  type MetaAudienceDashboardData,
} from './actions'

type Preview = { entities: number; emails: number; phones: number; suppressed: number; invalid: number; scope: string }

function formatDate(value: string | null) {
  if (!value) return 'Never'
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function sourceLabel(config: MetaAudienceConfigRow) {
  return config.audience_kind === 'xcraper_master' ? 'All Xcraper prospects' : 'Saved prospect segment'
}

/**
 * A connection is ready to sync when it is `usable` (status='active' AND
 * health='ok' — see docs/integrations/ads-connection-health-plan.md) AND its
 * token has not expired. Pulled out of the component so it is testable
 * without a React renderer: `configReady` and `enableReason` both key off
 * this, not off `status` alone.
 */
export function isConnectionReady(
  connection: Pick<MetaAudienceConnectionOption, 'usable'> | undefined,
  connectionExpired: boolean,
): boolean {
  return Boolean(connection && connection.usable && !connectionExpired)
}

export function MetaAudienceForm({ data }: { data: MetaAudienceDashboardData }) {
  const router = useRouter()
  const [selectedId, setSelectedId] = React.useState<string | null>(data.configs[0]?.id ?? null)
  const selected = data.configs.find((config) => config.id === selectedId) ?? null
  const launchName = data.orgName.toLowerCase() === 'skale club'
    ? 'Skale Club - Xcraper Prospects'
    : `${data.orgName} - Xcraper Prospects`
  const [name, setName] = React.useState(selected?.audience_name ?? launchName)
  const [connectionId, setConnectionId] = React.useState(selected?.ads_connection_id ?? '')
  const [kind, setKind] = React.useState<'xcraper_master' | 'prospect_segment'>(selected?.audience_kind ?? 'xcraper_master')
  const initialSegment = selected?.source_definition && typeof selected.source_definition === 'object' && !Array.isArray(selected.source_definition)
    ? selected.source_definition.prospectAudienceId
    : null
  const [segmentId, setSegmentId] = React.useState(typeof initialSegment === 'string' ? initialSegment : '')
  const [terms, setTerms] = React.useState(Boolean(selected?.terms_accepted_at))
  const [preview, setPreview] = React.useState<Preview | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)

  const connection = data.connections.find((item) => item.id === connectionId)

  /**
   * Only offer connections a real sync could actually use.
   *
   * Before this, the dropdown listed every stored row, so on 2026-09-09 it
   * offered 14 Meta accounts of which 13 had a rejected credential — picking
   * one got you as far as the server action, which correctly refused with
   * CONNECTION_INACTIVE. Failing at the end of a form is a worse way to learn
   * that than not being offered the choice.
   *
   * A connection already saved on this config stays listed even when it is no
   * longer usable: dropping it would blank the field and hide WHY the config
   * stopped working, and the status line right below already says
   * "Reconnect required before a real sync."
   */
  const selectableConnections = data.connections.filter(
    (item) => item.usable || item.id === connectionId,
  )
  const connectionExpired = !connection?.expiresAt || Date.parse(connection.expiresAt) <= Date.now()
  const segment = data.savedSegments.find((item) => item.id === segmentId)
  const configReady = Boolean(selected && isConnectionReady(connection, connectionExpired))
  const enableReason = !selected
    ? 'Save the configuration first.'
    : !connection
      ? 'Select a tenant Meta connection.'
      : !isConnectionReady(connection, connectionExpired)
        ? 'Reconnect the selected Meta account.'
        : kind === 'prospect_segment' && (!segment || segment.entityCount === 0)
          ? 'Choose a saved segment with explicit members.'
          : !selected.terms_accepted_at
            ? 'Accept the Meta Customer List terms.'
            : null

  function loadConfig(config: MetaAudienceConfigRow | null) {
    setSelectedId(config?.id ?? null)
    setName(config?.audience_name ?? launchName)
    setConnectionId(config?.ads_connection_id ?? '')
    setKind(config?.audience_kind ?? 'xcraper_master')
    const definition = config?.source_definition
    setSegmentId(definition && typeof definition === 'object' && !Array.isArray(definition) && typeof definition.prospectAudienceId === 'string'
      ? definition.prospectAudienceId
      : '')
    setTerms(Boolean(config?.terms_accepted_at))
    setPreview(null)
  }

  async function execute(label: string, action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(label)
    try {
      const result = await action()
      if (!result.ok) {
        toast.error(result.error ?? 'The operation failed.')
        return false
      }
      router.refresh()
      return true
    } finally {
      setBusy(null)
    }
  }

  async function save() {
    const ok = await execute('save', () => saveMetaAudienceConfig({
      id: selected?.id,
      ads_connection_id: connectionId,
      audience_name: name,
      audience_kind: kind,
      saved_segment_id: kind === 'prospect_segment' ? segmentId : null,
      terms_accepted: terms,
    }))
    if (ok) toast.success(selected ? 'Audience updated.' : 'Audience created.')
  }

  async function loadPreview() {
    if (!selected) return
    setBusy('preview')
    try {
      const result = await previewMetaAudience(selected.id)
      if (!result.ok || !result.preview) return toast.error(result.error ?? 'Preview failed.')
      setPreview(result.preview)
    } finally {
      setBusy(null)
    }
  }

  async function run(dryRun: boolean) {
    if (!selected) return
    const key = dryRun ? 'dry' : 'sync'
    const ok = await execute(key, () => runMetaAudience(selected.id, dryRun))
    if (ok) toast.success(dryRun ? 'Dry run completed.' : 'Audience reconciled successfully.')
  }

  const runs = selected ? data.runs.filter((run) => run.audienceConfigId === selected.id) : []

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="space-y-3">
        <Button variant="secondary" className="w-full justify-start" onClick={() => loadConfig(null)}>
          <Plus className="h-4 w-4" /> New audience
        </Button>
        <div className="overflow-hidden rounded-[12px] border border-border bg-bg-secondary divide-y divide-border-subtle">
          {data.configs.length === 0 ? (
            <p className="p-4 text-sm text-text-tertiary">No Meta audiences configured.</p>
          ) : data.configs.map((config) => (
            <button
              key={config.id}
              type="button"
              onClick={() => loadConfig(config)}
              className={`w-full p-4 text-left transition-colors ${selectedId === config.id ? 'bg-accent/10' : 'hover:bg-bg-tertiary/50'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-text-primary">{config.audience_name}</span>
                <Badge variant={config.sync_enabled ? 'default' : 'secondary'}>{config.operational_status}</Badge>
              </div>
              <p className="mt-1 text-xs text-text-tertiary">{sourceLabel(config)}</p>
            </button>
          ))}
        </div>
      </aside>

      <main className="space-y-6">
        <section className="space-y-5 rounded-[12px] border border-border bg-bg-secondary p-5">
          <div>
            <h2 className="text-base font-semibold text-text-primary">Audience setup</h2>
            <p className="mt-1 text-sm text-text-tertiary">Choose one tenant connection and an explicit prospect scope.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Audience name</Label>
              <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label>Meta connection and ad account</Label>
              <Select value={connectionId} onValueChange={setConnectionId}>
                <SelectTrigger><SelectValue placeholder="Select a Meta account" /></SelectTrigger>
                <SelectContent>
                  {selectableConnections.map((item) => (
                    <SelectItem key={item.id} value={item.id}>{item.adAccountName} · {item.adAccountId}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {connection && (
                <p className={`text-xs ${isConnectionReady(connection, connectionExpired) ? 'text-emerald-600' : 'text-destructive'}`}>
                  {isConnectionReady(connection, connectionExpired)
                    ? `Connected · token expires ${formatDate(connection.expiresAt)}`
                    : 'Reconnect required before a real sync.'}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Source scope</Label>
              <Select value={kind} onValueChange={(value) => setKind(value as typeof kind)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="xcraper_master">All Xcraper prospects</SelectItem>
                  <SelectItem value="prospect_segment">Saved prospect segment</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {kind === 'prospect_segment' && (
            <div className="space-y-1.5">
              <Label>Saved segment</Label>
              <Select value={segmentId} onValueChange={setSegmentId}>
                <SelectTrigger><SelectValue placeholder="Choose a saved segment" /></SelectTrigger>
                <SelectContent>
                  {data.savedSegments.map((item) => (
                    <SelectItem key={item.id} value={item.id} disabled={item.entityCount === 0}>
                      {item.name} · {item.entityCount} members
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex items-start gap-3 rounded-[10px] border border-border bg-bg-tertiary/30 p-4">
            <Checkbox
              id="meta-terms"
              checked={terms}
              onCheckedChange={(value) => setTerms(Boolean(value))}
              disabled={Boolean(selected?.terms_accepted_at)}
            />
            <div>
              <label htmlFor="meta-terms" className="text-sm font-medium text-text-primary">I confirm our right to use this customer data for advertising.</label>
              <p className="mt-1 text-xs text-text-tertiary">
                Required for real writes under the Meta Customer List Custom Audience terms. Preview and dry-run remain available first.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={busy !== null || !name.trim() || !connectionId || (kind === 'prospect_segment' && !segmentId)}>
              {busy === 'save' && <Loader2 className="h-4 w-4 animate-spin" />}
              {selected ? 'Save changes' : 'Create audience'}
            </Button>
            {selected && (
              <Button variant="secondary" onClick={loadPreview} disabled={busy !== null}>
                <Eye className="h-4 w-4" /> Preview
              </Button>
            )}
          </div>
        </section>

        {selected && (
          <section className="space-y-4 rounded-[12px] border border-border bg-bg-secondary p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-text-primary">Preflight and operations</h2>
                <p className="mt-1 text-sm text-text-tertiary">No email, phone, hash, token, or remote audience ID is displayed.</p>
              </div>
              <Badge variant={selected.sync_enabled ? 'default' : 'secondary'}>{selected.sync_enabled ? 'Enabled' : 'Paused'}</Badge>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {preview ? [
                ['Eligible', preview.entities], ['Email keys', preview.emails], ['Phone keys', preview.phones],
                ['Suppressed', preview.suppressed], ['Invalid', preview.invalid],
              ].map(([label, value]) => (
                <div key={label} className="rounded-[10px] border border-border-subtle bg-bg-tertiary/30 p-3">
                  <p className="text-xs text-text-tertiary">{label}</p>
                  <p className="mt-1 text-xl font-semibold text-text-primary">{value}</p>
                </div>
              )) : (
                <p className="text-sm text-text-tertiary sm:col-span-2 xl:col-span-5">Run Preview to calculate safe membership counts.</p>
              )}
            </div>

            {enableReason ? (
              <div className="flex items-center gap-2 rounded-[10px] border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4" /> {enableReason}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-emerald-600">
                <ShieldCheck className="h-4 w-4" /> Ready for tenant-scoped Meta writes.
              </div>
            )}

            {selected.last_error_code && (
              <div className="rounded-[10px] border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <strong>{selected.last_error_code}</strong> · {selected.last_error_message ?? 'Reconnect or review the configuration.'}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => run(true)} disabled={busy !== null || !configReady}>
                {busy === 'dry' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Dry run
              </Button>
              <Button
                onClick={() => execute('toggle', () => toggleMetaAudienceSync(selected.id, !selected.sync_enabled))}
                disabled={busy !== null || (!selected.sync_enabled && Boolean(enableReason))}
                variant={selected.sync_enabled ? 'outline' : 'default'}
              >
                {selected.sync_enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {selected.sync_enabled ? 'Pause' : 'Enable'}
              </Button>
              <Button onClick={() => run(false)} disabled={busy !== null || Boolean(enableReason) || !selected.sync_enabled}>
                {busy === 'sync' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Sync now
              </Button>
            </div>
            <p className="text-xs text-text-tertiary">Last successful sync: {formatDate(selected.last_synced_at)}</p>
          </section>
        )}

        {selected && (
          <section className="overflow-hidden rounded-[12px] border border-border bg-bg-secondary">
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-base font-semibold text-text-primary">Safe run history</h2>
            </div>
            {runs.length === 0 ? (
              <p className="p-5 text-sm text-text-tertiary">No runs yet.</p>
            ) : (
              <div className="divide-y divide-border-subtle">
                {runs.map((run) => (
                  <div key={run.id} className="grid gap-2 px-5 py-3 text-sm sm:grid-cols-[130px_1fr_auto] sm:items-center">
                    <div><Badge variant={run.status === 'succeeded' ? 'default' : 'secondary'}>{run.dryRun ? 'dry run' : run.status}</Badge></div>
                    <div className="text-text-secondary">
                      Target {run.targetCount} · add {run.addCount} · remove {run.removeCount} · suppressed {run.suppressedCount} · invalid {run.invalidCount}
                      {run.errorCode ? <p className="text-xs text-destructive">{run.errorCode}: {run.errorMessage}</p> : null}
                    </div>
                    <time className="text-xs text-text-tertiary">{formatDate(run.completedAt ?? run.createdAt)}</time>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  )
}
