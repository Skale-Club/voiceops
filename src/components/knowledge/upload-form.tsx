'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { insertDocument, addUrlDocument } from '@/actions/knowledge'

const FILE_LIMIT = 5
const URL_LIMIT = 5

type UploadStatus = 'idle' | 'uploading' | 'error' | 'success'

function getSourceType(mimeType: string, fileName: string): 'pdf' | 'text' | 'csv' {
  if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) return 'pdf'
  if (mimeType === 'text/csv' || fileName.endsWith('.csv')) return 'csv'
  return 'text'
}

interface UploadFormProps {
  disabled?: boolean
  fileCount?: number
  urlCount?: number
}

export function UploadForm({ disabled = false, fileCount = 0, urlCount = 0 }: UploadFormProps) {
  const [fileStatus, setFileStatus] = useState<UploadStatus>('idle')
  const [urlStatus, setUrlStatus] = useState<UploadStatus>('idle')
  const [fileError, setFileError] = useState<string | null>(null)
  const [urlError, setUrlError] = useState<string | null>(null)
  const router = useRouter()
  const [isPendingFile, startFileTransition] = useTransition()
  const [isPendingUrl, startUrlTransition] = useTransition()

  const fileAtLimit = fileCount >= FILE_LIMIT
  const urlAtLimit = urlCount >= URL_LIMIT

  async function handleFileUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fileInput = form.elements.namedItem('file')
    if (!(fileInput instanceof HTMLInputElement)) return
    const file = fileInput.files?.[0]
    if (!file) return

    setFileStatus('uploading')
    setFileError(null)

    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/knowledge/upload', {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error ?? 'Upload failed')
      }
      const { path, name } = await res.json()

      startFileTransition(async () => {
        await insertDocument(path, name, getSourceType(file.type, file.name))
        setFileStatus('success')
        form.reset()
        router.refresh()
      })
    } catch (err) {
      setFileStatus('error')
      setFileError(err instanceof Error ? err.message : 'Upload failed')
    }
  }

  async function handleUrlSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const urlInput = form.elements.namedItem('url')
    if (!(urlInput instanceof HTMLInputElement)) return
    const url = urlInput.value.trim()
    if (!url) return

    setUrlStatus('uploading')
    setUrlError(null)

    startUrlTransition(async () => {
      try {
        await addUrlDocument(url)
        setUrlStatus('success')
        form.reset()
        router.refresh()
      } catch (err) {
        setUrlStatus('error')
        setUrlError(err instanceof Error ? err.message : 'Failed to add URL')
      }
    })
  }

  return (
    <div className="rounded-lg border p-5 space-y-6">
      <h2 className="text-sm font-semibold">Add Document</h2>

      {/* File Upload */}
      <form onSubmit={handleFileUpload} className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="file" className="text-xs font-medium">Upload File</Label>
            <p className="text-xs text-muted-foreground mt-0.5">PDF, TXT, or CSV — max 10MB</p>
          </div>
          <span className="text-xs text-muted-foreground">{fileCount} / {FILE_LIMIT}</span>
        </div>
        <div className="flex gap-2">
          <Input
            id="file"
            name="file"
            type="file"
            accept=".pdf,.txt,.csv,text/plain,text/csv,application/pdf"
            className="text-xs"
            required
            disabled={disabled || fileAtLimit}
          />
          <Button
            type="submit"
            size="sm"
            disabled={disabled || fileAtLimit || fileStatus === 'uploading' || isPendingFile}
          >
            {fileStatus === 'uploading' || isPendingFile ? 'Uploading...' : 'Upload'}
          </Button>
        </div>
        {fileAtLimit && (
          <p className="text-xs text-muted-foreground">File limit reached ({FILE_LIMIT} max).</p>
        )}
        {fileStatus === 'error' && (
          <p className="text-xs text-destructive">{fileError}</p>
        )}
        {fileStatus === 'success' && (
          <p className="text-xs text-green-600">File uploaded — processing started.</p>
        )}
      </form>

      <div className="border-t" />

      {/* URL Addition */}
      <form onSubmit={handleUrlSubmit} className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="url" className="text-xs font-medium">Add Website URL</Label>
            <p className="text-xs text-muted-foreground mt-0.5">Content will be extracted and vectorized</p>
          </div>
          <span className="text-xs text-muted-foreground">{urlCount} / {URL_LIMIT}</span>
        </div>
        <div className="flex gap-2">
          <Input
            id="url"
            name="url"
            type="url"
            placeholder="https://example.com/faq"
            className="text-xs"
            required
            disabled={disabled || urlAtLimit}
          />
          <Button
            type="submit"
            size="sm"
            disabled={disabled || urlAtLimit || urlStatus === 'uploading' || isPendingUrl}
          >
            {urlStatus === 'uploading' || isPendingUrl ? 'Adding...' : 'Add URL'}
          </Button>
        </div>
        {urlAtLimit && (
          <p className="text-xs text-muted-foreground">URL limit reached ({URL_LIMIT} max).</p>
        )}
        {urlStatus === 'error' && (
          <p className="text-xs text-destructive">{urlError}</p>
        )}
        {urlStatus === 'success' && (
          <p className="text-xs text-green-600">URL added — processing started.</p>
        )}
      </form>
    </div>
  )
}
