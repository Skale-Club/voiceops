'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { deleteDocument } from '@/actions/knowledge'
import type { Database } from '@/types/database'

type KnowledgeSource = Database['public']['Tables']['knowledge_sources']['Row']

const STATUS_BADGE: Record<KnowledgeSource['status'], { label: string; className: string }> = {
  processing: { label: 'Processing', className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  ready:      { label: 'Ready',      className: 'bg-green-100 text-green-800 border-green-200'  },
  error:      { label: 'Error',      className: 'bg-red-100 text-red-800 border-red-200'        },
}

function StatusBadge({ status }: { status: KnowledgeSource['status'] }) {
  const { label, className } = STATUS_BADGE[status]
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  )
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function SourceTypeLabel({ sourceType }: { sourceType: KnowledgeSource['source_type'] }) {
  const labels: Record<KnowledgeSource['source_type'], string> = {
    pdf: 'PDF',
    text: 'Text',
    csv: 'CSV',
    url: 'URL',
  }
  return <span>{labels[sourceType]}</span>
}

interface SourceRowProps {
  source: KnowledgeSource
}

function SourceRow({ source }: SourceRowProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showConfirm, setShowConfirm] = useState(false)

  function handleDeleteConfirmed() {
    startTransition(async () => {
      await deleteDocument(source.id)
      router.refresh()
    })
  }

  return (
    <>
      <tr className="border-b last:border-0">
        <td className="py-3 pr-4 pl-4">
          <div className="text-sm font-medium truncate max-w-[240px]" title={source.name}>
            {source.name}
          </div>
          <div className="text-xs text-muted-foreground">
            <SourceTypeLabel sourceType={source.source_type} />
          </div>
        </td>
        <td className="py-3 pr-4">
          <StatusBadge status={source.status} />
          {source.status === 'error' && source.error_detail && (
            <p className="text-xs text-destructive mt-1 max-w-[200px] truncate" title={source.error_detail}>
              {source.error_detail}
            </p>
          )}
        </td>
        <td className="py-3 pr-4 text-sm text-muted-foreground">
          {source.status === 'ready' ? source.chunk_count : '—'}
        </td>
        <td className="py-3 pr-4 text-sm text-muted-foreground">
          {formatDate(source.created_at)}
        </td>
        <td className="py-3 text-right pr-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowConfirm(true)}
            disabled={isPending}
            className="text-destructive hover:text-destructive hover:bg-destructive/10 h-7 text-xs"
          >
            {isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </td>
      </tr>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete knowledge source?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{source.name}&rdquo; and all its vector chunks will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirmed}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

interface DocumentListProps {
  sources: KnowledgeSource[]
}

export function DocumentList({ sources }: DocumentListProps) {
  if (sources.length === 0) {
    return (
      <div className="rounded-lg border p-8 text-center">
        <p className="text-sm text-muted-foreground">No documents yet. Upload a file or add a URL to get started.</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border">
      <table className="w-full">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="py-2.5 pr-4 pl-4 text-left text-xs font-medium text-muted-foreground">Name</th>
            <th className="py-2.5 pr-4 text-left text-xs font-medium text-muted-foreground">Status</th>
            <th className="py-2.5 pr-4 text-left text-xs font-medium text-muted-foreground">Chunks</th>
            <th className="py-2.5 pr-4 text-left text-xs font-medium text-muted-foreground">Added</th>
            <th className="py-2.5 pr-4 text-right text-xs font-medium text-muted-foreground"></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {sources.map((source) => (
            <SourceRow key={source.id} source={source} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
