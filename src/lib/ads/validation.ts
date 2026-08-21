// Shared input validation for the Ads module.
//
// The Google Ads client builds GAQL by string interpolation (the API has no
// bound-parameter form), so every value that reaches a query literal has to be
// proven safe first. These schemas are the single place that happens: routes
// parse untrusted input with them, and google-api.ts asserts again at the
// boundary so the library stays safe regardless of caller.

import { z } from 'zod'

/** `YYYY-MM-DD`, and an actual calendar date (rejects 2026-02-31). */
export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  }, 'Not a valid calendar date')

/** Google Ads object ids (customer, campaign, budget, ad group) are digits only. */
export const NumericIdSchema = z
  .string()
  .min(1)
  .max(20)
  .regex(/^\d+$/, 'Must be a numeric id')

/** Meta object ids are digits, optionally prefixed `act_` for ad accounts. */
export const MetaAdAccountIdSchema = z
  .string()
  .regex(/^act_\d+$/, 'Ad account id must look like act_1234567890')

export const MetaObjectIdSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^\d+$/, 'Must be a numeric id')

export class AdsValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AdsValidationError'
  }
}

/** Throwing guard for values interpolated into GAQL date conditions. */
export function assertIsoDate(value: string, label: string): string {
  const parsed = IsoDateSchema.safeParse(value)
  if (!parsed.success) throw new AdsValidationError(`${label}: ${parsed.error.issues[0]?.message ?? 'invalid date'}`)
  return parsed.data
}

/** Throwing guard for ids interpolated into GAQL filters. */
export function assertNumericId(value: string, label: string): string {
  const parsed = NumericIdSchema.safeParse(value)
  if (!parsed.success) throw new AdsValidationError(`${label}: ${parsed.error.issues[0]?.message ?? 'invalid id'}`)
  return parsed.data
}

/** Google customer ids are often pasted as 123-456-7890 — store/query them bare. */
export function normalizeCustomerId(value: string): string {
  return value.replace(/-/g, '')
}
