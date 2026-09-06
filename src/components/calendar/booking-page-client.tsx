'use client'

import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { CheckCircle2, Clock } from 'lucide-react'
import { BookingSlotPicker } from './booking-slot-picker'
import { BookingForm } from './booking-form'
import type { TimeSlot } from '@/lib/calendar/slots'

type Step = 'pick' | 'confirm' | 'done'

interface BookingPageClientProps {
  eventTypeId: string
  availableDows: number[]
  durationMinutes: number
  color: string
  allowedLocationKinds: string[]
  debugMode?: boolean
  /** Optional booker details to seed the confirm step (from ?name=&email=&phone=). */
  prefill?: { name?: string; email?: string; phone?: string }
}

export function BookingPageClient({
  eventTypeId,
  availableDows,
  durationMinutes,
  color,
  allowedLocationKinds,
  debugMode = false,
  prefill,
}: BookingPageClientProps) {
  const [step, setStep] = useState<Step>('pick')
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null)
  const [bookingId, setBookingId] = useState<string | null>(null)
  const [cancelToken, setCancelToken] = useState<string | null>(null)
  // Default to the first available kind; only matters when there are multiple.
  const [selectedLocationKind, setSelectedLocationKind] = useState<string>(
    allowedLocationKinds[0] ?? 'video',
  )

  function handleSlotSelect(slot: TimeSlot) {
    setSelectedSlot(slot)
    setStep('confirm')
  }

  function handleBookingSuccess(id: string, token: string) {
    setBookingId(id)
    setCancelToken(token)
    setStep('done')
  }

  if (step === 'done' && selectedSlot) {
    const cancelUrl =
      bookingId && cancelToken
        ? `/book/cancel/${bookingId}?token=${cancelToken}`
        : null

    return (
      <div className="flex flex-col items-center justify-center py-8 text-center gap-4">
        <div className="h-14 w-14 rounded-full flex items-center justify-center" style={{ backgroundColor: `${color}20` }}>
          <CheckCircle2 className="h-8 w-8" style={{ color }} />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-[#FAFAFA]">Booking confirmed!</h2>
          <p className="text-sm text-[#A1A1AA] mt-1">
            You&apos;re scheduled for{' '}
            <strong className="text-[#FAFAFA]">
              {format(parseISO(selectedSlot.start), 'EEEE, MMMM d')}
            </strong>{' '}
            at{' '}
            <strong className="text-[#FAFAFA]">
              {selectedSlot.startLocal}
            </strong>.
          </p>
        </div>
        <p className="text-xs text-[#71717A]">A calendar invite will be sent to your email.</p>
        {cancelUrl && (
          <a
            href={cancelUrl}
            className="text-xs text-[#71717A] hover:text-[#A1A1AA] underline underline-offset-2 transition-colors mt-1"
          >
            Need to cancel? Click here
          </a>
        )}
      </div>
    )
  }

  if (step === 'confirm' && selectedSlot) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-[#A1A1AA]">
          <button
            className="underline hover:text-[#FAFAFA] transition-colors"
            onClick={() => setStep('pick')}
          >
            ← Change time
          </button>
          <span className="text-[#3F3F46]">|</span>
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            <span>
              {format(parseISO(selectedSlot.start), 'EEEE, MMM d')} · {selectedSlot.startLocal} – {selectedSlot.endLocal}
            </span>
          </div>
        </div>
        <BookingForm
          eventTypeId={eventTypeId}
          slot={selectedSlot}
          onSuccess={handleBookingSuccess}
          allowedLocationKinds={allowedLocationKinds}
          selectedLocationKind={selectedLocationKind}
          onLocationKindChange={setSelectedLocationKind}
          prefill={prefill}
        />
      </div>
    )
  }

  return (
    <BookingSlotPicker
      eventTypeId={eventTypeId}
      availableDows={availableDows}
      durationMinutes={durationMinutes}
      onSelectSlot={handleSlotSelect}
      debugMode={debugMode}
    />
  )
}
