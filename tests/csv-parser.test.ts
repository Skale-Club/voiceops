import { describe, it } from 'vitest'

describe('parseContactCSV: valid input', () => {
  it.todo('parses CSV with name and phone columns into ContactRow array')
  it.todo('extra columns beyond name+phone are stored in custom_data object')
  it.todo('trims whitespace from phone numbers before validation')
  it.todo('accepts E.164 format +15551234567')
  it.todo('accepts local US format 5551234567 and normalizes to +15551234567')
  it.todo('skips empty lines (skipEmptyLines: true)')
})

describe('parseContactCSV: invalid input', () => {
  it.todo('returns row-level error for missing phone column')
  it.todo('returns row-level error for phone that is not a valid number')
  it.todo('returns row-level error for empty name field')
  it.todo('partial success: valid rows returned alongside errors array')
})
