'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Building2 } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CurrencySelect } from '@/components/pipeline/currency-select'
import { TimezoneSelect } from '@/components/settings/timezone-select'
import { useWorkspaceSaveSection } from '@/components/settings/workspace-save-bar'
import { cn } from '@/lib/utils'
import {
  updateCompanyProfile,
  updateDefaultCurrency,
} from '@/app/(dashboard)/settings/company-info/actions'
import { BUSINESS_TYPES, BUSINESS_TYPE_LABELS, type BusinessType } from '@/lib/org/business-type'

export interface CompanyProfileShape {
  /** Phase 138 Plan 00 (MODAL-00): what kind of business this org is. */
  business_type: BusinessType
  legal_name: string | null
  tax_id: string | null
  address_line1: string | null
  address_line2: string | null
  address_city: string | null
  address_state: string | null
  address_postal_code: string | null
  address_country: string | null
  timezone: string
  default_currency: string
}

interface Props {
  /** The org this form was loaded for — binds the save to that org (tenant safety). */
  orgId: string
  initial: CompanyProfileShape
}

// Curated country list (ISO-3166-1 alpha-2). Expand as needed.
const COUNTRIES: { code: string; name: string }[] = [
  { code: 'BR', name: 'Brazil' },
  { code: 'US', name: 'United States' },
  { code: 'PT', name: 'Portugal' },
  { code: 'CA', name: 'Canada' },
  { code: 'MX', name: 'Mexico' },
  { code: 'AR', name: 'Argentina' },
  { code: 'CL', name: 'Chile' },
  { code: 'CO', name: 'Colombia' },
  { code: 'ES', name: 'Spain' },
  { code: 'FR', name: 'France' },
  { code: 'DE', name: 'Germany' },
  { code: 'IT', name: 'Italy' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'IE', name: 'Ireland' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'JP', name: 'Japan' },
  { code: 'IN', name: 'India' },
  { code: 'AE', name: 'United Arab Emirates' },
]

const CONTROL_CLASS = 'border-border bg-bg-primary text-text-primary placeholder:text-text-tertiary'

