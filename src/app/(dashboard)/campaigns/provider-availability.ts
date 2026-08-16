import { createClient } from '@/lib/supabase/server'

export interface CampaignProviderAvailability {
  hasTwilio: boolean
  /** Voice campaigns place calls through the Vapi API — Twilio is never involved. */
  hasVapi: boolean
  hasResend: boolean
  hasWhatsApp: boolean
  whatsappCampaignProvider: 'meta_cloud' | 'zernio' | null
}

export async function getCampaignProviderAvailability(): Promise<CampaignProviderAvailability> {
  const supabase = await createClient()
  const [integRes, resendRes, whatsappCloudRes] = await Promise.all([
    supabase
      .from('integrations')
      .select('provider, health_status')
      .eq('is_active', true),
    supabase
      .from('tenant_email_integrations')
      .select('id')
      .eq('status', 'connected')
      .limit(1),
    supabase
      .from('whatsapp_cloud_accounts')
      .select('id')
      .eq('status', 'connected')
      .eq('is_active', true)
      .limit(1),
  ])

  const integrations = integRes.data ?? []
  const providers = new Set(integrations.map((i) => i.provider))
  const hasMetaCloudWhatsApp = (whatsappCloudRes.data ?? []).length > 0
  const hasZernioWhatsApp = integrations.some(
    (i) => i.provider === 'zernio' && i.health_status !== 'disconnected',
  )

  return {
    hasTwilio: providers.has('twilio'),
    hasVapi: providers.has('vapi'),
    hasResend: (resendRes.data ?? []).length > 0,
    hasWhatsApp: hasMetaCloudWhatsApp || hasZernioWhatsApp,
    whatsappCampaignProvider: hasMetaCloudWhatsApp
      ? 'meta_cloud'
      : hasZernioWhatsApp
        ? 'zernio'
        : null,
  }
}
