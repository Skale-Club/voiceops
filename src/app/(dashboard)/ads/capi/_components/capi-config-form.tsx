'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card } from '@/components/ui/card'
import { useWorkspaceSaveSection } from '@/components/settings/workspace-save-bar'
import { saveCapiConfig, sendTestEvent, type CapiConfigInput } from '../actions'

interface Connection {
  id: string
  name: string
  status: string
  health: string
}

interface InitialConfig {
  meta_ad_account_id: string
  dataset_id: string
  pixel_id: string
  has_token: boolean
  test_event_code: string
  enabled: boolean
  browser_pixel_enabled: boolean
  default_currency: string
  event_map: {
    lead: { enabled: boolean }
    qualified: { enabled: boolean; stage_name: string }
    purchase: { enabled: boolean; value_source: string }
  }
}

export function CapiConfigForm({
  initial,
  connections,
}: {
  initial: InitialConfig
  connections: Connection[]
}) {
  const [baseline, setBaseline] = useState(initial)
  const [form, setForm] = useState(initial)
  const [token, setToken] = useState('')
  const [pending, startTransition] = useTransition()
  const [testing, setTesting] = useState(false)

  const dirty = JSON.stringify(form) !== JSON.stringify(baseline) || token !== ''

  function set<K extends keyof InitialConfig>(key: K, value: InitialConfig[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSave(): Promise<boolean> {
    const input: CapiConfigInput = {
      meta_ad_account_id: form.meta_ad_account_id || null,
      dataset_id: form.dataset_id || null,
      pixel_id: form.pixel_id || null,
      capi_token: token || null,
      test_event_code: form.test_event_code || null,
      enabled: form.enabled,
      browser_pixel_enabled: form.browser_pixel_enabled,
      default_currency: form.default_currency || 'USD',
      event_map: form.event_map,
    }
    return new Promise((resolve) => {
      startTransition(async () => {
        const res = await saveCapiConfig(input)
        if (res.ok) {
          toast.success('Configuration saved')
          setToken('')
          setBaseline({ ...form, has_token: form.has_token || Boolean(token) })
          setForm((f) => ({ ...f, has_token: f.has_token || Boolean(token) }))
          resolve(true)
        } else {
          toast.error(res.error ?? 'Failed to save')
          resolve(false)
        }
      })
    })
  }

  function handleReset() {
    setForm(baseline)
    setToken('')
  }

  useWorkspaceSaveSection({
    id: 'capi-config',
    dirty,
    save: handleSave,
    reset: handleReset,
  })

  async function test() {
    setTesting(true)
    const res = await sendTestEvent()
    setTesting(false)
    if (res.ok) toast.success(`Test event sent${res.fbtrace_id ? ` (trace ${res.fbtrace_id})` : ''}`)
    else toast.error(res.error ?? 'Failed to send')
  }

  return (
    <div className="space-y-6">
      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-[13px] font-medium">Enable CAPI</Label>
            <p className="text-[12px] text-text-secondary">Send conversions from this tenant to Meta.</p>
          </div>
          <Switch checked={form.enabled} onCheckedChange={(v) => set('enabled', v)} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Ad Account (Meta)">
            <select
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-primary px-2 text-[13px]"
              value={form.meta_ad_account_id}
              onChange={(e) => set('meta_ad_account_id', e.target.value)}
            >
              <option value="">— select —</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{' '}
                  {c.health !== 'ok'
                    ? `(${c.health})`
                    : c.status === 'active'
                      ? ''
                      : `(${c.status})`}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Default Currency">
            <Input
              value={form.default_currency}
              maxLength={3}
              onChange={(e) => set('default_currency', e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="Dataset / Pixel ID (event destination)">
            <Input value={form.dataset_id} onChange={(e) => set('dataset_id', e.target.value)} placeholder="123456789012345" />
          </Field>
          <Field label="Pixel ID (browser, for dedup)">
            <Input value={form.pixel_id} onChange={(e) => set('pixel_id', e.target.value)} placeholder="usually = dataset id" />
          </Field>
          <Field label={`Dedicated CAPI Token ${form.has_token ? '(saved)' : '(optional)'}`}>
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={form.has_token ? '•••••• (leave blank to keep)' : 'uses Meta connection token if blank'}
            />
          </Field>
          <Field label="Test Event Code (Events Manager)">
            <Input value={form.test_event_code} onChange={(e) => set('test_event_code', e.target.value)} placeholder="TEST12345" />
          </Field>
        </div>

        <div className="flex items-center justify-between border-t border-border-subtle pt-3">
          <div>
            <Label className="text-[13px] font-medium">Browser Pixel</Label>
            <p className="text-[12px] text-text-secondary">Inject the Pixel via tracking script (dedup by event_id).</p>
          </div>
          <Switch checked={form.browser_pixel_enabled} onCheckedChange={(v) => set('browser_pixel_enabled', v)} />
        </div>
      </Card>

      <Card className="space-y-3 p-5">
        <Label className="text-[13px] font-medium">Events sent</Label>
        <EventToggle
          label="Lead — contact created"
          checked={form.event_map.lead.enabled}
          onChange={(v) => set('event_map', { ...form.event_map, lead: { enabled: v } })}
        />
        <div className="space-y-2">
          <EventToggle
            label="Qualified Lead — opportunity changes stage"
            checked={form.event_map.qualified.enabled}
            onChange={(v) => set('event_map', { ...form.event_map, qualified: { ...form.event_map.qualified, enabled: v } })}
          />
          {form.event_map.qualified.enabled && (
            <div className="pl-2">
              <Field label="Stage name that triggers">
                <Input
                  className="max-w-xs"
                  value={form.event_map.qualified.stage_name}
                  onChange={(e) => set('event_map', { ...form.event_map, qualified: { ...form.event_map.qualified, stage_name: e.target.value } })}
                />
              </Field>
            </div>
          )}
        </div>
        <EventToggle
          label="Purchase — opportunity won (with value)"
          checked={form.event_map.purchase.enabled}
          onChange={(v) => set('event_map', { ...form.event_map, purchase: { ...form.event_map.purchase, enabled: v } })}
        />
      </Card>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={test} disabled={testing || pending}>
          {testing ? 'Sending…' : 'Send test event'}
        </Button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[12px] text-text-secondary">{label}</Label>
      {children}
    </div>
  )
}

function EventToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[13px] text-text-primary">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}
