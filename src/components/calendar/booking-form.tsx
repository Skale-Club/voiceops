'use client'

import { useTransition } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { createBooking } from '@/app/(dashboard)/calendar/_actions/bookings'
import type { TimeSlot } from '@/lib/calendar/slots'

const schema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.string().email('Valid email required'),
  phone: z.string().max(30).optional(),
  notes: z.string().max(2000).optional(),
})

type FormValues = z.infer<typeof schema>

const LOCATION_KIND_LABELS: Record<string, string> = {
  google_meet: 'Google Meet',
  zoom: 'Zoom',
  whereby: 'Whereby',
  custom_link: 'Video link',
  phone_call: 'Phone call',
  custom_phone: 'Phone call',
  store_location: 'In person',
  custom_address: 'Address (you provide)',
  client_address: 'Address (on file)',
  video: 'Video call',
  phone: 'Phone call',
  in_person: 'In person',
}

interface BookingFormProps {
  eventTypeId: string
  slot: TimeSlot
  onSuccess: (bookingId: string, cancelToken: string) => void
  allowedLocationKinds?: string[]
  selectedLocationKind?: string
  onLocationKindChange?: Dispatch<SetStateAction<string>>
  /** Seeds the inputs (booker can still edit). Comes from the page's query string. */
  prefill?: { name?: string; email?: string; phone?: string }
}

export function BookingForm({
  eventTypeId,
  slot,
  onSuccess,
  allowedLocationKinds = [],
  selectedLocationKind,
  onLocationKindChange,
  prefill,
}: BookingFormProps) {
  const [isPending, startTransition] = useTransition()

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: prefill?.name ?? '',
      email: prefill?.email ?? '',
      phone: prefill?.phone ?? '',
      notes: '',
    },
  })

  function handleSubmit(values: FormValues) {
    startTransition(async () => {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const result = await createBooking({
        event_type_id: eventTypeId,
        start_at: slot.start,
        booker_name: values.name,
        booker_email: values.email,
        booker_phone: values.phone,
        booker_timezone: timezone,
        notes: values.notes,
        location_kind: selectedLocationKind,
      })

      if (!result.ok) {
        if (result.error === 'slot_taken') {
          toast.error('This slot was just taken | please pick another time.')
        } else if (result.error === 'outside_availability') {
          toast.error('That time is no longer available | please pick another time.')
        } else if (result.error === 'rate_limited') {
          toast.error('Too many booking attempts. Please try again in an hour.')
        } else {
          toast.error(result.error)
        }
        return
      }

      onSuccess(result.data.id, result.data.cancel_token)
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <FormField control={form.control} name="name" render={({ field }) => (
          <FormItem>
            <FormLabel>Your name</FormLabel>
            <FormControl><Input placeholder="Jane Smith" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="email" render={({ field }) => (
          <FormItem>
            <FormLabel>Email</FormLabel>
            <FormControl><Input type="email" placeholder="jane@example.com" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="phone" render={({ field }) => (
          <FormItem>
            <FormLabel>Phone <span className="text-muted-foreground text-xs">(optional)</span></FormLabel>
            <FormControl><Input type="tel" placeholder="+55 11 99999-9999" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="notes" render={({ field }) => (
          <FormItem>
            <FormLabel>Notes <span className="text-muted-foreground text-xs">(optional)</span></FormLabel>
            <FormControl><Textarea placeholder="Anything you'd like to share before the meeting…" rows={3} className="resize-none" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        {allowedLocationKinds.length > 1 && onLocationKindChange && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-[#A1A1AA]">Meeting location</p>
            <div className="flex flex-col gap-2">
              {allowedLocationKinds.map((kind) => (
                <label key={kind} className="flex items-center gap-2 cursor-pointer text-sm text-[#FAFAFA]">
                  <input
                    type="radio"
                    name="location_kind"
                    value={kind}
                    checked={selectedLocationKind === kind}
                    onChange={() => onLocationKindChange(kind)}
                    className="accent-indigo-500"
                  />
                  {LOCATION_KIND_LABELS[kind] ?? kind}
                </label>
              ))}
            </div>
          </div>
        )}

        <Button type="submit" disabled={isPending} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white">
          {isPending ? 'Confirming…' : 'Confirm booking'}
        </Button>
      </form>
    </Form>
  )
}
