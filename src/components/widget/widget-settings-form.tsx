'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { zodResolver } from '@hookform/resolvers/zod'
import { Bot, Loader2, Trash2, Upload } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import {
  saveWidgetSettings,
  uploadWidgetAvatar,
  type WidgetSettingsInput,
} from '@/app/(dashboard)/widget/actions'
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
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { setChannelDefault } from '@/app/(dashboard)/agents/actions'
import { WidgetPlacementEditor } from '@/components/widget/widget-placement-editor'
import {
  WIDGET_OFFSET_DEFAULT,
  WIDGET_OFFSET_MAX,
  WIDGET_OFFSET_MIN,
  WIDGET_POSITION_DEFAULT,
} from '@/lib/widget/position'

const widgetSettingsSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Display name is required.')
    .max(60, 'Display name must be 60 characters or fewer.'),
  welcomeMessage: z
    .string()
    .trim()
    .min(1, 'Welcome message is required.')
    .max(280, 'Welcome message must be 280 characters or fewer.'),
  avatarUrl: z.string().trim().optional().nullable(),
  greetingEnabled: z.boolean().optional(),
  greetingMessage: z.string().trim().max(160, 'Greeting must be 160 characters or fewer.').optional().nullable(),
  greetingDelaySeconds: z.coerce.number().int().min(0).max(30).optional(),
  urlMode: z.enum(['all', 'allowlist', 'blocklist']),
  // Textarea value: one URL pattern per line. Normalized to an array on save.
  urlRules: z.string().optional(),
  // Literal union (not WIDGET_POSITIONS spread) so zod infers WidgetPosition
  // itself, keeping saveWidgetSettings(values) assignable without a cast.
  position: z.enum(['top-left', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-right']),
  offsetX: z.coerce.number().int().min(WIDGET_OFFSET_MIN).max(WIDGET_OFFSET_MAX),
  offsetY: z.coerce.number().int().min(WIDGET_OFFSET_MIN).max(WIDGET_OFFSET_MAX),
})

/** Join a stored rules array (or string) into the textarea's newline form. */
function rulesToText(rules: string[] | string | null | undefined): string {
  return Array.isArray(rules) ? rules.join('\n') : rules ?? ''
}

type WidgetSettingsFormValues = z.infer<typeof widgetSettingsSchema>

interface AgentOption {
  id: string
  name: string
}

interface WidgetSettingsFormProps {
  initialSettings: WidgetSettingsInput
  widgetToken: string
  agents?: AgentOption[]
  currentAgentId?: string | null
}

