'use client'

import { useState, useEffect, useTransition } from 'react'
import {
  format,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  isBefore,
  startOfDay,
  getDay,
} from 'date-fns'
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getAvailableSlots, getDebugSlots } from '@/app/(dashboard)/calendar/_actions/bookings'
import type { TimeSlot, DebugTimeSlot, SlotBlockReason } from '@/lib/calendar/slots'

const DOW_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

const REASON_LABEL: Record<SlotBlockReason, string> = {
  past: 'PAST',
  booked: 'BOOKED',
  google_busy: 'GOOGLE BUSY',
  // Only ever reaches the client for an authenticated member of the event
  // type's org — getDebugSlots drops withheld slots for everyone else.
  look_busy: 'LOOK BUSY',
}

interface BookingSlotPickerProps {
  eventTypeId: string
  availableDows: number[] // days of week with availability
  durationMinutes: number
  onSelectSlot: (slot: TimeSlot) => void
  debugMode?: boolean
}

export function BookingSlotPicker({
  eventTypeId,
  availableDows,
  durationMinutes,
  onSelectSlot,
  debugMode = false,
}: BookingSlotPickerProps) {
  const [viewMonth, setViewMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [slots, setSlots] = useState<DebugTimeSlot[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null)

  const today = startOfDay(new Date())
  const monthStart = startOfMonth(viewMonth)
  const monthEnd = endOfMonth(viewMonth)
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd })
  // Pad start
  const startPad = getDay(monthStart)
  const paddedDays = [...Array(startPad).fill(null), ...days]

  const isCurrentMonthOrPast = isBefore(startOfMonth(viewMonth), startOfMonth(today))

  function isDayAvailable(day: Date) {
    if (!isSameMonth(day, viewMonth)) return false
    if (isBefore(day, today)) return false
    return availableDows.includes(getDay(day))
  }

  async function handleSelectDate(day: Date) {
    setSelectedDate(day)
    setSelectedSlot(null)
    setSlots([])
    setLoadingSlots(true)
    try {
      const dateStr = format(day, 'yyyy-MM-dd')
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (debugMode) {
        const result = await getDebugSlots({ eventTypeId, date: dateStr, bookerTimezone: tz })
        setSlots(result.ok ? result.data : [])
      } else {
        const result = await getAvailableSlots({ eventTypeId, date: dateStr, bookerTimezone: tz })
        setSlots(result.ok ? result.data.map((s) => ({ ...s, available: true })) : [])
      }
    } finally {
      setLoadingSlots(false)
    }
  }

  function handleSelectSlot(slot: TimeSlot) {
    setSelectedSlot(slot)
    onSelectSlot(slot)
  }

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-[1fr_200px]">
      {/* Calendar */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setViewMonth((m) => subMonths(m, 1))}
            disabled={isCurrentMonthOrPast}
            className="p-1 rounded hover:bg-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold">{format(viewMonth, 'MMMM yyyy')}</span>
          <button
            onClick={() => setViewMonth((m) => addMonths(m, 1))}
            className="p-1 rounded hover:bg-accent transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-7 text-center mb-1">
          {DOW_LABELS.map((d) => (
            <div key={d} className="text-[11px] font-medium text-muted-foreground py-1">{d}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-0.5">
          {paddedDays.map((day, idx) => {
            if (!day) return <div key={idx} />
            const available = isDayAvailable(day)
            const selected = selectedDate ? isSameDay(day, selectedDate) : false
            const todayDay = isToday(day)
            return (
              <button
                key={day.toISOString()}
                disabled={!available}
                onClick={() => handleSelectDate(day)}
                className={cn(
                  'h-9 w-full rounded text-sm transition-colors',
                  !isSameMonth(day, viewMonth) && 'opacity-30',
                  !available && 'text-muted-foreground cursor-not-allowed opacity-40',
                  available && !selected && 'hover:bg-accent',
                  selected && 'bg-indigo-600 text-white font-semibold',
                  todayDay && !selected && 'ring-1 ring-indigo-400',
                )}
              >
                {format(day, 'd')}
              </button>
            )
          })}
        </div>
      </div>

      {/* Time slots */}
      <div>
        {selectedDate ? (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground mb-2">
              {format(selectedDate, 'EEE, MMM d')}
            </p>
            {loadingSlots ? (
              <div className="text-xs text-muted-foreground">Loading slots…</div>
            ) : slots.length === 0 ? (
              <div className="text-xs text-muted-foreground">No slots available</div>
            ) : (
              slots.map((slot) => {
                if (!slot.available) {
                  return (
                    <div
                      key={slot.start}
                      className="w-full rounded border border-dashed border-border/50 py-2 px-3 text-sm opacity-60 pointer-events-none"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Clock className="h-3.5 w-3.5 opacity-70" />
                          {slot.startLocal}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-semibold text-red-400 uppercase tracking-wide">
                            UNAVAILABLE
                          </span>
                          {slot.reason && (
                            <span className="text-[9px] font-bold uppercase bg-[#2A2A2F] text-muted-foreground px-1.5 py-0.5 rounded">
                              {REASON_LABEL[slot.reason]}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                }
                return (
                  <button
                    key={slot.start}
                    onClick={() => handleSelectSlot(slot)}
                    className={cn(
                      'w-full rounded border border-border py-2 text-sm font-medium transition-colors',
                      selectedSlot?.start === slot.start
                        ? 'bg-indigo-600 border-indigo-600 text-white'
                        : 'hover:border-indigo-400 hover:text-indigo-400',
                    )}
                  >
                    <div className="flex items-center justify-center gap-1">
                      <Clock className="h-3.5 w-3.5 opacity-70" />
                      {slot.startLocal}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground mt-2">
            Select a date to see available times
          </div>
        )}
      </div>
    </div>
  )
}
