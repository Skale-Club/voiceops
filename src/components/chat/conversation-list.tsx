'use client'

import { useState } from 'react'
import { Search, Archive, ArchiveRestore, Trash2, Settings2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import Link from 'next/link'

import { ConversationSummary } from '@/types/chat'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

interface ConversationListProps {
  conversations: ConversationSummary[]
  selectedId: string | null
  onSelect: (id: string) => void
  onConversationUpdated: () => void
  onConversationDeleted: (id: string) => void
}

type TabValue = 'open' | 'archived' | 'all'

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onConversationUpdated,
  onConversationDeleted,
}: ConversationListProps) {
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<TabValue>('open')
  const [isStatusLoading, setIsStatusLoading] = useState(false)
  const [isDeleteLoading, setIsDeleteLoading] = useState(false)

  const filtered = conversations.filter((c) => {
    // Tab filter
    if (activeTab === 'open' && c.status !== 'open') return false
    if (activeTab === 'archived' && c.status !== 'closed') return false

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase()
      const name = (c.visitorName ?? '').toLowerCase()
      const email = (c.visitorEmail ?? '').toLowerCase()
      const msg = (c.lastMessage ?? '').toLowerCase()
      if (!name.includes(q) && !email.includes(q) && !msg.includes(q)) return false
    }

    return true
  })

  async function handleArchiveToggle(conversation: ConversationSummary) {
    setIsStatusLoading(true)
    try {
      const newStatus = conversation.status === 'open' ? 'closed' : 'open'
      await fetch(`/api/chat/conversations/${conversation.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      onConversationUpdated()
    } catch {
      // silently fail — parent will refresh on next poll
    } finally {
      setIsStatusLoading(false)
    }
  }

  async function handleDelete(id: string) {
    setIsDeleteLoading(true)
    try {
      await fetch(`/api/chat/conversations/${id}`, { method: 'DELETE' })
      onConversationDeleted(id)
    } catch {
      // silently fail
    } finally {
      setIsDeleteLoading(false)
    }
  }

  function getDisplayName(c: ConversationSummary): string {
    return c.visitorName ?? c.visitorEmail ?? 'Anonymous'
  }

  function getRelativeTime(c: ConversationSummary): string {
    const dateStr = c.lastMessageAt ?? c.updatedAt ?? c.createdAt
    try {
      return formatDistanceToNow(new Date(dateStr), { addSuffix: true })
    } catch {
      return ''
    }
  }

  return (
    <div className="flex flex-col h-full border-r">
      {/* Search + Settings */}
      <div className="p-3 border-b flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search conversations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" asChild>
          <Link href="/widget" title="Chat Settings">
            <Settings2 className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      {/* Tabs */}
      <div className="px-3 pt-2 pb-1">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
          <TabsList className="w-full h-8 grid grid-cols-3">
            <TabsTrigger value="open" className="text-xs">Open</TabsTrigger>
            <TabsTrigger value="archived" className="text-xs">Archived</TabsTrigger>
            <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No conversations found.
            </p>
          ) : (
            filtered.map((conversation) => {
              const isSelected = conversation.id === selectedId
              return (
                <div
                  key={conversation.id}
                  onClick={() => onSelect(conversation.id)}
                  className={[
                    'rounded-md border p-3 cursor-pointer transition-colors',
                    isSelected
                      ? 'bg-accent border-border'
                      : 'border-transparent hover:bg-accent/50',
                  ].join(' ')}
                >
                  {/* Name + time row */}
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium truncate">
                        {getDisplayName(conversation)}
                      </span>
                      {conversation.status === 'closed' && (
                        <Badge variant="secondary" className="text-xs shrink-0">
                          Archived
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                      {getRelativeTime(conversation)}
                    </span>
                  </div>

                  {/* Last message preview */}
                  {conversation.lastMessage && (
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {conversation.lastMessage}
                    </p>
                  )}

                  {/* Actions (only when selected) */}
                  {isSelected && (
                    <div
                      className="flex items-center gap-1 mt-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={isStatusLoading}
                        onClick={() => handleArchiveToggle(conversation)}
                      >
                        {conversation.status === 'open' ? (
                          <>
                            <Archive className="h-3 w-3 mr-1" />
                            Archive
                          </>
                        ) : (
                          <>
                            <ArchiveRestore className="h-3 w-3 mr-1" />
                            Reopen
                          </>
                        )}
                      </Button>

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                            disabled={isDeleteLoading}
                          >
                            <Trash2 className="h-3 w-3 mr-1" />
                            Delete
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete the conversation with{' '}
                              <strong>{getDisplayName(conversation)}</strong> and all its
                              messages. This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={() => handleDelete(conversation.id)}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
