// Currency formatting for ad accounts.
//
// Ad accounts report spend in their own currency — `getAdAccountInfo` and
// `getCustomerInfo` both return it — but the snapshot builder, the journey
// execution titles and the Copilot tool output all used to hardcode `$`. A BRL
// account therefore showed "$1.234" to the operator, and worse, handed the AI
// numbers labelled with the wrong currency to reason about.

const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK'])

/** Minor units per major unit (100 for USD/BRL/EUR, 1 for JPY). */
export function minorUnitsPerMajor(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 1 : 100
}

/**
 * Format a major-unit amount in the account's currency.
 * Falls back to a plain code-prefixed number if the runtime doesn't know the
 * currency, so an unusual code never throws in a render path.
 */
export function formatCurrency(
  amount: number,
  currency: string | null | undefined,
  opts: { locale?: string; maximumFractionDigits?: number } = {},
): string {
  const code = (currency ?? 'USD').toUpperCase()
  const locale = opts.locale ?? 'en-US'
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      maximumFractionDigits: opts.maximumFractionDigits ?? 2,
    }).format(amount)
  } catch {
    return `${code} ${amount.toFixed(opts.maximumFractionDigits ?? 2)}`
  }
}

/** Meta reports budgets in minor units (cents); spend already in major units. */
export function formatMetaBudget(minorUnits: string | number, currency: string | null | undefined): string {
  const amount = Number(minorUnits) / minorUnitsPerMajor((currency ?? 'USD').toUpperCase())
  return formatCurrency(amount, currency, { maximumFractionDigits: 0 })
}

/** Google reports money in micros (1e6 per major unit) regardless of currency. */
export function formatGoogleMicros(
  micros: string | number,
  currency: string | null | undefined,
  opts: { maximumFractionDigits?: number } = {},
): string {
  return formatCurrency(Number(micros) / 1_000_000, currency, opts)
}

/** Convert a major-unit budget to the minor units Meta's API expects. */
export function toMetaMinorUnits(amount: number, currency: string | null | undefined): number {
  return Math.round(amount * minorUnitsPerMajor((currency ?? 'USD').toUpperCase()))
}
