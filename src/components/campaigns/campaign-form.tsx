'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createCampaign } from '@/app/(dashboard)/outbound/actions'
import { getAssistantOptions } from '@/app/(dashboard)/calls/actions'

interface VapiPhoneNumber {
  id: string
  number?: string
  name?: string
}

export function CampaignForm() {
  const router = useRouter()

  const [name, setName] = useState('')
  const [vapiAssistantId, setVapiAssistantId] = useState('')
  const [vapiPhoneNumberId, setVapiPhoneNumberId] = useState('')
  const [scheduledStartAt, setScheduledStartAt] = useState('')
  const [callsPerMinute, setCallsPerMinute] = useState(5)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [assistants, setAssistants] = useState<Array<{ vapi_assistant_id: string; name: string | null }>>([])
  const [phoneNumbers, setPhoneNumbers] = useState<VapiPhoneNumber[]>([])
  const [loadingAssistants, setLoadingAssistants] = useState(true)
  const [loadingPhones, setLoadingPhones] = useState(true)

  useEffect(() => {
    // Load assistants
    getAssistantOptions()
      .then(setAssistants)
      .catch(() => setAssistants([]))
      .finally(() => setLoadingAssistants(false))

    // Load Vapi phone numbers
    fetch('/api/vapi/phone-numbers')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setPhoneNumbers(data)
        else setPhoneNumbers([])
      })
      .catch(() => setPhoneNumbers([]))
      .finally(() => setLoadingPhones(false))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || name.trim().length < 2) {
      setError('Name must be at least 2 characters')
      return
    }
    if (!vapiAssistantId) {
      setError('Please select an assistant')
      return
    }
    if (!vapiPhoneNumberId) {
      setError('Please select a phone number')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await createCampaign({
        name: name.trim(),
        vapi_assistant_id: vapiAssistantId,
        vapi_phone_number_id: vapiPhoneNumberId,
        scheduled_start_at: scheduledStartAt ? new Date(scheduledStartAt).toISOString() : null,
        calls_per_minute: callsPerMinute,
      })
      router.push('/dashboard/outbound')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create campaign')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Campaign Name <span className="text-destructive">*</span></Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Q1 Follow-up Campaign"
          minLength={2}
          required
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="assistant">Assistant <span className="text-destructive">*</span></Label>
        <select
          id="assistant"
          value={vapiAssistantId}
          onChange={(e) => setVapiAssistantId(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          required
        >
          <option value="">
            {loadingAssistants ? 'Loading assistants...' : 'Select an assistant'}
          </option>
          {assistants.map((a) => (
            <option key={a.vapi_assistant_id} value={a.vapi_assistant_id}>
              {a.name ?? a.vapi_assistant_id}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="phoneNumber">Phone Number <span className="text-destructive">*</span></Label>
        <select
          id="phoneNumber"
          value={vapiPhoneNumberId}
          onChange={(e) => setVapiPhoneNumberId(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          required
        >
          <option value="">
            {loadingPhones ? 'Loading phone numbers...' : 'Select a phone number'}
          </option>
          {phoneNumbers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.number ?? p.name ?? p.id}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="schedule">Scheduled Start (optional)</Label>
        <Input
          id="schedule"
          type="datetime-local"
          value={scheduledStartAt}
          onChange={(e) => setScheduledStartAt(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="callsPerMinute">Calls Per Minute (1-20)</Label>
        <Input
          id="callsPerMinute"
          type="number"
          min={1}
          max={20}
          value={callsPerMinute}
          onChange={(e) => setCallsPerMinute(Number(e.target.value))}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Creating...' : 'Create Campaign'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
