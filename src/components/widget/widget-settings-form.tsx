'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { zodResolver } from '@hookform/resolvers/zod'
import { Copy, Loader2, RefreshCw } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import {
  regenerateWidgetToken,
  saveWidgetSettings,
  type WidgetSettingsInput,
} from '@/app/(dashboard)/widget/actions'
import { WidgetPreview } from '@/components/widget/widget-preview'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Textarea } from '@/components/ui/textarea'

const widgetSettingsSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Display name is required.')
    .max(60, 'Display name must be 60 characters or fewer.'),
  primaryColor: z
    .string()
    .trim()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Use a hex color in #RRGGBB format.'),
  welcomeMessage: z
    .string()
    .trim()
    .min(1, 'Welcome message is required.')
    .max(280, 'Welcome message must be 280 characters or fewer.'),
  avatarUrl: z.string().trim().optional().nullable(),
})

type WidgetSettingsFormValues = z.infer<typeof widgetSettingsSchema>

interface WidgetSettingsFormProps {
  initialSettings: WidgetSettingsInput
  widgetToken: string
}

export function WidgetSettingsForm({
  initialSettings,
  widgetToken,
}: WidgetSettingsFormProps) {
  const router = useRouter()
  const [savedSettings, setSavedSettings] = useState(initialSettings)
  const [isSaving, setIsSaving] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [currentToken, setCurrentToken] = useState(widgetToken)

  const form = useForm<WidgetSettingsFormValues>({
    resolver: zodResolver(widgetSettingsSchema),
    mode: 'onSubmit',
    defaultValues: savedSettings,
  })

  const previewValues = form.watch()
  const embedCode = useMemo(
    () => `<script src="https://opps.skale.club/widget.js" data-token="${currentToken}"></script>`,
    [currentToken]
  )

  async function handleCopyEmbedCode() {
    try {
      await navigator.clipboard.writeText(embedCode)
      toast.success('Embed code copied.')
    } catch {
      toast.error('Failed to copy embed code.')
    }
  }

  async function onSubmit(values: WidgetSettingsFormValues) {
    setIsSaving(true)

    try {
      const result = await saveWidgetSettings(values)

      if (result && 'error' in result && result.error) {
        toast.error(result.error)
        return
      }

      if (result?.settings) {
        setSavedSettings(result.settings)
        form.reset(result.settings)
      }

      toast.success('Widget settings saved.')
      router.refresh()
    } catch {
      toast.error('Failed to save widget settings. Try again.')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleRegenerateToken() {
    setIsRegenerating(true)

    try {
      const result = await regenerateWidgetToken()

      if (result && 'error' in result && result.error) {
        toast.error(result.error)
        return
      }

      if (result?.widgetToken) {
        setCurrentToken(result.widgetToken)
      }

      toast.success('Widget token regenerated. Old installs are now invalid.')
      router.refresh()
    } catch {
      toast.error('Failed to regenerate widget token. Try again.')
    } finally {
      setIsRegenerating(false)
    }
  }

  const isPending = isSaving || isRegenerating

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Widget settings</CardTitle>
          <CardDescription>
            Customize the assistant name, color, and welcome copy shown to visitors.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="displayName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Display name</FormLabel>
                    <FormControl>
                      <Input disabled={isPending} placeholder="AI Assistant" {...field} />
                    </FormControl>
                    <FormDescription>The widget header label visitors see.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="primaryColor"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Primary color</FormLabel>
                    <FormControl>
                      <div className="flex gap-3">
                        <Input disabled={isPending} placeholder="#18181B" {...field} />
                        <div
                          aria-hidden="true"
                          className="h-10 w-10 shrink-0 rounded-md border"
                          style={{ backgroundColor: field.value || '#18181B' }}
                        />
                      </div>
                    </FormControl>
                    <FormDescription>Hex only, for example #18181B.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="welcomeMessage"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Welcome message</FormLabel>
                    <FormControl>
                      <Textarea
                        disabled={isPending}
                        placeholder="Hi! How can I help?"
                        rows={4}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>Shown as the first assistant message in the widget.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex flex-wrap gap-3">
                <Button type="submit" disabled={isPending}>
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save settings'
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => form.reset(savedSettings)}
                >
                  Reset
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Live preview</CardTitle>
          <CardDescription>Unsaved edits appear here immediately.</CardDescription>
        </CardHeader>
        <CardContent>
          <WidgetPreview
            displayName={previewValues.displayName}
            primaryColor={previewValues.primaryColor}
            welcomeMessage={previewValues.welcomeMessage}
            avatarUrl={previewValues.avatarUrl}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Install snippet</CardTitle>
          <CardDescription>
            Use the canonical production widget asset with this org&apos;s current token.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-xs leading-6">
            <code>{embedCode}</code>
          </pre>
          <Button type="button" variant="outline" onClick={handleCopyEmbedCode}>
            <Copy className="mr-2 h-4 w-4" />
            Copy script tag
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>Danger zone</CardTitle>
          <CardDescription>
            Regenerating the widget token immediately invalidates every previously installed embed
            script.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Replace the old token everywhere the widget is installed as soon as you rotate it.
          </p>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="destructive" disabled={isPending}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Regenerate token
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Regenerate widget token?</AlertDialogTitle>
                <AlertDialogDescription>
                  This change takes effect immediately. All existing embed installs using the old
                  token will stop working until they are updated.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isRegenerating}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={isRegenerating}
                  onClick={(event) => {
                    event.preventDefault()
                    void handleRegenerateToken()
                  }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isRegenerating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Regenerating...
                    </>
                  ) : (
                    'Regenerate token'
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  )
}
