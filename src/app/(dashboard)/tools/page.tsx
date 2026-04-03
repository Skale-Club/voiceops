import { getToolConfigs } from './actions'
import { getIntegrations } from '@/app/(dashboard)/integrations/actions'
import { ToolsTable } from '@/components/tools/tools-table'

export default async function ToolsPage() {
  const [toolConfigs, integrations] = await Promise.all([
    getToolConfigs(),
    getIntegrations(),
  ])

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Tools</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Map Vapi tool names to GoHighLevel actions.
        </p>
      </div>
      <ToolsTable toolConfigs={toolConfigs} integrations={integrations} />
    </div>
  )
}
