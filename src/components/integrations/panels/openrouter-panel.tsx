'use client'

// SEED-042 | OpenRouter custom panel.
// API key form. After Test passes (or when an existing key is detected) we
// fetch /api/v1/models from openrouter.ai and let the user pick a default
// text / vision / audio model. Selections persist on the integration `config`.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Check,
  ChevronsUpDown,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Save,
  Search,
  X,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

import { IntegrationLogo } from '../integration-logo'
import {
  saveIntegrationCredentials,
  testIntegrationConnection,
  toggleIntegrationActive,
} from '@/app/(dashboard)/integrations/actions'
import type { CustomPanelProps } from '@/lib/integrations/registry'

interface OpenRouterModel {
  id: string
  name: string
  modalities: string[] // 'text' | 'image' | 'audio'
}

// Fallback list shown when we can't reach openrouter.ai (no key yet, or
// outbound network blocked). Curated set of popular models with their
// modalities so the panel is always usable.
const FALLBACK_MODELS: OpenRouterModel[] = [
  { id: 'anthropic/claude-opus-4-7', name: 'Claude Opus 4.7', modalities: ['text', 'image'] },
  { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6', modalities: ['text', 'image'] },
  { id: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5', modalities: ['text'] },
  { id: 'openai/gpt-4o', name: 'GPT-4o', modalities: ['text', 'image', 'audio'] },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini', modalities: ['text', 'image'] },
  { id: 'openai/whisper-1', name: 'Whisper v1', modalities: ['audio'] },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', modalities: ['text', 'image', 'audio'] },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', modalities: ['text', 'image'] },
]

export function OpenRouterPanel({ definition, existing, onClose }: CustomPanelProps) {
  const router = useRouter()
  const cfg = (existing?.config ?? {}) as Record<string, string>

  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [keyTouched, setKeyTouched] = useState(false)
  const [testState, setTestState] = useState<'idle' | 'testing' | 'pass' | 'fail'>(
    existing ? 'pass' : 'idle',
  )
  const [testMessage, setTestMessage] = useState(
    existing ? 'Saved credentials in use.' : '',
  )
  const [models, setModels] = useState<OpenRouterModel[]>(FALLBACK_MODELS)
  const [textModel, setTextModel] = useState<string>(cfg.text_model ?? '')
  const [visionModel, setVisionModel] = useState<string>(cfg.vision_model ?? '')
  const [audioModel, setAudioModel] = useState<string>(cfg.audio_model ?? '')
  const [isSaving, setIsSaving] = useState(false)
  const [isActive, setIsActive] = useState(existing?.is_active ?? false)
  const [isToggling, setIsToggling] = useState(false)
  const [modelsLoading, setModelsLoading] = useState(false)

  // Refresh models when test passes (or on mount if already-saved).
  useEffect(() => {
    if (testState !== 'pass') return
    let cancelled = false
    setModelsLoading(true)
    fetch('/api/openrouter/models')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((data: { models: OpenRouterModel[] }) => {
        if (cancelled || !Array.isArray(data?.models) || data.models.length === 0) return
        setModels(data.models)
      })
      .catch(() => {
        /* keep fallback */
      })
      .finally(() => !cancelled && setModelsLoading(false))
    return () => {
      cancelled = true
    }
  }, [testState])

  async function handleTest() {
    setTestState('testing')
    setTestMessage('Testing OpenRouter key…')
    const res = await testIntegrationConnection('openrouter', { api_key: apiKey })
    if (res.ok) {
      setTestState('pass')
      setTestMessage('Key valid. Pick your default models below.')
    } else {
      setTestState('fail')
      setTestMessage(res.error ?? 'Test failed.')
    }
  }

  async function handleSave() {
    setIsSaving(true)
    try {
      const payload: Record<string, string> = {
        text_model: textModel,
        vision_model: visionModel,
        audio_model: audioModel,
      }
      if (apiKey.trim()) payload.api_key = apiKey
      else if (existing) {
        // Re-use saved credentials for model-only updates.
        // saveIntegrationCredentials requires api_key; emit a friendlier toast
        // when the user only changed selectors.
        toast.error('Re-enter the API key to save changes.')
        return
      }
      const res = await saveIntegrationCredentials('openrouter', payload)
      if (!res.ok) {
        toast.error(res.error ?? 'Failed to save.')
        return
      }
      toast.success('OpenRouter saved.')
      router.refresh()
      onClose()
    } finally {
      setIsSaving(false)
    }
  }

  async function handleToggleActive(next: boolean) {
    if (!existing) return
    setIsToggling(true)
    const prev = isActive
    setIsActive(next)
    try {
      const res = await toggleIntegrationActive('openrouter', next)
      if (!res.ok) {
        setIsActive(prev)
        toast.error(res.error ?? 'Failed to update.')
      } else {
        toast.success(next ? 'OpenRouter activated.' : 'OpenRouter deactivated.')
        router.refresh()
      }
    } finally {
      setIsToggling(false)
    }
  }

  const showKeyMask = !!existing && !keyTouched

  const canSave = apiKey.trim().length > 0
    ? testState === 'pass'
    : !!existing && (textModel || visionModel || audioModel).length > 0

  const textModels = models.filter((m) => m.modalities.includes('text'))
  const visionModels = models.filter((m) => m.modalities.includes('image'))
  const audioModels = models.filter((m) => m.modalities.includes('audio'))

  return (
    <div className="flex flex-1 min-h-0 flex-col px-6 pt-6 pb-4">
      <SheetHeader className="space-y-3 pb-4">
        <div className="flex items-center gap-3">
          <IntegrationLogo logo={definition.logo} name={definition.name} size={40} />
          <div className="min-w-0">
            <SheetTitle className="text-[15px]">{definition.name}</SheetTitle>
            <p className="text-[12px] text-text-tertiary">{definition.description}</p>
          </div>
        </div>
        <a
          href="https://openrouter.ai/keys"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline"
        >
          <ExternalLink className="h-3 w-3" /> Get an API key
        </a>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto space-y-5 py-2">
        <div className="space-y-1.5">
          <Label htmlFor="or-key">
            API Key<span className="ml-0.5 text-rose-400">*</span>
          </Label>
          <div className="relative">
            <Input
              id="or-key"
              type={showKeyMask ? 'text' : (showKey ? 'text' : 'password')}
              placeholder={showKeyMask ? '' : 'sk-or-...'}
              value={showKeyMask ? (existing?.masked_api_key ?? '••••••••••••') : apiKey}
              readOnly={showKeyMask}
              onFocus={() => { if (showKeyMask) setKeyTouched(true) }}
              onChange={(e) => {
                setApiKey(e.target.value)
                setTestState('idle')
              }}
              autoComplete="new-password"
              className={showKeyMask ? 'cursor-text' : undefined}
            />
            {!showKeyMask && (
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
                aria-label={showKey ? 'Hide' : 'Show'}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            )}
          </div>
        </div>

        {testState !== 'idle' && (
          <div
            className={cn(
              'flex items-center gap-2 rounded-[8px] px-3 py-2 text-[12.5px]',
              testState === 'pass' && 'bg-[var(--success-muted)] text-success',
              testState === 'fail' && 'bg-rose-500/10 text-rose-400',
              testState === 'testing' && 'bg-bg-tertiary text-text-tertiary',
            )}
          >
            {testState === 'testing' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {testState === 'pass' && <Check className="h-3.5 w-3.5" />}
            {testState === 'fail' && <X className="h-3.5 w-3.5" />}
            <span>{testMessage}</span>
          </div>
        )}

        {testState === 'pass' && (
          <div className="space-y-4 pt-2">
            <div className="flex items-center justify-between">
              <p className="text-[12px] font-medium uppercase tracking-wide text-text-tertiary">
                Default models
              </p>
              {modelsLoading && (
                <Loader2 className="h-3 w-3 animate-spin text-text-tertiary" />
              )}
            </div>

            <ModelSelector
              label="Text model"
              description="Used by chat agents and workflows."
              models={textModels}
              value={textModel}
              onChange={setTextModel}
            />

            <ModelSelector
              label="Vision model"
              description="Image and document analysis."
              models={visionModels}
              value={visionModel}
              onChange={setVisionModel}
            />

            <ModelSelector
              label="Audio model (STT)"
              description="Transcription | Whisper and similar."
              models={audioModels}
              value={audioModel}
              onChange={setAudioModel}
            />
          </div>
        )}
      </div>

      <div className="space-y-3 border-t border-border-subtle pt-4">
        {definition.canActivate && existing && (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] font-medium text-text-primary">Active</p>
              <p className="text-[11px] text-text-tertiary">
                {isActive
                  ? 'Models routed through OpenRouter.'
                  : 'Saved but not used.'}
              </p>
            </div>
            <Switch checked={isActive} disabled={isToggling} onCheckedChange={handleToggleActive} />
          </div>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={testState === 'testing' || isSaving || !apiKey.trim()}
            className="flex-1"
          >
            {testState === 'testing' ? (
              <>
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Testing…
              </>
            ) : (
              <>
                <Zap className="mr-1 h-3.5 w-3.5" /> Test
              </>
            )}
          </Button>
          <Button onClick={handleSave} disabled={!canSave || isSaving} className="flex-1">
            {isSaving ? (
              <>
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Saving…
              </>
            ) : (
              <>
                <Save className="mr-1 h-3.5 w-3.5" /> Save
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

interface ModelSelectorProps {
  label: string
  description: string
  models: OpenRouterModel[]
  value: string
  onChange: (next: string) => void
}

function ModelSelector({ label, description, models, value, onChange }: ModelSelectorProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const selected = models.find((m) => m.id === value)

  const filtered = models.filter((m) => {
    if (!query) return true
    const q = query.toLowerCase()
    return m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
  })

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <p className="text-[11px] text-text-tertiary">{description}</p>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-between text-left font-normal">
            <span className="truncate">
              {selected ? selected.name : value || 'Select model…'}
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[360px] p-0" align="start">
          <div className="flex items-center border-b border-border-subtle px-3">
            <Search className="mr-2 h-3.5 w-3.5 shrink-0 text-text-tertiary" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search model…"
              className="flex-1 bg-transparent py-2.5 text-[13px] outline-none placeholder:text-text-tertiary"
            />
          </div>
          <ScrollArea className="h-[240px]">
            {filtered.length === 0 ? (
              <p className="py-4 text-center text-[12px] text-text-tertiary">No results</p>
            ) : (
              filtered.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onChange(m.id)
                    setOpen(false)
                    setQuery('')
                  }}
                  className={cn(
                    'block w-full px-3 py-2 text-left text-[13px] hover:bg-bg-tertiary',
                    value === m.id && 'bg-[var(--accent-muted)] text-accent',
                  )}
                >
                  <p className="font-medium">{m.name}</p>
                  <p className="text-[11px] text-text-tertiary">{m.id}</p>
                </button>
              ))
            )}
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  )
}
