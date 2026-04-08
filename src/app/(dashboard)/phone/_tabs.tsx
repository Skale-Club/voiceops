'use client'

import { useRouter } from 'next/navigation'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

const TABS = [
  { value: 'calls', label: 'Calls' },
  { value: 'campaigns', label: 'Campaigns' },
  { value: 'assistants', label: 'Assistants' },
] as const

export type PhoneTab = (typeof TABS)[number]['value']

interface PhoneTabsProps {
  activeTab: PhoneTab
}

export function PhoneTabs({ activeTab }: PhoneTabsProps) {
  const router = useRouter()

  return (
    <Tabs value={activeTab} onValueChange={(v) => router.push(`/phone?tab=${v}`)}>
      <TabsList>
        {TABS.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
