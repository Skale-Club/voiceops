import { redirect } from 'next/navigation'
import { createClient, getUser } from '@/lib/supabase/server'
import { WorkspaceSaveProvider } from '@/components/settings/workspace-save-bar'
import { CapiConfigForm } from './_components/capi-config-form'
import { CapiEventsTable } from './_components/capi-events-table'

export default async function CapiPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const supabase = await createClient()

  const [{ data: connections }, { data: config }, { data: events }] = await Promise.all([
    supabase
      .from('ads_connections')
      .select('ad_account_id, ad_account_name, status, health')
      .eq('platform', 'meta')
      .order('ad_account_name', { ascending: true }),
    supabase
      .from('meta_capi_config')
      .select('meta_ad_account_id, dataset_id, pixel_id, encrypted_capi_token, test_event_code, enabled, browser_pixel_enabled, default_currency, event_map')
      .maybeSingle(),
    supabase
      .from('meta_capi_events')
      .select('event_name, event_id, status, attempts, last_error, fb_trace_id, created_at, sent_at')
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const initial = {
    meta_ad_account_id: config?.meta_ad_account_id ?? '',
    dataset_id: config?.dataset_id ?? '',
    pixel_id: config?.pixel_id ?? '',
    has_token: Boolean(config?.encrypted_capi_token),
    test_event_code: config?.test_event_code ?? '',
    enabled: config?.enabled ?? false,
    browser_pixel_enabled: config?.browser_pixel_enabled ?? false,
    default_currency: config?.default_currency ?? 'USD',
    event_map: {
      lead: { enabled: config?.event_map?.lead?.enabled ?? true },
      qualified: {
        enabled: config?.event_map?.qualified?.enabled ?? true,
        stage_name: config?.event_map?.qualified?.stage_name ?? 'Qualified',
      },
      purchase: {
        enabled: config?.event_map?.purchase?.enabled ?? true,
        value_source: config?.event_map?.purchase?.value_source ?? 'opportunity_value',
      },
    },
  }

  return (
    <div className="space-y-8 p-6">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Conversions API (CAPI)</h1>
        <p className="mt-1 text-[13px] text-text-secondary">
          Send CRM conversions (Lead, Qualified Lead, Purchase) directly to your Meta dataset
          — with hashed data + fbc/fbp — to optimize campaigns based on real results.
        </p>
      </div>

      <WorkspaceSaveProvider>
        <CapiConfigForm
          initial={initial}
          connections={(connections ?? []).map((c) => ({
            id: c.ad_account_id,
            name: c.ad_account_name ?? c.ad_account_id,
            status: c.status,
            health: c.health,
          }))}
        />
      </WorkspaceSaveProvider>

      <CapiEventsTable events={events ?? []} />
    </div>
  )
}
