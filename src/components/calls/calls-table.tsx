'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type SortingState,
  type ColumnDef,
} from '@tanstack/react-table'
import { format } from 'date-fns'
import { Phone, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { Database } from '@/types/database'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type CallRow = Database['public']['Tables']['calls']['Row']

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
}

function formatCallType(callType: string | null): string {
  if (!callType) return '—'
  switch (callType) {
    case 'inboundPhoneCall':
      return 'Inbound'
    case 'outboundPhoneCall':
      return 'Outbound'
    case 'webCall':
      return 'Web'
    default:
      return callType
  }
}

function EndedReasonBadge({ reason }: { reason: string | null }) {
  if (!reason) return <span className="text-muted-foreground text-sm">—</span>

  let className = 'bg-zinc-500/15 text-zinc-400'
  if (reason === 'customer-ended-call' || reason === 'assistant-ended-call') {
    className = 'bg-emerald-500/15 text-emerald-400'
  } else if (reason.includes('error') || reason === 'pipeline-error') {
    className = 'bg-red-500/15 text-red-400'
  }

  return (
    <Badge variant="outline" className={className}>
      {reason}
    </Badge>
  )
}

interface CallsTableProps {
  calls: CallRow[]
  total: number
  page: number
  totalPages: number
}

export function CallsTable({ calls, total: _total, page, totalPages }: CallsTableProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [sorting, setSorting] = useState<SortingState>([])

  function navigatePage(newPage: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', String(newPage))
    router.replace('/dashboard/calls?' + params.toString())
  }

  const columns: ColumnDef<CallRow>[] = [
    {
      accessorKey: 'started_at',
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 h-8"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          Date / Time
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => {
        const dateStr = row.getValue<string | null>('started_at')
        if (!dateStr) return <span className="text-muted-foreground">—</span>
        return <span className="whitespace-nowrap">{format(new Date(dateStr), 'MMM d, yyyy HH:mm')}</span>
      },
    },
    {
      accessorKey: 'duration_seconds',
      header: 'Duration',
      cell: ({ row }) => (
        <span className="font-mono">{formatDuration(row.getValue('duration_seconds'))}</span>
      ),
    },
    {
      accessorKey: 'call_type',
      header: 'Type',
      cell: ({ row }) => <span>{formatCallType(row.getValue('call_type'))}</span>,
    },
    {
      accessorKey: 'customer_number',
      header: 'Phone',
      cell: ({ row }) => (
        <span>{row.getValue<string | null>('customer_number') ?? '—'}</span>
      ),
    },
    {
      accessorKey: 'customer_name',
      header: 'Contact',
      cell: ({ row }) => (
        <span>{row.getValue<string | null>('customer_name') ?? '—'}</span>
      ),
    },
    {
      accessorKey: 'ended_reason',
      header: 'Status',
      cell: ({ row }) => <EndedReasonBadge reason={row.getValue('ended_reason')} />,
    },
    {
      id: 'detail',
      header: () => null,
      cell: ({ row }) => (
        <Link
          href={`/dashboard/calls/${row.original.id}`}
          className="text-sm text-primary hover:underline whitespace-nowrap"
        >
          View
        </Link>
      ),
    },
  ]

  const table = useReactTable({
    data: calls,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  if (calls.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
        <Phone className="h-12 w-12 text-muted-foreground" />
        <div>
          <h2 className="text-lg font-semibold">No calls yet</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Calls will appear here after your assistants complete them.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-4">
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

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 px-1">
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigatePage(page - 1)}
              disabled={page <= 1}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigatePage(page + 1)}
              disabled={page >= totalPages}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
