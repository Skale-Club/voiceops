import { getIntegrations } from './actions'
import { IntegrationsTable } from '@/components/integrations/integrations-table'

export default async function IntegrationsPage() {
  const integrations = await getIntegrations()

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Integrations</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Connect external services to your organization.
        </p>
      </div>
      <IntegrationsTable integrations={integrations} />
    </div>
  )
}
