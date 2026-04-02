'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { createAssistantMapping, updateAssistantMapping } from '@/app/(dashboard)/assistants/actions'
import type { Database } from '@/types/database'

type AssistantMapping = Database['public']['Tables']['assistant_mappings']['Row']

const assistantMappingSchema = z.object({
  vapi_assistant_id: z.string().min(1, 'Vapi assistant ID is required.'),
  name: z.string().optional(),
})

type AssistantMappingFormValues = z.infer<typeof assistantMappingSchema>

interface AssistantMappingFormProps {
  mode: 'create' | 'edit'
  mapping?: AssistantMapping
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function AssistantMappingForm({
  mode,
  mapping,
  open,
  onOpenChange,
  onSuccess,
}: AssistantMappingFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<AssistantMappingFormValues>({
    resolver: zodResolver(assistantMappingSchema),
    defaultValues: {
      vapi_assistant_id: mapping?.vapi_assistant_id ?? '',
      name: mapping?.name ?? '',
    },
  })

  async function onSubmit(values: AssistantMappingFormValues) {
    setIsSubmitting(true)
    try {
      let result: { error?: string } | undefined

      if (mode === 'create') {
        result = await createAssistantMapping({
          vapi_assistant_id: values.vapi_assistant_id,
          name: values.name || undefined,
        })
      } else if (mode === 'edit' && mapping) {
        result = await updateAssistantMapping(mapping.id, {
          vapi_assistant_id: values.vapi_assistant_id,
          name: values.name || undefined,
        })
      }

      if (result?.error) {
        if (result.error === 'This assistant ID is already mapped to an organization.') {
          toast.error('This assistant ID is already mapped to an organization.')
        } else {
          toast.error('Failed to save. Try again.')
        }
        return
      }

      toast.success(mode === 'create' ? 'Assistant mapping added.' : 'Mapping updated.')
      form.reset()
      onOpenChange(false)
      onSuccess()
    } finally {
      setIsSubmitting(false)
    }
  }

  const title = mode === 'create' ? 'Add Assistant Mapping' : 'Edit Mapping'
  const submitLabel = mode === 'create' ? 'Add Assistant' : 'Save Changes'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Label</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Scheduling Bot" {...field} />
                  </FormControl>
                  <FormDescription>
                    A friendly name to identify this assistant in the platform.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="vapi_assistant_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Vapi Assistant ID</FormLabel>
                  <FormControl>
                    <Input placeholder="paste assistant ID from Vapi dashboard" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Keep Mapping
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : submitLabel}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
