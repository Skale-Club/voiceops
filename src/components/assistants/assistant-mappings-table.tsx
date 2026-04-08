'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table'
import { Bot, ExternalLink, MoreHorizontal, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { AssistantMappingForm } from './assistant-mapping-form'
import {
  toggleAssistantMappingStatus,
  deleteAssistantMapping,
} from '@/app/(dashboard)/assistants/actions'
import type { Database } from '@/types/database'

type AssistantMapping = Database['public']['Tables']['assistant_mappings']['Row']

const mappingStatusConfig = {
  active: { label: 'Active', className: 'bg-emerald-500/15 text-emerald-400' },
  inactive: { label: 'Inactive', className: 'bg-zinc-500/15 text-zinc-400' },
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function getVapiAssistantUrl(assistantId: string) {
  return `https://dashboard.vapi.ai/assistants/${assistantId}`
}

interface AssistantMappingsTableProps {
  mappings: AssistantMapping[]
}

export function AssistantMappingsTable({ mappings: initialMappings }: AssistantMappingsTableProps) {
  const [optimisticMappings, setOptimisticMappings] = useState(initialMappings)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [editMapping, setEditMapping] = useState<AssistantMapping | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AssistantMapping | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  async function handleToggle(id: string, newValue: boolean) {
    setOptimisticMappings(prev =>
      prev.map(m => (m.id === id ? { ...m, is_active: newValue } : m))
    )
    const result = await toggleAssistantMappingStatus(id, newValue)
    if (result?.error) {
      setOptimisticMappings(prev =>
        prev.map(m => (m.id === id ? { ...m, is_active: !newValue } : m))
      )
      toast.error('Failed to update mapping. Try again.')
    } else {
      toast.success('Mapping updated.')
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setIsLoading(true)
    const id = deleteTarget.id
    setOptimisticMappings(prev => prev.filter(m => m.id !== id))
    setDeleteTarget(null)
    const result = await deleteAssistantMapping(id)
    if (result?.error) {
      setOptimisticMappings(initialMappings)
      toast.error('Failed to remove mapping. Try again.')
    } else {
      toast.success('Assistant mapping removed.')
    }
    setIsLoading(false)
  }

  const columns: ColumnDef<AssistantMapping>[] = [
    {
      accessorKey: 'name',
      header: 'Assistant Name',
      cell: ({ row }) => (
        <span className="text-sm">{row.original.name ?? 'Unnamed assistant'}</span>
      ),
    },
    {
      accessorKey: 'vapi_assistant_id',
      header: 'Vapi Assistant ID',
      cell: ({ row }) => {
        const value = row.original.vapi_assistant_id
        const truncated = value.slice(0, 20) + (value.length > 20 ? '...' : '')
        return (
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs" title={value}>
              {truncated}
            </span>
            <a
              href={getVapiAssistantUrl(value)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              aria-label={`Open assistant ${row.original.name ?? value} in Vapi`}
            >
              Open
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )
      },
    },
    {
      accessorKey: 'is_active',
      header: 'Status',
      cell: ({ row }) => {
        const isActive =
          optimisticMappings.find(m => m.id === row.original.id)?.is_active ?? row.original.is_active
        const statusKey = isActive ? 'active' : 'inactive'
        const config = mappingStatusConfig[statusKey]
        return (
          <div className="flex items-center gap-2">
            <Switch
              checked={isActive}
              onCheckedChange={(checked) => handleToggle(row.original.id, checked)}
              className="data-[state=checked]:bg-primary"
            />
            <Badge variant="outline" className={config.className}>
              {config.label}
            </Badge>
          </div>
        )
      },
    },
    {
      accessorKey: 'created_at',
      header: 'Added',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(row.original.created_at)}
        </span>
      ),
    },
    {
      id: 'actions',
      header: () => null,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Row actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={getVapiAssistantUrl(row.original.vapi_assistant_id)} target="_blank" rel="noreferrer">
                Open in Vapi
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setEditMapping(row.original)}>
              Edit Mapping
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => setDeleteTarget(row.original)}
            >
              Remove Mapping
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  const table = useReactTable({
    data: optimisticMappings,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div />
        <Button onClick={() => setAddDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Assistant
        </Button>
      </div>

      {optimisticMappings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Bot className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-base font-semibold mb-1">No assistants linked</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Add a Vapi assistant with a friendly name so webhook routing stays clear.
          </p>
          <Button onClick={() => setAddDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Assistant
          </Button>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map(headerGroup => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map(header => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map(row => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map(cell => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AssistantMappingForm
        mode="create"
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onSuccess={() => window.location.reload()}
      />

      {editMapping && (
        <AssistantMappingForm
          mode="edit"
          mapping={editMapping}
          open={!!editMapping}
          onOpenChange={(open) => {
            if (!open) setEditMapping(null)
          }}
          onSuccess={() => setEditMapping(null)}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Assistant Mapping</AlertDialogTitle>
            <AlertDialogDescription>
              This assistant ID will no longer route webhooks to this organization. You can re-add it at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Mapping</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
