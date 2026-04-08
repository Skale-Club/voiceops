'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type SortingState,
  type ColumnDef,
} from '@tanstack/react-table'
import { Wrench, MoreHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import type { ToolConfigWithIntegration } from '@/app/(dashboard)/tools/actions'
import type { IntegrationForDisplay } from '@/app/(dashboard)/integrations/actions'
import { deleteToolConfig } from '@/app/(dashboard)/tools/actions'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet'
import { ToolConfigForm } from './tool-config-form'

const ACTION_TYPE_LABELS: Record<string, string> = {
  create_contact: 'Create Contact',
  get_availability: 'Check Availability',
  create_appointment: 'Book Appointment',
  send_sms: 'Send SMS',
  knowledge_base: 'Knowledge Base',
  custom_webhook: 'Custom Webhook',
}

interface ToolsTableProps {
  toolConfigs: ToolConfigWithIntegration[]
  integrations: IntegrationForDisplay[]
  children?: React.ReactNode
}

export function ToolsTable({ toolConfigs: initialToolConfigs, integrations, children }: ToolsTableProps) {
  const [toolConfigs, setToolConfigs] = useState<ToolConfigWithIntegration[]>(initialToolConfigs)
  const [sorting, setSorting] = useState<SortingState>([])
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [editingTool, setEditingTool] = useState<ToolConfigWithIntegration | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ToolConfigWithIntegration | null>(null)
  const [isPending, startTransition] = useTransition()

  function openCreateSheet() {
    setEditingTool(null)
    setIsSheetOpen(true)
  }

  function openEditSheet(tool: ToolConfigWithIntegration) {
    setEditingTool(tool)
    setIsSheetOpen(true)
  }

  function handleSheetSuccess() {
    setIsSheetOpen(false)
    setEditingTool(null)
    window.location.reload()
  }

  function handleDeleteConfirm() {
    if (!deleteTarget) return
    const id = deleteTarget.id
    setDeleteTarget(null)
    startTransition(async () => {
      const result = await deleteToolConfig(id)
      if (result && 'error' in result && result.error) {
        toast.error('Failed to delete tool config. Try again.')
      } else {
        setToolConfigs((prev) => prev.filter((t) => t.id !== id))
        toast.success('Tool configuration deleted.')
      }
    })
  }

  const columns: ColumnDef<ToolConfigWithIntegration>[] = [
    {
      accessorKey: 'tool_name',
      header: () => <span className="text-xs font-medium">Tool Name</span>,
      cell: ({ row }) => (
        <Link
          href={`/tools/${row.original.id}`}
          className="font-mono text-sm underline-offset-4 hover:underline"
        >
          {row.getValue('tool_name')}
        </Link>
      ),
    },
    {
      accessorKey: 'action_type',
      header: () => <span className="text-xs font-medium">Action Type</span>,
      cell: ({ row }) => {
        const actionType = row.getValue<string>('action_type')
        return <span className="text-sm">{ACTION_TYPE_LABELS[actionType] ?? actionType}</span>
      },
    },
    {
      id: 'integration',
      header: () => <span className="text-xs font-medium">Integration</span>,
      cell: ({ row }) => {
        const tool = row.original
        return <span className="text-sm">{tool.integrations?.name ?? '—'}</span>
      },
    },
    {
      accessorKey: 'fallback_message',
      header: () => <span className="text-xs font-medium">Fallback Message</span>,
      cell: ({ row }) => {
        const message = row.getValue<string>('fallback_message')
        const truncated = message.length > 40 ? message.slice(0, 40) + '…' : message
        return <span className="text-sm text-muted-foreground">{truncated}</span>
      },
    },
    {
      accessorKey: 'is_active',
      header: () => <span className="text-xs font-medium">Status</span>,
      cell: ({ row }) => {
        const isActive = row.getValue<boolean>('is_active')
        return (
          <Badge
            variant="outline"
            className={isActive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-500/15 text-zinc-400'}
          >
            {isActive ? 'Active' : 'Inactive'}
          </Badge>
        )
      },
    },
    {
      id: 'actions',
      header: () => null,
      cell: ({ row }) => {
        const tool = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label="Row actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/tools/${tool.id}`}>
                  View Logs
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openEditSheet(tool)}>
                Edit Tool Config
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setDeleteTarget(tool)}
              >
                Delete Tool Config
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]

  const table = useReactTable({
    data: toolConfigs,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  if (isPending && toolConfigs.length === 0) {
    return <ToolsTableSkeleton />
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <div>{children}</div>
        <div className="flex items-center gap-4">
          <Button onClick={openCreateSheet}>Add Tool</Button>
        </div>
      </div>

      {toolConfigs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
          <Wrench className="h-12 w-12 text-muted-foreground" />
          <div>
            <h2 className="text-xl font-semibold">No tool configurations yet</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Add your first tool to route Vapi tool calls through platform actions.
            </p>
          </div>
          <Button onClick={openCreateSheet}>Add Tool</Button>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
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
              {table.getRowModel().rows.length > 0 ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-24 text-center">
                    No results.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent side="right" className="p-0 sm:max-w-lg">
          <ToolConfigForm
            mode={editingTool ? 'edit' : 'create'}
            toolConfig={editingTool ?? undefined}
            integrations={integrations}
            onSuccess={handleSheetSuccess}
          />
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Tool Configuration</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the &quot;{deleteTarget?.tool_name}&quot; tool configuration.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
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

function ToolsTableSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 h-12">
          <Skeleton className="h-4 w-[160px]" />
          <Skeleton className="h-4 w-[120px]" />
          <Skeleton className="h-4 w-[140px]" />
          <Skeleton className="h-4 w-[180px]" />
          <Skeleton className="h-4 w-[80px]" />
          <Skeleton className="h-4 w-[32px] ml-auto" />
        </div>
      ))}
    </div>
  )
}