export function CompanyProfileForm({ orgId, initial }: Props) {
  // Baseline = last-saved values. Dirty is computed against this so the page
  // save bar hides again right after a successful save (no router.refresh).
  const [baseline, setBaseline] = React.useState<CompanyProfileShape>(initial)
  const [businessType, setBusinessType] = React.useState<BusinessType>(initial.business_type ?? 'on_premises_shop')
  const [legalName, setLegalName] = React.useState(initial.legal_name ?? '')
  const [taxId, setTaxId] = React.useState(initial.tax_id ?? '')
  const [line1, setLine1] = React.useState(initial.address_line1 ?? '')
  const [line2, setLine2] = React.useState(initial.address_line2 ?? '')
  const [city, setCity] = React.useState(initial.address_city ?? '')
  const [state, setState] = React.useState(initial.address_state ?? '')
  const [postal, setPostal] = React.useState(initial.address_postal_code ?? '')
  const [country, setCountry] = React.useState(initial.address_country ?? '')
  const [timezone, setTimezone] = React.useState(initial.timezone ?? 'UTC')
  const [currency, setCurrency] = React.useState(initial.default_currency ?? 'USD')

  const dirty =
    businessType !== (baseline.business_type ?? 'on_premises_shop') ||
    legalName !== (baseline.legal_name ?? '') ||
    taxId !== (baseline.tax_id ?? '') ||
    line1 !== (baseline.address_line1 ?? '') ||
    line2 !== (baseline.address_line2 ?? '') ||
    city !== (baseline.address_city ?? '') ||
    state !== (baseline.address_state ?? '') ||
    postal !== (baseline.address_postal_code ?? '') ||
    country !== (baseline.address_country ?? '') ||
    timezone !== (baseline.timezone ?? 'UTC') ||
    currency !== (baseline.default_currency ?? 'USD')

  async function handleSave(): Promise<boolean> {
    const res = await updateCompanyProfile({
      orgId,
      business_type: businessType,
      legal_name: legalName,
      tax_id: taxId,
      address_line1: line1,
      address_line2: line2,
      address_city: city,
      address_state: state,
      address_postal_code: postal,
      address_country: country,
      timezone,
    })
    if (!res.ok) {
      toast.error(res.error ?? 'Failed to save company profile')
      return false
    }
    // Currency lives on its own action; only call when it changed.
    if (currency !== (baseline.default_currency ?? 'USD')) {
      const cur = await updateDefaultCurrency(currency, orgId)
      if (!cur.ok) {
        toast.error(cur.error ?? 'Failed to save currency')
        return false
      }
    }
    setBaseline({
      business_type: businessType,
      legal_name: legalName,
      tax_id: taxId,
      address_line1: line1,
      address_line2: line2,
      address_city: city,
      address_state: state,
      address_postal_code: postal,
      address_country: country,
      timezone,
      default_currency: currency,
    })
    toast.success('Company profile saved')
    return true
  }

  function handleReset() {
    setBusinessType(baseline.business_type ?? 'on_premises_shop')
    setLegalName(baseline.legal_name ?? '')
    setTaxId(baseline.tax_id ?? '')
    setLine1(baseline.address_line1 ?? '')
    setLine2(baseline.address_line2 ?? '')
    setCity(baseline.address_city ?? '')
    setState(baseline.address_state ?? '')
    setPostal(baseline.address_postal_code ?? '')
    setCountry(baseline.address_country ?? '')
    setTimezone(baseline.timezone ?? 'UTC')
    setCurrency(baseline.default_currency ?? 'USD')
  }

  useWorkspaceSaveSection({
    id: 'company-profile',
    dirty,
    save: handleSave,
    reset: handleReset,
  })

  return (
    <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-text-tertiary" />
            <CardTitle>Company</CardTitle>
          </div>
          <CardDescription>
            Legal identity, tax ID, address, timezone and currency. The address is
            used in email footers (legally required for marketing email) and the
            timezone drives how dates display across the dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Business type" htmlFor="business_type">
            <NativeSelect
              id="business_type"
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value as BusinessType)}
              className={CONTROL_CLASS}
            >
              {BUSINESS_TYPES.map((type) => (
                <option key={type} value={type}>{BUSINESS_TYPE_LABELS[type]}</option>
              ))}
            </NativeSelect>
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Legal name" htmlFor="legal_name">
              <Input id="legal_name" value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Acme Inc." maxLength={160} className={CONTROL_CLASS} />
            </Field>
            <Field label="Tax ID" htmlFor="tax_id">
              <Input id="tax_id" value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="CNPJ / EIN / VAT" maxLength={64} className={CONTROL_CLASS} />
            </Field>
          </div>

          <div className="space-y-3">
            <Field label="Address line 1" htmlFor="line1">
              <Input id="line1" value={line1} onChange={(e) => setLine1(e.target.value)} placeholder="Street, number" maxLength={200} className={CONTROL_CLASS} />
            </Field>
            <Field label="Address line 2" htmlFor="line2">
              <Input id="line2" value={line2} onChange={(e) => setLine2(e.target.value)} placeholder="Suite, unit (optional)" maxLength={200} className={CONTROL_CLASS} />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="City" htmlFor="city">
                <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} maxLength={120} className={CONTROL_CLASS} />
              </Field>
              <Field label="State / Region" htmlFor="state">
                <Input id="state" value={state} onChange={(e) => setState(e.target.value)} maxLength={120} className={CONTROL_CLASS} />
              </Field>
              <Field label="Postal code" htmlFor="postal">
                <Input id="postal" value={postal} onChange={(e) => setPostal(e.target.value)} maxLength={40} className={CONTROL_CLASS} />
              </Field>
            </div>
            <Field label="Country" htmlFor="country">
              <NativeSelect id="country" value={country} onChange={(e) => setCountry(e.target.value)} className={CONTROL_CLASS}>
                <option value="">Select country…</option>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </NativeSelect>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Timezone" htmlFor="timezone">
              <TimezoneSelect id="timezone" value={timezone} onChange={setTimezone} className={CONTROL_CLASS} />
            </Field>
            <Field label="Default currency" htmlFor="currency">
              <CurrencySelect value={currency} onChange={setCurrency} className={cn('w-full', CONTROL_CLASS)} />
            </Field>
          </div>
        </CardContent>
      </Card>
  )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-[12px] text-text-secondary">{label}</Label>
      {children}
    </div>
  )
}

function NativeSelect({
  children,
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        'h-9 w-full rounded-[8px] border border-border bg-bg-primary px-2.5 text-[13.5px] text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent',
        className,
      )}
    >
      {children}
    </select>
  )
}
