'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { IntegrationForm } from './integration-form'
import type { IntegrationForDisplay } from '@/app/(dashboard)/integrations/actions'

type Provider = IntegrationForDisplay['provider']

const ALL_PROVIDERS: { id: Provider; label: string; description: string }[] = [
  { id: 'vapi', label: 'Vapi', description: 'AI voice assistant platform' },
  { id: 'gohighlevel', label: 'GoHighLevel', description: 'CRM and marketing automation' },
  { id: 'twilio', label: 'Twilio', description: 'SMS and voice communications' },
  { id: 'calcom', label: 'Cal.com', description: 'Scheduling and calendar management' },
  { id: 'openai', label: 'OpenAI', description: 'GPT models and embeddings' },
  { id: 'anthropic', label: 'Anthropic', description: 'Claude AI models' },
  { id: 'openrouter', label: 'OpenRouter', description: 'Multi-model AI gateway' },
]

interface IntegrationsTableProps {
  integrations: IntegrationForDisplay[]
}

export function IntegrationsTable({ integrations }: IntegrationsTableProps) {
  const router = useRouter()
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null)
  const [isSheetOpen, setIsSheetOpen] = useState(false)

  const connectedMap = new Map(integrations.map((i) => [i.provider, i]))

  function openSheet(provider: Provider) {
    setSelectedProvider(provider)
    setIsSheetOpen(true)
  }

  function handleSheetClose() {
    setIsSheetOpen(false)
    setSelectedProvider(null)
  }

  function handleSuccess() {
    handleSheetClose()
    router.refresh()
  }

  const selectedIntegration = selectedProvider ? connectedMap.get(selectedProvider) : undefined

  return (
    <>
      <div className="rounded-md border divide-y">
        {ALL_PROVIDERS.map(({ id, label, description }) => {
          const integration = connectedMap.get(id)
          const isConnected = !!integration

          return (
            <button
              key={id}
              onClick={() => openSheet(id)}
              className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-muted/40 transition-colors text-left group"
            >
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
              </div>
              <div className="flex items-center gap-3">
                {isConnected && (
                  <span className="font-mono text-xs text-muted-foreground">
                    {integration.masked_api_key}
                  </span>
                )}
                <Badge
                  variant="outline"
                  className={
                    isConnected
                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
                      : 'bg-zinc-500/15 text-zinc-400 border-zinc-500/20'
                  }
                >
                  {isConnected ? 'Connected' : 'Not connected'}
                </Badge>
                <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </button>
          )
        })}
      </div>

      <Sheet
        open={isSheetOpen}
        onOpenChange={(open) => { if (!open) handleSheetClose() }}
      >
        <SheetContent side="right" className="p-0 sm:max-w-lg">
          {selectedProvider && (
            <IntegrationForm
              provider={selectedProvider}
              integration={selectedIntegration}
              onSuccess={handleSuccess}
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
