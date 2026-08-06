'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import type { EventTypeRow } from '@/app/(dashboard)/calendar/_actions/event-types'
import { REACHABLE_LOCATION_KINDS, REACHABLE_LOCATION_KIND_LABELS } from '@/lib/calendar/location-resolver'

const DURATIONS = [15, 20, 30, 45, 60, 90, 120]

const schema = z.object({
  title: z.string().min(1, 'Title is required').max(100),
  description: z.string().max(2000).optional(),
  duration_minutes: z.number().int().min(5).max(480),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  location_type: z.enum(['video', 'phone', 'in_person']),
  location_value: z.string().max(500).optional(),
  allowed_location_kinds: z
    .array(z.enum(['google_meet', 'client_address', 'custom_address', 'phone_call', 'custom_phone', 'custom_link']))
    .min(1, 'Select at least one meeting location'),
})

type FormValues = z.infer<typeof schema>

interface EventTypeFormProps {
  defaultValues?: Partial<EventTypeRow>
  onSubmit: (values: FormValues) => Promise<void>
  loading?: boolean
  submitLabel?: string
}

const LOCATION_LABELS = {
  video: 'Video call',
  phone: 'Phone call',
  in_person: 'In person',
}

const PRESET_COLORS = [
  '#6366F1', '#8B5CF6', '#EC4899', '#EF4444',
  '#F97316', '#EAB308', '#22C55E', '#06B6D4',
]

export function EventTypeForm({ defaultValues, onSubmit, loading, submitLabel = 'Save' }: EventTypeFormProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: defaultValues?.title ?? '',
      description: defaultValues?.description ?? '',
      duration_minutes: defaultValues?.duration_minutes ?? 30,
      color: defaultValues?.color ?? '#6366F1',
      location_type: (defaultValues?.location_type as 'video' | 'phone' | 'in_person') ?? 'video',
      location_value: defaultValues?.location_value ?? '',
      allowed_location_kinds:
        (defaultValues?.allowed_location_kinds?.filter((k) =>
          (REACHABLE_LOCATION_KINDS as readonly string[]).includes(k),
        ) as FormValues['allowed_location_kinds'] | undefined)?.length
          ? (defaultValues!.allowed_location_kinds!.filter((k) =>
              (REACHABLE_LOCATION_KINDS as readonly string[]).includes(k),
            ) as FormValues['allowed_location_kinds'])
          : ['custom_link'],
    },
  })

  const locationType = form.watch('location_type')

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField control={form.control} name="title" render={({ field }) => (
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl><Input placeholder="30-min intro call" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="description" render={({ field }) => (
          <FormItem>
            <FormLabel>Description <span className="text-muted-foreground text-xs">(optional)</span></FormLabel>
            <FormControl><Textarea placeholder="What is this meeting about?" rows={3} className="resize-none" {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="duration_minutes" render={({ field }) => (
          <FormItem>
            <FormLabel>Duration</FormLabel>
            <Select onValueChange={(v) => field.onChange(Number(v))} defaultValue={String(field.value)}>
              <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
              <SelectContent>
                {DURATIONS.map((d) => (
                  <SelectItem key={d} value={String(d)}>{d} min</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="location_type" render={({ field }) => (
          <FormItem>
            <FormLabel>Location</FormLabel>
            <Select onValueChange={field.onChange} defaultValue={field.value}>
              <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
              <SelectContent>
                {(Object.keys(LOCATION_LABELS) as Array<keyof typeof LOCATION_LABELS>).map((k) => (
                  <SelectItem key={k} value={k}>{LOCATION_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />

        {locationType !== 'phone' && (
          <FormField control={form.control} name="location_value" render={({ field }) => (
            <FormItem>
              <FormLabel>
                {locationType === 'video' ? 'Video link' : 'Address'}
                <span className="text-muted-foreground text-xs ml-1">(optional)</span>
              </FormLabel>
              <FormControl>
                <Input
                  placeholder={locationType === 'video' ? 'https://meet.google.com/...' : '123 Main St'}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
        )}

        <FormField control={form.control} name="allowed_location_kinds" render={({ field }) => (
          <FormItem>
            <FormLabel>Allowed meeting locations</FormLabel>
            <FormDescription>
              Bookers choose from these when scheduling. Select at least one.
            </FormDescription>
            <div className="flex flex-col gap-2">
              {REACHABLE_LOCATION_KINDS.map((kind) => {
                const checked = field.value?.includes(kind) ?? false
                return (
                  <label key={kind} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const current = field.value ?? []
                        const next = e.target.checked
                          ? [...current, kind]
                          : current.filter((k) => k !== kind)
                        field.onChange(next)
                      }}
                      className="accent-indigo-500"
                    />
                    {REACHABLE_LOCATION_KIND_LABELS[kind]}
                  </label>
                )
              })}
            </div>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="color" render={({ field }) => (
          <FormItem>
            <FormLabel>Color</FormLabel>
            <div className="flex items-center gap-2 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => field.onChange(c)}
                  className="h-7 w-7 rounded-full border-2 transition-all"
                  style={{
                    backgroundColor: c,
                    borderColor: field.value === c ? 'white' : 'transparent',
                    outline: field.value === c ? `2px solid ${c}` : 'none',
                  }}
                />
              ))}
              <input
                type="color"
                value={field.value}
                onChange={(e) => field.onChange(e.target.value)}
                className="h-7 w-7 cursor-pointer rounded border border-border bg-transparent"
                title="Custom color"
              />
            </div>
            <FormMessage />
          </FormItem>
        )} />

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? 'Saving…' : submitLabel}
        </Button>
      </form>
    </Form>
  )
}
