'use client'

import { useState } from 'react'
import { Search, Archive, ArchiveRestore, Trash2, Settings2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import Link from 'next/link'

import { ConversationSummary } from '@/types/chat'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
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
    <div className="flex flex-col h-full bg-neutral-50/30 dark:bg-neutral-900/10 border-r border-neutral-200 dark:border-neutral-800">
      {/* Search + Settings */}
      <div className="p-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center gap-3 bg-background/50 backdrop-blur z-20">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search conversations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm rounded-xl border-neutral-200 dark:border-neutral-800 bg-white/50 dark:bg-neutral-900/50 focus-visible:ring-indigo-500/30 focus-visible:border-indigo-500 transition-all shadow-sm"
          />
        </div>
        <Button variant="outline" size="icon" className="h-9 w-9 shrink-0 rounded-xl bg-white/50 dark:bg-neutral-900/50 hover:bg-neutral-100 dark:hover:bg-neutral-800 border-neutral-200 dark:border-neutral-800 shadow-sm transition-all" asChild>
          <Link href="/widget" title="Chat Settings">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
          </Link>
        </Button>
      </div>

      {/* Tabs */}
      <div className="px-4 py-3 bg-background/30 backdrop-blur z-10 border-b border-neutral-200/50 dark:border-neutral-800/50">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
          <TabsList className="w-full h-9 grid grid-cols-3 bg-neutral-100/80 dark:bg-neutral-800/80 rounded-xl p-1 shadow-inner">
            <TabsTrigger value="open" className="text-xs rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-neutral-700 data-[state=active]:shadow-sm transition-all font-medium">Open</TabsTrigger>
            <TabsTrigger value="archived" className="text-xs rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-neutral-700 data-[state=active]:shadow-sm transition-all font-medium">Archived</TabsTrigger>
            <TabsTrigger value="all" className="text-xs rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-neutral-700 data-[state=active]:shadow-sm transition-all font-medium">All</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <div className="w-12 h-12 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mb-3">
                <Search className="h-5 w-5 text-neutral-400" />
              </div>
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">No conversations</p>
              <p className="text-xs text-muted-foreground mt-1">Try adjusting your filters.</p>
            </div>
          ) : (
            filtered.map((conversation) => {
              const isSelected = conversation.id === selectedId
              const displayName = getDisplayName(conversation)
              const prefix = displayName.charAt(0).toUpperCase()
              return (
                <div
                  key={conversation.id}
                  onClick={() => onSelect(conversation.id)}
                  className={[
                    'group rounded-xl p-3.5 cursor-pointer transition-all border outline-none relative overflow-hidden',
                    isSelected
                      ? 'bg-white dark:bg-neutral-900 border-indigo-500/30 shadow-[0_2px_10px_-3px_rgba(99,102,241,0.2)] dark:shadow-[0_2px_10px_-3px_rgba(99,102,241,0.1)] ring-1 ring-indigo-500/20'
                      : 'bg-transparent border-transparent hover:bg-white/60 dark:hover:bg-neutral-800/40 hover:border-neutral-200/50 dark:hover:border-neutral-700/50',
                  ].join(' ')}
                >
                  <div className="flex items-start gap-3 w-full">
                    <Avatar className={`h-10 w-10 shrink-0 border ${isSelected ? 'ring-2 ring-indigo-500/20 shadow-sm' : 'shadow-sm group-hover:shadow transition-all'}`}>
                      <AvatarFallback className={`${isSelected ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'} font-semibold text-sm`}>
                        {prefix}
                      </AvatarFallback>
                    </Avatar>

                    <div className="flex flex-col min-w-0 flex-1">
                      {/* Name + time row */}
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`text-sm font-semibold truncate ${isSelected ? 'text-indigo-950 dark:text-indigo-100' : 'text-neutral-900 dark:text-neutral-100'}`}>
                            {displayName}
                          </span>
                          {conversation.status === 'closed' && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400 shrink-0 border-neutral-200/50">
                              Archived
                            </Badge>
                          )}
                        </div>
                        <span className={`text-[11px] whitespace-nowrap shrink-0 font-medium ${isSelected ? 'text-indigo-600/70 dark:text-indigo-400/80' : 'text-muted-foreground/70'}`}>
                          {getRelativeTime(conversation)}
                        </span>
                      </div>

                      {/* Last message preview */}
                      {conversation.lastMessage ? (
                         <p className={`text-xs line-clamp-2 leading-relaxed ${isSelected ? 'text-neutral-600 dark:text-neutral-300 font-medium' : 'text-muted-foreground'}`}>
                           {conversation.lastMessage}
                         </p>
                      ) : (
                         <p className="text-xs text-muted-foreground/50 italic py-0.5">No messages</p>
                      )}

                      {/* Actions (only when selected) */}
                      {isSelected && (
                        <div
                          className="flex items-center gap-1.5 mt-3 pt-2 border-t border-indigo-100/50 dark:border-indigo-900/20 pointer-events-auto"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2.5 text-[11px] font-medium bg-neutral-100/50 hover:bg-neutral-200/60 dark:bg-neutral-800/50 dark:hover:bg-neutral-700/60 text-neutral-700 dark:text-neutral-300 rounded-lg pointer-events-auto transition-all"
                            disabled={isStatusLoading}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleArchiveToggle(conversation);
                            }}
                          >
                            {conversation.status === 'open' ? (
                              <>
                                <Archive className="h-3 w-3 mr-1.5 opacity-70" />
                                Archive
                              </>
                            ) : (
                              <>
                                <ArchiveRestore className="h-3 w-3 mr-1.5 opacity-70" />
                                Reopen
                              </>
                            )}
                          </Button>

                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2.5 text-[11px] font-medium text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30 rounded-lg pointer-events-auto transition-all ml-auto"
                                disabled={isDeleteLoading}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Trash2 className="h-3 w-3 mr-1.5 opacity-70" />
                                Delete
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent onClick={(e) => e.stopPropagation()}>
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
                                  className="bg-red-600 text-white hover:bg-red-700"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDelete(conversation.id);
                                  }}
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
