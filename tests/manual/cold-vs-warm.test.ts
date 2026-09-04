import { it } from 'vitest'
import { getXkeduleCredentialsForOrg } from '@/lib/xkedule/credentials'
import { checkXkeduleAvailability } from '@/lib/xkedule/actions/check-availability'
import { createServiceRoleClient } from '@/lib/supabase/admin'
const ORG = '31502b7d-f4bd-4493-91f7-fc6f2738a09d'
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
it('cold vs warm vs re-cold after a pause', async () => {
  const s = createServiceRoleClient()
  const creds = await getXkeduleCredentialsForOrg(ORG, s)
  const ctx = { organizationId: ORG, supabase: s } as never
  const time = async (label: string, date: string) => {
    const t = Date.now()
    await checkXkeduleAvailability({ serviceIds: [333], date } as never, creds as never, ctx)
    console.log(`### ${label.padEnd(34)} ${String(Date.now() - t).padStart(6)}ms   (${date})`)
  }
  await time('never-queried date, COLD', '2026-10-14')
  await time('same date immediately, warm', '2026-10-14')
  await time('another new date, COLD', '2026-10-15')
  console.log('### waiting 65s to test TTL...')
  await wait(65000)
  await time('first date after 65s pause', '2026-10-14')
}, 300000)
