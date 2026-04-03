import { getDashboardMetrics } from './calls/actions'
import { DashboardMetrics } from '@/components/calls/dashboard-metrics'

export default async function DashboardPage() {
  const metrics = await getDashboardMetrics()
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Overview of call activity and tool performance.
        </p>
      </div>
      <DashboardMetrics metrics={metrics} />
    </div>
  )
}
