'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { parseContactCSV, type ParseResult } from '@/lib/campaigns/csv-parser'
import { importContacts } from '@/app/(dashboard)/outbound/actions'

interface CsvImportFormProps {
  campaignId: string
  onSuccess?: (imported: number) => void
}

export function CsvImportForm({ campaignId, onSuccess }: CsvImportFormProps) {
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ imported: number; duplicates: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setImportResult(null)
    try {
      const result = await parseContactCSV(file)
      setParseResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse CSV')
      setParseResult(null)
    }
  }

  async function handleImport() {
    if (!parseResult || parseResult.rows.length === 0) return
    setImporting(true)
    setError(null)
    try {
      const result = await importContacts({ campaignId, contacts: parseResult.rows })
      setImportResult(result)
      setParseResult(null)
      if (fileRef.current) fileRef.current.value = ''
      onSuccess?.(result.imported)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm text-muted-foreground mb-2">
          Upload a CSV with at minimum a <code>name</code> and <code>phone</code> column.
          Additional columns are stored as custom data.
        </p>
        <Input ref={fileRef} type="file" accept=".csv" onChange={handleFileChange} />
      </div>

      {parseResult && (
        <div className="rounded-md border p-4 flex flex-col gap-2">
          <p className="text-sm font-medium">
            {parseResult.rows.length} valid contacts ready to import
            {parseResult.errors.length > 0 && `, ${parseResult.errors.length} rows with errors`}
          </p>
          {parseResult.errors.length > 0 && (
            <ul className="text-sm text-destructive space-y-1">
              {parseResult.errors.slice(0, 5).map((e) => (
                <li key={e.row}>Row {e.row}: {e.message}</li>
              ))}
              {parseResult.errors.length > 5 && (
                <li>...and {parseResult.errors.length - 5} more errors</li>
              )}
            </ul>
          )}
          {parseResult.rows.length > 0 && (
            <Button onClick={handleImport} disabled={importing} size="sm" className="w-fit">
              {importing ? 'Importing...' : `Import ${parseResult.rows.length} contacts`}
            </Button>
          )}
        </div>
      )}

      {importResult && (
        <p className="text-sm text-emerald-400">
          {importResult.imported} contacts imported.
          {importResult.duplicates > 0 && ` ${importResult.duplicates} duplicates skipped.`}
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
