import { getToolConfigs } from './actions'
import { getIntegrations } from '@/app/(dashboard)/integrations/actions'
import { ToolsTable } from '@/components/tools/tools-table'

export default async function ToolsPage() {
  const [toolConfigs, integrations] = await Promise.all([
    getToolConfigs(),
    getIntegrations(),
  ])

  return (
    <div className="p-6">
      <ToolsTable toolConfigs={toolConfigs} integrations={integrations}>
        <h1 className="text-lg font-semibold">Tools</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Map Vapi tool names to Opps actions and integrations.
        </p>
      </ToolsTable>
    </div>
  )
}
