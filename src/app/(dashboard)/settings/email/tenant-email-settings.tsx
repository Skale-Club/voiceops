'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'

import {
  saveTenantEmailIntegration,
  testTenantEmailConnection,
  sendTestTenantEmail,
} from './actions'
import type { TenantEmailIntegrationRow } from '@/types/database'

type IntegrationSummary = Omit<TenantEmailIntegrationRow, 'api_key_encrypted' | 'webhook_secret_encrypted'> & {
  key_hint: string | null
  webhook_secret_hint: string | null
}

interface Props {
  initial: IntegrationSummary | null
}

export function TenantEmailSettings({ initial }: Props) {
  const [apiKey, setApiKey] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [fromName, setFromName] = useState(initial?.default_from_name ?? '')
  const [fromEmail, setFromEmail] = useState(initial?.default_from_email ?? '')
  const [replyTo, setReplyTo] = useState(initial?.default_reply_to ?? '')
  const [testTo, setTestTo] = useState('')

  const [isSaving, startSave] = useTransition()
  const [isTesting, startTest] = useTransition()
  const [isSendingTest, startSendTest] = useTransition()

  const status = initial?.status ?? 'disconnected'

  function onSave() {
    startSave(async () => {
      const res = await saveTenantEmailIntegration({
        apiKey: apiKey || undefined,
        webhookSecret: webhookSecret || undefined,
        defaultFromName: fromName,
        defaultFromEmail: fromEmail,
        defaultReplyTo: replyTo,
      })
      if (res?.error) {
        toast.error(res.error)
      } else {
        toast.success('Email settings saved')
        setApiKey('')
        setWebhookSecret('')
      }
    })
  }

  function onTest() {
    startTest(async () => {
      const res = await testTenantEmailConnection()
      if (res.ok) {
        toast.success('Connection verified — Resend API key is valid')
      } else {
        toast.error(res.error ?? 'Connection test failed')
      }
    })
  }

  function onSendTest() {
    if (!testTo.trim()) {
      toast.error('Enter a recipient email address')
      return
    }
    startSendTest(async () => {
      const res = await sendTestTenantEmail(testTo.trim())
      if (res.ok) {
        toast.success(`Test email sent to ${testTo}`)
      } else {
        toast.error(res.error ?? 'Failed to send test email')
      }
    })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Resend Integration</CardTitle>
              <CardDescription className="mt-1">
                Connect your Resend account to send emails from your domain to contacts and leads.
                Get your API key at{' '}
                <a
                  href="https://resend.com/api-keys"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  resend.com/api-keys
                </a>
                .
              </CardDescription>
            </div>
            <StatusBadge status={status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="resend-api-key">API Key</Label>
            <Input
              id="resend-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={initial?.key_hint ? `Current: ${initial.key_hint}` : 're_…'}
              autoComplete="off"
            />
            {initial?.key_hint && (
              <p className="text-xs text-muted-foreground">
                Leave blank to keep the existing key ({initial.key_hint}).
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="resend-webhook-secret">Webhook Signing Secret</Label>
            <Input
              id="resend-webhook-secret"
              type="password"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder={initial?.webhook_secret_hint ? `Current: ${initial.webhook_secret_hint}` : 'whsec_…'}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              {initial?.webhook_secret_hint
                ? `Leave blank to keep the existing secret (${initial.webhook_secret_hint}). `
                : ''}
              Copy this from the webhook you create in your Resend dashboard for the endpoints below.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="resend-from-name">Default From Name</Label>
              <Input
                id="resend-from-name"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                placeholder="Acme Support"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="resend-from-email">Default From Email</Label>
              <Input
                id="resend-from-email"
                type="email"
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
                placeholder="support@yourdomain.com"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="resend-reply-to">Reply-To (optional)</Label>
            <Input
              id="resend-reply-to"
              type="email"
              value={replyTo}
              onChange={(e) => setReplyTo(e.target.value)}
              placeholder="team@yourdomain.com"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={onSave} disabled={isSaving}>
              {isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : 'Save settings'}
            </Button>
            <Button variant="outline" onClick={onTest} disabled={isTesting || !initial?.key_hint}>
              {isTesting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Testing…</> : 'Test connection'}
            </Button>
          </div>

          {initial?.last_error && status === 'error' && (
            <p className="text-sm text-destructive">{initial.last_error}</p>
          )}
        </CardContent>
      </Card>

      {initial?.status === 'connected' && (
        <Card>
          <CardHeader>
            <CardTitle>Send test email</CardTitle>
            <CardDescription>
              Verify end-to-end delivery by sending a test email from your connected account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input
                type="email"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="you@example.com"
                className="max-w-sm"
              />
              <Button variant="outline" onClick={onSendTest} disabled={isSendingTest}>
                {isSendingTest ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending…</> : 'Send'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Inbound email webhook</CardTitle>
          <CardDescription>
            Set this URL in your Resend inbound routing settings to receive emails as conversations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border bg-muted px-3 py-2 font-mono text-xs">
            https://xphere.app/api/resend/inbound
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'connected') {
    return (
      <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50 gap-1">
        <CheckCircle2 className="h-3 w-3" />
        Connected
      </Badge>
    )
  }
  if (status === 'error') {
    return (
      <Badge variant="outline" className="text-red-600 border-red-200 bg-red-50 gap-1">
        <XCircle className="h-3 w-3" />
        Error
      </Badge>
    )
  }
  return (
    <Badge variant="secondary">
      Disconnected
    </Badge>
  )
}
