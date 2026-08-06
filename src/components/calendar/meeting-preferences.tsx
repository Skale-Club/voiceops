'use client'

// SYNC-04: the dead location-type preference control has been removed
// from customer-facing configuration. Nothing in the booking-creation
// path ever read calendar_profiles' now-dead per-org default location
// setting (grep-confirmed in 130-RESEARCH.md) — the control promised
// automatic Google Meet link generation and similar per-option behavior
// that never happened. The column and any previously-saved value are
// left untouched (D-02); this is a UI-only removal. Per-event-type
// meeting locations are configured on the event type itself (Calendar →
// Event Types → Allowed meeting locations, added in a companion plan
// for this phase).
//
// Look busy (migration 1267) is the first real account-level scheduling
// preference on this page. It applies to every event type this calendar
// hosts.

import { useEffect, useState, useTransition } from 'react'
import { EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  getSchedulingProfile,
  updateLookBusySettings,
  type LookBusyMode,
} from '@/app/(dashboard)/calendar/_actions/calendar-profile'

const MODE_LABELS: Record<LookBusyMode, string> = {
  off: 'Off — show every open time',
  hide_percent: 'Hide a share of open times',
  max_per_day: 'Show at most N times per day',
}

export function MeetingPreferences() {
  const [loading, setLoading] = useState(true)
  const [hasProfile, setHasProfile] = useState(false)
  const [mode, setMode] = useState<LookBusyMode>('off')
  const [percent, setPercent] = useState<string>('')
  const [maxPerDay, setMaxPerDay] = useState<string>('')
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await getSchedulingProfile()
      if (cancelled) return
      if (result.ok && result.data) {
        setHasProfile(true)
        setMode(result.data.look_busy_mode ?? 'off')
        setPercent(result.data.look_busy_percent?.toString() ?? '')
        setMaxPerDay(result.data.look_busy_max_per_day?.toString() ?? '')
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  function handleSave() {
    startTransition(async () => {
      const result = await updateLookBusySettings({
        look_busy_mode: mode,
        look_busy_percent: percent === '' ? null : Number(percent),
        look_busy_max_per_day: maxPerDay === '' ? null : Number(maxPerDay),
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Look busy settings saved')
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[15px] font-semibold text-text-primary">User preferences</h2>
        <p className="mt-1 text-[12.5px] text-text-tertiary">
          Set your preferences for your account. Meeting locations are configured
          per event type under{' '}
          <span className="text-text-secondary">Calendar → Event Types</span>.
        </p>
      </div>

      <div className="rounded-[14px] border border-border bg-bg-secondary px-5 py-5">
        <div className="flex items-center gap-2">
          <EyeOff className="h-4 w-4 text-text-tertiary" />
          <h3 className="text-[14px] font-semibold text-text-primary">Look busy</h3>
        </div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-tertiary">
          Hides part of your real availability from your public booking pages so
          your calendar reads as in-demand. Applies to every event type on this
          calendar. Your own calendar always shows your full, real availability —
          this never invents bookings and never weakens double-booking
          protection.
        </p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-text-tertiary">
          Hidden times genuinely cannot be booked, by a visitor or by your AI
          agent, so this does reduce bookable capacity. Which times are held back
          is fixed per day rather than re-rolled on every refresh, so a visitor
          who comes back sees the same times.
        </p>

        {loading ? (
          <p className="mt-5 text-[12.5px] text-text-tertiary">Loading…</p>
        ) : !hasProfile ? (
          <p className="mt-5 text-[12.5px] text-text-tertiary">
            Set up your booking page first under{' '}
            <span className="text-text-secondary">Calendar → Availability</span>,
            then come back to configure this.
          </p>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="look-busy-mode">Strategy</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as LookBusyMode)}>
                <SelectTrigger id="look-busy-mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(MODE_LABELS) as LookBusyMode[]).map((k) => (
                    <SelectItem key={k} value={k}>{MODE_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {mode === 'hide_percent' && (
              <div className="space-y-1.5">
                <Label htmlFor="look-busy-percent">Percentage to hide</Label>
                <Input
                  id="look-busy-percent"
                  type="number"
                  min={1}
                  max={90}
                  placeholder="40"
                  value={percent}
                  onChange={(e) => setPercent(e.target.value)}
                />
                <p className="text-[12px] text-text-tertiary">
                  1–90. At least one time per day always stays open, so a day is
                  never hidden entirely by this alone.
                </p>
              </div>
            )}

            {mode === 'max_per_day' && (
              <div className="space-y-1.5">
                <Label htmlFor="look-busy-max">Maximum times per day</Label>
                <Input
                  id="look-busy-max"
                  type="number"
                  min={1}
                  max={50}
                  placeholder="3"
                  value={maxPerDay}
                  onChange={(e) => setMaxPerDay(e.target.value)}
                />
                <p className="text-[12px] text-text-tertiary">
                  1–50, spread across your availability rather than clustered in
                  one block.
                </p>
              </div>
            )}

            <Button onClick={handleSave} disabled={isPending}>
              {isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
