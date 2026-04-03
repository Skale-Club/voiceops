'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useRef } from 'react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface CallsFiltersProps {
  assistants: Array<{ vapi_assistant_id: string; name: string | null }>
}

export function CallsFilters({ assistants }: CallsFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function updateParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    if (value && value !== 'all') {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    // Reset to page 1 on filter change
    params.delete('page')
    router.replace('/dashboard/calls?' + params.toString())
  }

  function handleSearch(value: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      updateParam('q', value || null)
    }, 300)
  }

  return (
    <div className="flex flex-wrap gap-3 mb-4">
      <Input
        placeholder="Search by phone or name..."
        defaultValue={searchParams.get('q') ?? ''}
        onChange={(e) => handleSearch(e.target.value)}
        className="max-w-[240px]"
      />

      <Select
        defaultValue={searchParams.get('status') ?? 'all'}
        onValueChange={(value) => updateParam('status', value)}
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="All statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="customer-ended-call">Customer ended</SelectItem>
          <SelectItem value="assistant-ended-call">Assistant ended</SelectItem>
          <SelectItem value="error">Error</SelectItem>
          <SelectItem value="silence-timed-out">Silence timeout</SelectItem>
        </SelectContent>
      </Select>

      <Select
        defaultValue={searchParams.get('type') ?? 'all'}
        onValueChange={(value) => updateParam('type', value)}
      >
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="All types" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All types</SelectItem>
          <SelectItem value="inboundPhoneCall">Inbound</SelectItem>
          <SelectItem value="outboundPhoneCall">Outbound</SelectItem>
          <SelectItem value="webCall">Web</SelectItem>
        </SelectContent>
      </Select>

      {assistants.length > 0 && (
        <Select
          defaultValue={searchParams.get('assistant') ?? 'all'}
          onValueChange={(value) => updateParam('assistant', value)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All assistants" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All assistants</SelectItem>
            {assistants.map((a) => (
              <SelectItem key={a.vapi_assistant_id} value={a.vapi_assistant_id}>
                {a.name ?? a.vapi_assistant_id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div className="flex items-center gap-2">
        <label className="text-sm text-muted-foreground">From</label>
        <input
          type="date"
          defaultValue={searchParams.get('from') ?? ''}
          onChange={(e) => updateParam('from', e.target.value || null)}
          className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
        />
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm text-muted-foreground">To</label>
        <input
          type="date"
          defaultValue={searchParams.get('to') ?? ''}
          onChange={(e) => updateParam('to', e.target.value || null)}
          className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
        />
      </div>
    </div>
  )
}
