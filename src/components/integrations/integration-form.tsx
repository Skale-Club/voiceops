'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import type { IntegrationForDisplay } from '@/app/(dashboard)/integrations/actions'
import { createIntegration, updateIntegration } from '@/app/(dashboard)/integrations/actions'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type Provider = 'gohighlevel' | 'twilio' | 'calcom' | 'custom_webhook' | 'openai' | 'anthropic' | 'openrouter' | 'vapi'

const PROVIDER_LABELS: Record<Provider, string> = {
  gohighlevel: 'GoHighLevel',
  twilio: 'Twilio',
  calcom: 'Cal.com',
  custom_webhook: 'Custom Webhook',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  vapi: 'Vapi',
}

// Single schema used for both create and edit.
// apiKey validation is enforced at submit time for create mode.
const integrationSchema = z.object({
  provider: z.enum(['gohighlevel', 'twilio', 'calcom', 'custom_webhook', 'openai', 'anthropic', 'openrouter', 'vapi'] as const),
  apiKey: z.string(),
  locationId: z.string().optional(),
  defaultModel: z.string().optional(),
})

type IntegrationFormValues = z.infer<typeof integrationSchema>

interface IntegrationFormProps {
  mode: 'create' | 'edit'
  integration?: IntegrationForDisplay
  onSuccess: () => void
}

export function IntegrationForm({ mode, integration, onSuccess }: IntegrationFormProps) {
  const [isPending, setIsPending] = useState(false)

  const form = useForm<IntegrationFormValues>({
    resolver: zodResolver(integrationSchema),
    mode: 'onSubmit',
    defaultValues: {
      provider: (integration?.provider ?? 'gohighlevel') as Provider,
      apiKey: '', // Never pre-fill API key for security — not even in edit mode
      locationId: integration?.location_id ?? '',
      defaultModel: (integration?.config as Record<string, string> | null)?.model ?? '',
    },
  })

  const selectedProvider = form.watch('provider')

  async function onSubmit(values: IntegrationFormValues) {
    // Enforce apiKey required for create
    if (mode === 'create' && !values.apiKey.trim()) {
      form.setError('apiKey', { message: 'API key is required' })
      return
    }

    setIsPending(true)
    try {
      let result: { error?: string } | void = undefined

      const config: Record<string, string> = {}
      if (values.defaultModel?.trim()) {
        config.model = values.defaultModel.trim()
      }

      const name = PROVIDER_LABELS[values.provider]

      if (mode === 'create') {
        result = await createIntegration({
          name,
          provider: values.provider,
          apiKey: values.apiKey,
          locationId: values.locationId ?? '',
          config,
        })
      } else if (integration) {
        result = await updateIntegration(integration.id, {
          name,
          locationId: values.locationId ?? '',
          config,
          // Only pass apiKey if user entered a new one
          apiKey: values.apiKey.trim().length > 0 ? values.apiKey : undefined,
        })
      }

      if (result && 'error' in result && result.error) {
        toast.error('Failed to save integration. Try again.')
        return
      }

      toast.success('Integration saved.')
      onSuccess()
    } catch {
      toast.error('Failed to save integration. Try again.')
    } finally {
      setIsPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h2 className="text-xl font-semibold">
          {mode === 'create' ? 'New Integration' : 'Edit Integration'}
        </h2>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <FormField
            control={form.control}
            name="provider"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Provider</FormLabel>
                <Select
                  disabled={isPending || mode === 'edit'}
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a provider" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => (
                      <SelectItem key={p} value={p}>
                        {PROVIDER_LABELS[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="apiKey"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  API Key{mode === 'edit' && ' (leave blank to keep existing)'}
                </FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    placeholder={mode === 'edit' ? '••••••••••••••••' : 'Enter API key'}
                    disabled={isPending}
                    autoComplete="new-password"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {selectedProvider === 'gohighlevel' && (
            <FormField
              control={form.control}
              name="locationId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Location ID</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="GHL Location ID"
                      disabled={isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {selectedProvider === 'openrouter' && (
            <FormField
              control={form.control}
              name="defaultModel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Default Model (optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="anthropic/claude-haiku-4-5"
                      disabled={isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : mode === 'create' ? (
                'Add Integration'
              ) : (
                'Save Changes'
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={onSuccess}
            >
              {mode === 'create' ? 'Back to Integrations' : 'Discard Changes'}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  )
}
