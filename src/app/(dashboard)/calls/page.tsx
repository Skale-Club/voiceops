import { getCalls, getAssistantOptions } from './actions'
import { CallsTable } from '@/components/calls/calls-table'
import { CallsFilters } from '@/components/calls/calls-filters'

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams // MUST await — Next.js 15
  const page = Number(params.page ?? '1')
  const from = params.from as string | undefined
  const to = params.to as string | undefined
  const status = params.status as string | undefined
  const assistantId = params.assistant as string | undefined
  const callType = params.type as string | undefined
  const q = params.q as string | undefined

  const [{ calls, total }, assistants] = await Promise.all([
    getCalls({ page, from, to, status, assistantId, callType, q }),
    getAssistantOptions(),
  ])

  const totalPages = Math.ceil(total / 20)

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Calls</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Every completed call processed through your assistants.
        </p>
      </div>
      <CallsFilters assistants={assistants} />
      <CallsTable calls={calls} total={total} page={page} totalPages={totalPages} />
    </div>
  )
}
