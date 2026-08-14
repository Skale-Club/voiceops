// Cost attribution for POST /api/v1/prospects (src/app/api/v1/prospects/route.ts).
//
// Kept out of route.ts on purpose: Next.js's App Router route typegen only
// allows a fixed set of named exports (GET/POST/etc., config, runtime, ...)
// from a route.ts file — anything else (like a pure helper exported for unit
// testing) fails `tsc` against the generated `.next/types/.../route.ts`.
//
// registerExternalRunWithXmail() is fire-and-forget by design: an
// unreachable or unconfigured Xmail must never delay or break ingestion (see
// CLAUDE.md's outreach section — ingestion succeeding cannot depend on Xmail
// being reachable).

import { isXmailConfigured, xmailRegisterExternalRun, type XmailRegisterExternalRunParams } from './client'

/** The subset of the batch's `source` block this mapping needs. */
export interface ExternalRunSourceMeta {
  label?: string
  metadata?: Record<string, unknown>
}

/**
 * Pure mapping from a batch's source metadata + this call's counts to the
 * params `xmailRegisterExternalRun` expects. Exported for unit testing.
 * `source.metadata` is an open `z.record(z.string(), z.unknown())` — every
 * field pulled from it is validated defensively; a wrong-typed value (e.g. a
 * non-numeric `cost_usd`) is dropped, never coerced.
 *
 * Returns null when there's nothing to register: only xcraper runs carry a
 * billable external cost today, and there's no run to attribute without an
 * external_run_id.
 */
export function buildExternalRunRegistration(
  source: ExternalRunSourceMeta,
  sourceType: string,
  externalRunId: string | null,
  prospectCount: number,
  importedCount: number,
): XmailRegisterExternalRunParams | null {
  if (sourceType !== 'xcraper' || !externalRunId) return null

  const meta = source.metadata ?? {}
  const metaString = (key: string): string | undefined => {
    const v = meta[key]
    return typeof v === 'string' && v.trim() ? v.trim() : undefined
  }
  const metaNumber = (key: string): number | undefined => {
    const v = meta[key]
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined
  }
  const metaHypothesis = (): XmailRegisterExternalRunParams['hypothesis'] | undefined => {
    const value = meta.hypothesis
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const record = value as Record<string, unknown>
    const premise = typeof record.premise === 'string' && record.premise.trim() ? record.premise.trim() : undefined
    const basis = typeof record.basis === 'string' && record.basis.trim() ? record.basis.trim() : undefined
    const expected = record.expected && typeof record.expected === 'object' && !Array.isArray(record.expected)
      ? Object.fromEntries(Object.entries(record.expected as Record<string, unknown>).filter((entry): entry is [string, string | number] => (
          typeof entry[1] === 'string' || (typeof entry[1] === 'number' && Number.isFinite(entry[1]))
        )))
      : undefined
    const hypothesis = { premise, expected, basis }
    return JSON.stringify(hypothesis).length <= 4096 ? hypothesis : undefined
  }

  return {
    provider: 'xcraper',
    externalRunId,
    label: source.label?.trim() || undefined,
    query: metaString('query'),
    location: metaString('location'),
    resultCount: metaNumber('result_count') ?? prospectCount,
    importedCount,
    costUsd: metaNumber('cost_usd'),
    actorId: metaString('actor_id'),
    template: metaString('template'),
    hypothesis: metaHypothesis(),
  }
}

/**
 * Fire-and-forget: register this batch's run with Xmail for cost
 * attribution. Never awaited by the caller and never throws.
 */
export function registerExternalRunWithXmail(
  sourceType: string,
  externalRunId: string | null,
  source: ExternalRunSourceMeta,
  prospectCount: number,
  importedCount: number,
): void {
  if (!isXmailConfigured()) return
  const params = buildExternalRunRegistration(source, sourceType, externalRunId, prospectCount, importedCount)
  if (!params) return
  ;(async () => {
    const result = await xmailRegisterExternalRun(params)
    if (!result.ok) {
      console.error('[api/v1/prospects] xmailRegisterExternalRun failed:', result.error)
    }
  })().catch((err) => console.error('[api/v1/prospects] registerExternalRunWithXmail error:', err))
}
