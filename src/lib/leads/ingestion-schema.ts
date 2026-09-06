import { createHash } from 'node:crypto'
import { z } from 'zod'

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional()

// Sibling products allowed to push leads. `source_product` is stored as plain
// text and is part of the receipt dedup key, so each product MUST keep its own
// value — never reuse another product's value to "get through" validation.
//   skaleclub_websites — the forkable Websites platform (github.com/Skale-Club/websites)
//   skaleclub          — the Skale Club marketing site (skale.club) and its landing forms
export const LEAD_SOURCE_PRODUCTS = ['skaleclub_websites', 'skaleclub'] as const
export type LeadSourceProduct = (typeof LEAD_SOURCE_PRODUCTS)[number]

export const leadIngestionSchema = z.object({
  schema_version: z.literal('1.0'),
  event_id: z.string().trim().min(1).max(300),
  occurred_at: z.string().datetime({ offset: true }),
  source: z.object({
    product: z.enum(LEAD_SOURCE_PRODUCTS),
    tenant_ref: z.string().trim().min(1).max(100),
    site_domain: z.string().trim().min(1).max(255),
    form: z.string().trim().min(1).max(100),
  }).strict(),
  contact: z.object({
    name: nullableText(200),
    email: nullableText(320),
    phone: nullableText(40),
  }).strict().refine((value) => Boolean(value.name || value.email || value.phone), {
    message: 'Provide at least one contact identifier',
  }),
  lead: z.object({
    status: z.literal('new'),
    score: z.number().int().min(0).max(100).nullable().optional(),
    classification: z.enum(['HOT', 'WARM', 'COLD', 'DISQUALIFIED']).nullable().optional(),
    page_url: nullableText(1000),
    answers: z.record(z.string().max(100), z.string().max(2000)).refine(
      (answers) => Object.keys(answers).length <= 100,
      'A maximum of 100 answers is allowed',
    ),
  }).strict(),
  attribution: z.object({
    utm_source: nullableText(200),
    utm_medium: nullableText(200),
    utm_campaign: nullableText(200),
    utm_content: nullableText(200),
    utm_term: nullableText(200),
    first_touch: z.object({
      source: nullableText(200),
      medium: nullableText(200),
      campaign: nullableText(200),
    }).strict().optional(),
    last_touch: z.object({
      source: nullableText(200),
      medium: nullableText(200),
      campaign: nullableText(200),
    }).strict().optional(),
  }).strict().optional(),
}).strict()

export type LeadIngestionPayload = z.infer<typeof leadIngestionSchema>

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sortJson(item)]),
    )
  }
  return value
}

export function hashLeadPayload(payload: LeadIngestionPayload): string {
  return createHash('sha256').update(JSON.stringify(sortJson(payload))).digest('hex')
}
