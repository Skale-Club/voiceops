'use client'

import { useState, useTransition, useMemo } from 'react'
import Link from 'next/link'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type SortingState,
  type ColumnDef,
} from '@tanstack/react-table'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Wrench, MoreHorizontal, FolderPlus, GripVertical } from 'lucide-react'
import { toast } from 'sonner'
import type { ToolConfigWithIntegration } from '@/app/(dashboard)/tools/actions'
import type { IntegrationForDisplay } from '@/app/(dashboard)/integrations/actions'
import { deleteToolConfig, saveFolderOrder } from '@/app/(dashboard)/tools/actions'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
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
  folderOrder: string[]
  children?: React.ReactNode
}

// ─── Sortable folder header row ───────────────────────────────────────────────

function SortableFolderHeader({
  id,
  label,
  count,
  colSpan,
}: {
  id: string
  label: string
  count: number
  colSpan: number
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <TableRow ref={setNodeRef} style={style} className="bg-muted/30 hover:bg-muted/40">
      <TableCell colSpan={colSpan} className="py-1.5 px-4">
        <div className="flex items-center gap-2">
          <span
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
            aria-label="Drag to reorder folder"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </span>
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {label}
          </span>
          <span className="text-xs text-muted-foreground">({count})</span>
        </div>
      </TableCell>
    </TableRow>
  )
}

// ─── Static folder header (for "Other" — not draggable) ───────────────────────

