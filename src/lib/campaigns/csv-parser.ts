'use client'

import Papa from 'papaparse'
import { z } from 'zod'

export interface ContactRow {
  name: string
  phone: string
  custom_data: Record<string, string>
}

export interface ParseResult {
  rows: ContactRow[]
  errors: Array<{ row: number; message: string }>
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return '+1' + digits
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits
  if (!raw.startsWith('+')) return '+' + digits
  return raw.trim()
}

const PhoneSchema = z
  .string()
  .transform(normalizePhone)
  .refine((v) => /^\+[1-9]\d{7,14}$/.test(v), {
    message: 'Phone must be a valid number (E.164 format, 8-15 digits)',
  })

const ContactRowSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  phone: PhoneSchema,
})

export function parseContactCSV(file: File): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows: ContactRow[] = []
        const errors: Array<{ row: number; message: string }> = []

        results.data.forEach((rawRow, index) => {
          const rowNumber = index + 1
          const parsed = ContactRowSchema.safeParse(rawRow)
          if (!parsed.success) {
            const msg = parsed.error.errors.map((e) => e.message).join('; ')
            errors.push({ row: rowNumber, message: msg })
            return
          }

          // Collect remaining columns as custom_data
          const { name, phone, ...rest } = rawRow
          void name
          void phone
          const custom_data: Record<string, string> = {}
          for (const [key, val] of Object.entries(rest)) {
            if (typeof val === 'string') custom_data[key] = val
          }

          rows.push({ name: parsed.data.name, phone: parsed.data.phone, custom_data })
        })

        resolve({ rows, errors })
      },
      error: (err) => {
        reject(new Error('CSV parse error: ' + err.message))
      },
    })
  })
}
