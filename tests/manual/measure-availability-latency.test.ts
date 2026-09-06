// tests/manual/measure-availability-latency.test.ts
//
// VOICE-CALL-4-PLAN.md item E: "Measure the provider: /api/v1/availability
// cold 7-9s is Xkedule's own cost." This times the RAW provider endpoint
// directly (xkeduleFetchJson, bypassing src/lib/xkedule/availability-cache.ts
// entirely) so the numbers below are Xkedule's own latency, not our TTL
// memo's near-0ms hit. Read-only: GET requests only, no booking created.
//
// Three passes over the same 6 dates (spread across the next 3 weeks, so
// none of them can already be warm from another manual test run):
//   1. COLD  - first time this process has ever asked for that date
//   2. WARM  - the identical query, immediately after, to see whether the
//              provider's own short-lived warm window (measured elsewhere in
//              this repo: ~150ms within ~60s of a prior call) shows up here
//   3. STAFF - the same 6 dates again, with staffId=1 appended (a different
//              query on the provider's side, so it's a fresh cold-ish query
//              even though the plain date was just warmed above)

import { it } from 'vitest'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { getXkeduleCredentialsForOrg } from '@/lib/xkedule/credentials'
import { xkeduleFetchJson } from '@/lib/xkedule/client'

const ORG = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const SERVICE_ID = 333

/** today+2, +5, +9, +13, +17, +21 (UTC calendar dates) - 6 dates spread
 * across the next 3 weeks, nearest first. */
function sixDatesOverThreeWeeks(): string[] {
  const offsets = [2, 5, 9, 13, 17, 21]
  const now = new Date()
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' })
  return offsets.map((d) => fmt.format(new Date(base + d * 86_400_000)))
}

it('times GET /api/v1/availability against the live tenant: cold, warm, and with staffId', async () => {
  const supabase = createServiceRoleClient()
  const creds = await getXkeduleCredentialsForOrg(ORG, supabase)
  if (!creds) throw new Error(`No active Xkedule integration for org ${ORG}`)

  const dates = sixDatesOverThreeWeeks()
  console.log(`### dates under test: ${dates.join(', ')}`)

  const time = async (date: string, staffId?: number) => {
    const query = new URLSearchParams({ date, serviceIds: String(SERVICE_ID) })
    if (staffId) query.set('staffId', String(staffId))
    const t = Date.now()
    try {
      await xkeduleFetchJson(`/api/v1/availability?${query.toString()}`, 'GET', null, creds)
    } catch (err) {
      console.log(`###   (request failed, timing recorded anyway: ${(err as Error).message})`)
    }
    return Date.now() - t
  }

  const coldMs: Record<string, number> = {}
  for (const date of dates) coldMs[date] = await time(date)

  const warmMs: Record<string, number> = {}
  for (const date of dates) warmMs[date] = await time(date)

  const staffMs: Record<string, number> = {}
  for (const date of dates) staffMs[date] = await time(date, 1)

  console.log('### date          cold(ms)  warm(ms)  staffId=1(ms)')
  for (const date of dates) {
    console.log(
      `### ${date}   ${String(coldMs[date]).padStart(6)}    ${String(warmMs[date]).padStart(6)}    ${String(staffMs[date]).padStart(6)}`,
    )
  }

  const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)
  console.log(
    `### averages: cold=${avg(Object.values(coldMs))}ms  warm=${avg(Object.values(warmMs))}ms  staffId=1=${avg(Object.values(staffMs))}ms`,
  )
}, 300000)