export function WidgetSettingsForm({
  initialSettings,
  widgetToken,
  agents = [],
  currentAgentId = null,
}: WidgetSettingsFormProps) {
  const [agentId, setAgentId] = useState<string | null>(currentAgentId)
  const [savingAgent, setSavingAgent] = useState(false)
  const router = useRouter()
  const [savedSettings, setSavedSettings] = useState(initialSettings)
  const [isSaving, setIsSaving] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialSettings.avatarUrl ?? null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  async function handleAgentChange(value: string) {
    const next = value === '__none__' ? null : value
    setSavingAgent(true)
    try {
      await setChannelDefault('web_widget', next)
      setAgentId(next)
      toast.success(next ? 'Agent linked to widget.' : 'Agent unlinked from widget.')
    } catch {
      toast.error('Failed to update agent.')
    } finally {
      setSavingAgent(false)
    }
  }
  const form = useForm<WidgetSettingsFormValues>({
    resolver: zodResolver(widgetSettingsSchema),
    mode: 'onSubmit',
    defaultValues: {
      displayName: savedSettings.displayName,
      welcomeMessage: savedSettings.welcomeMessage,
      avatarUrl: savedSettings.avatarUrl ?? null,
      greetingEnabled: savedSettings.greetingEnabled ?? true,
      greetingMessage: savedSettings.greetingMessage ?? '',
      greetingDelaySeconds: savedSettings.greetingDelaySeconds ?? 3,
      urlMode: savedSettings.urlMode ?? 'all',
      urlRules: rulesToText(savedSettings.urlRules),
      position: savedSettings.position ?? WIDGET_POSITION_DEFAULT,
      offsetX: savedSettings.offsetX ?? WIDGET_OFFSET_DEFAULT,
      offsetY: savedSettings.offsetY ?? WIDGET_OFFSET_DEFAULT,
    },
  })

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
        form.reset({ ...result.settings, urlRules: rulesToText(result.settings.urlRules) })
      }

      toast.success('Widget settings saved.')
      router.refresh()
    } catch {
      toast.error('Failed to save widget settings. Try again.')
    } finally {
      setIsSaving(false)
    }
  }

  const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp']

  async function handleAvatarSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    if (!ACCEPTED.includes(file.type)) { toast.error('Use PNG, JPEG or WEBP'); return }
    if (file.size > 4 * 1024 * 1024) { toast.error('Image must be under 4 MB'); return }
    setUploadingAvatar(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await uploadWidgetAvatar(fd)
      if (!res.ok) throw new Error(res.error)
      const url = res.url
      setAvatarUrl(url)
      // Persist immediately so the widget preview updates
      await saveWidgetSettings({ ...form.getValues(), avatarUrl: url })
      toast.success('Avatar updated')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Avatar upload failed')
    } finally {
      setUploadingAvatar(false)
    }
  }

  async function handleAvatarRemove() {
    setUploadingAvatar(true)
    try {
      setAvatarUrl(null)
      await saveWidgetSettings({ ...form.getValues(), avatarUrl: null })
      toast.success('Avatar removed')
      router.refresh()
    } catch {
      toast.error('Failed to remove avatar')
    } finally {
      setUploadingAvatar(false)
    }
  }

  const isPending = isSaving

  const initials = (form.watch('displayName') || 'AI').trim().slice(0, 2).toUpperCase()

  return (
    <div className="space-y-6">
      {/* Avatar card */}
      <Card>
        <CardHeader>
          <CardTitle>Chatbot avatar</CardTitle>
          <CardDescription>
            Square image shown in the widget header and bubble. PNG, JPEG or WEBP, max 4 MB.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-5">
            {/* Preview */}
            <div
              className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-semibold text-white ring-1 ring-border"
              style={{ backgroundColor: '#6366F1' }}
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="Bot avatar" className="h-full w-full object-cover" />
              ) : (
                initials
              )}
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingAvatar}
                >
                  {uploadingAvatar ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  {avatarUrl ? 'Change' : 'Upload'}
                </Button>
                {avatarUrl && (
                  <Button type="button" size="sm" variant="ghost" onClick={handleAvatarRemove} disabled={uploadingAvatar}>
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </Button>
                )}
              </div>
              <p className="text-[11.5px] text-text-tertiary">Square works best · max 4 MB</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED.join(',')}
              onChange={handleAvatarSelect}
              className="hidden"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Widget settings</CardTitle>
          <CardDescription>
            Customize the assistant name and welcome copy shown to visitors. The color is inherited from your Company info accent color.
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

              {/* Greeting composer — minimized "Write a message…" prompt */}
              <div className="space-y-4 rounded-[10px] border border-border bg-bg-secondary/40 p-4">
                <FormField
                  control={form.control}
                  name="greetingEnabled"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between gap-3 space-y-0">
                      <div className="space-y-0.5">
                        <FormLabel>Greeting composer</FormLabel>
                        <FormDescription>
                          Slide a &ldquo;Write a message…&rdquo; prompt in beside the bubble after a short delay.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value ?? true}
                          onCheckedChange={field.onChange}
                          disabled={isPending}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="greetingDelaySeconds"
                  render={({ field }) => (
                    <FormItem className="max-w-[160px]">
                      <FormLabel>Delay (seconds)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          max={30}
                          disabled={isPending || !form.watch('greetingEnabled')}
                          value={field.value ?? 3}
                          onChange={(e) => field.onChange(e.target.valueAsNumber)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Placement — screen anchor + spacing from the edges it hugs */}
              <WidgetPlacementEditor
                position={form.watch('position')}
                offsetX={form.watch('offsetX')}
                offsetY={form.watch('offsetY')}
                onPositionChange={(value) => form.setValue('position', value, { shouldDirty: true })}
                onOffsetXChange={(value) => form.setValue('offsetX', value, { shouldDirty: true })}
                onOffsetYChange={(value) => form.setValue('offsetY', value, { shouldDirty: true })}
                disabled={isPending}
              />

              {/* URL rules — authorize where the widget is allowed to run */}
              <div className="space-y-4 rounded-[10px] border border-border bg-bg-secondary/40 p-4">
                <FormField
                  control={form.control}
                  name="urlMode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Where the widget runs</FormLabel>
                      <FormControl>
                        <Select
                          value={field.value ?? 'all'}
                          onValueChange={field.onChange}
                          disabled={isPending}
                        >
                          <SelectTrigger className="max-w-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Run on every page</SelectItem>
                            <SelectItem value="allowlist">Only on allowed URLs</SelectItem>
                            <SelectItem value="blocklist">Everywhere except blocked URLs</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormDescription>
                        Restrict which pages may load the chat widget. Enforced both in the
                        browser and on the server.
                      </FormDescription>
                    </FormItem>
                  )}
                />

                {form.watch('urlMode') !== 'all' && (
                  <FormField
                    control={form.control}
                    name="urlRules"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {form.watch('urlMode') === 'allowlist' ? 'Allowed URLs' : 'Blocked URLs'}
                        </FormLabel>
                        <FormControl>
                          <Textarea
                            disabled={isPending}
                            rows={5}
                            className="font-mono text-[12.5px]"
                            placeholder={'example.com\n*.example.com\nexample.com/checkout\nshop.example.com/app/*'}
                            value={field.value ?? ''}
                            onChange={field.onChange}
                          />
                        </FormControl>
                        <FormDescription>
                          One pattern per line. A bare domain matches any path; add a path such as{' '}
                          <code>example.com/checkout</code> or a wildcard <code>example.com/app/*</code>.
                          Use <code>*.example.com</code> to include subdomains, or <code>*/path</code> for any host.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>

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
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* AI Agent */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-accent" />
            AI Agent
          </CardTitle>
          <CardDescription>
            Select the agent that handles conversations in this widget. Without an agent, the widget
            collects messages but does not auto-reply.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={agentId ?? '__none__'}
            onValueChange={handleAgentChange}
            disabled={savingAgent}
          >
            <SelectTrigger className="max-w-xs">
              <SelectValue placeholder="Select an agent…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">
                <span className="text-text-tertiary">No agent (manual only)</span>
              </SelectItem>
              {agents.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {agents.length === 0 && (
            <p className="mt-2 text-[12px] text-text-tertiary">
              No active agents found. Create an agent first in the Agents section.
            </p>
          )}
        </CardContent>
      </Card>

    </div>
  )
}