function StaticFolderHeader({ label, count, colSpan }: { label: string; count: number; colSpan: number }) {
  return (
    <TableRow className="bg-muted/30 hover:bg-muted/30">
      <TableCell colSpan={colSpan} className="py-1.5 px-4">
        <div className="flex items-center gap-2">
          <span className="w-3.5" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {label}
          </span>
          <span className="text-xs text-muted-foreground">({count})</span>
        </div>
      </TableCell>
    </TableRow>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ToolsTable({
  toolConfigs: initialToolConfigs,
  integrations,
  folderOrder: initialFolderOrder,
  children,
}: ToolsTableProps) {
  const [toolConfigs, setToolConfigs] = useState<ToolConfigWithIntegration[]>(initialToolConfigs)
  const [sorting, setSorting] = useState<SortingState>([])
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [editingTool, setEditingTool] = useState<ToolConfigWithIntegration | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ToolConfigWithIntegration | null>(null)
  const [isPending, startTransition] = useTransition()
  const [addingFolder, setAddingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  // Canonical ordered folder list: initialFolderOrder first, then any extras from toolConfigs
  const [orderedFolders, setOrderedFolders] = useState<string[]>(() => {
    const allToolFolders = [
      ...new Set(initialToolConfigs.map((t) => t.folder).filter((f): f is string => !!f)),
    ]
    const fromOrder = initialFolderOrder.filter(
      (f) => allToolFolders.includes(f) || initialFolderOrder.includes(f)
    )
    const extras = allToolFolders.filter((f) => !fromOrder.includes(f)).sort()
    return [...fromOrder, ...extras]
  })

  const existingFolders = useMemo(
    () => [...new Set(toolConfigs.map((t) => t.folder).filter((f): f is string => !!f))],
    [toolConfigs]
  )

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = orderedFolders.indexOf(active.id as string)
    const newIndex = orderedFolders.indexOf(over.id as string)
    if (oldIndex === -1 || newIndex === -1) return
    const next = arrayMove(orderedFolders, oldIndex, newIndex)
    setOrderedFolders(next)
    saveFolderOrder(next)
  }

  function handleAddFolder(e: React.FormEvent) {
    e.preventDefault()
    const name = newFolderName.trim()
    if (!name || orderedFolders.includes(name)) {
      setAddingFolder(false)
      setNewFolderName('')
      return
    }
    const next = [...orderedFolders, name]
    setOrderedFolders(next)
    saveFolderOrder(next)
    setAddingFolder(false)
    setNewFolderName('')
  }

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
      id: 'labels',
      header: () => <span className="text-xs font-medium">Labels</span>,
      cell: ({ row }) => {
        const labels = row.original.labels ?? []
        if (labels.length === 0) return <span className="text-muted-foreground text-sm">—</span>
        return (
          <div className="flex flex-wrap gap-1">
            {labels.map((label) => (
              <Badge key={label} variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                {label}
              </Badge>
            ))}
          </div>
        )
      },
    },
    {
      id: 'integration',
      header: () => <span className="text-xs font-medium">Integration</span>,
      cell: ({ row }) => (
        <span className="text-sm">{row.original.integrations?.name ?? '—'}</span>
      ),
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
                <Link href={`/tools/${tool.id}`}>View Logs</Link>
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

  // Build a row lookup by tool id for efficient rendering
  const rowById = useMemo(() => {
    const map = new Map(table.getRowModel().rows.map((r) => [r.original.id, r]))
    return map
  }, [table])

  // Tools grouped by folder key
  const toolsByFolder = useMemo(() => {
    const map = new Map<string, ToolConfigWithIntegration[]>()
    for (const tool of toolConfigs) {
      const key = tool.folder ?? '__other__'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(tool)
    }
    return map
  }, [toolConfigs])

  const otherTools = toolsByFolder.get('__other__') ?? []

  // Show section headers when there's more than one distinct group
  // (at least one named folder, or named folder + ungrouped)
  const showHeaders =
    orderedFolders.length > 1 ||
    (orderedFolders.length === 1 && otherTools.length > 0) ||
    (orderedFolders.length === 0 && otherTools.length > 0 && toolConfigs.some((t) => t.folder))

  if (isPending && toolConfigs.length === 0) {
    return <ToolsTableSkeleton />
  }

  return (
    <>
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <div>{children}</div>
        <div className="flex items-center gap-2">
          {addingFolder ? (
            <form onSubmit={handleAddFolder} className="flex items-center gap-1">
              <Input
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setAddingFolder(false)
                    setNewFolderName('')
                  }
                }}
                placeholder="Folder name"
                className="h-8 w-40 text-sm"
              />
              <Button type="submit" size="sm" variant="outline" className="h-8">
                Add
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8"
                onClick={() => {
                  setAddingFolder(false)
                  setNewFolderName('')
                }}
              >
                Cancel
              </Button>
            </form>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddingFolder(true)}
              aria-label="Add folder"
              className="h-9 w-9 p-0"
            >
              <FolderPlus className="h-4 w-4" />
            </Button>
          )}
          <Button onClick={openCreateSheet}>Add Tool</Button>
        </div>
      </div>

      {/* Empty state */}
      {toolConfigs.length === 0 && orderedFolders.length === 0 ? (
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
              {/* Named folder groups — sortable */}
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={orderedFolders}
                  strategy={verticalListSortingStrategy}
                >
                  {orderedFolders.map((folderName) => {
                    const tools = toolsByFolder.get(folderName) ?? []
                    return (
                      <>
                        {showHeaders && (
                          <SortableFolderHeader
                            key={`header-${folderName}`}
                            id={folderName}
                            label={folderName}
                            count={tools.length}
                            colSpan={columns.length}
                          />
                        )}
                        {tools.map((tool) => {
                          const row = rowById.get(tool.id)
                          if (!row) return null
                          return (
                            <TableRow key={row.id}>
                              {row.getVisibleCells().map((cell) => (
                                <TableCell key={cell.id}>
                                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                </TableCell>
                              ))}
                            </TableRow>
                          )
                        })}
                      </>
                    )
                  })}
                </SortableContext>
              </DndContext>

              {/* "Other" group — not sortable, always last */}
              {otherTools.length > 0 && (
                <>
                  {showHeaders && (
                    <StaticFolderHeader
                      label="Other"
                      count={otherTools.length}
                      colSpan={columns.length}
                    />
                  )}
                  {otherTools.map((tool) => {
                    const row = rowById.get(tool.id)
                    if (!row) return null
                    return (
                      <TableRow key={row.id}>
                        {row.getVisibleCells().map((cell) => (
                          <TableCell key={cell.id}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    )
                  })}
                </>
              )}

              {toolConfigs.length === 0 && orderedFolders.length > 0 && (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-16 text-center text-sm text-muted-foreground">
                    No tools yet. Add a tool and assign it to a folder.
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
            existingFolders={existingFolders}
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
