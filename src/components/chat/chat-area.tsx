'use client'

import { useState, useEffect, useRef, KeyboardEvent } from 'react'
import {
  MessageSquare,
  ArrowLeft,
  Send,
  Archive,
  ArchiveRestore,
  Trash2,
  MoreVertical,
} from 'lucide-react'

import { ConversationSummary, ConversationMessage } from '@/types/chat'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
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

interface ChatAreaProps {
  conversation: ConversationSummary | null
  messages: ConversationMessage[]
  isLoading: boolean
  onSendMessage: (content: string) => Promise<void>
  onStatusChange: (status: 'open' | 'closed') => void
  onDelete: () => void
  onBack: () => void
}

function getDebugMessageStyle(message: ConversationMessage): string {
  const type = message.metadata?.type as string | undefined
  const severity = message.metadata?.severity as string | undefined

  if (type === 'tool_call') {
    return 'bg-blue-50/80 border-blue-200/50 text-blue-700 dark:bg-blue-950/30 dark:border-blue-800/50 dark:text-blue-300 shadow-sm'
  }
  if (type === 'tool_result') {
    return 'bg-green-50/80 border-green-200/50 text-green-700 dark:bg-green-950/30 dark:border-green-800/50 dark:text-green-300 shadow-sm'
  }
  if (type === 'error' || severity === 'error') {
    return 'bg-red-50/80 border-red-200/50 text-red-700 dark:bg-red-950/30 dark:border-red-800/50 dark:text-red-300 shadow-sm'
  }
  return 'bg-muted/50 text-muted-foreground shadow-sm'
}

export function ChatArea({
  conversation,
  messages,
  isLoading,
  onSendMessage,
  onStatusChange,
  onDelete,
  onBack,
}: ChatAreaProps) {
  const [showDebug, setShowDebug] = useState(false)
  const [messageText, setMessageText] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const visibleMessages = messages.filter(
    (m) => showDebug || !m.metadata?.internal
  )

  async function handleSend() {
    const content = messageText.trim()
    if (!content || isSending) return
    setMessageText('')
    setIsSending(true)
    try {
      await onSendMessage(content)
    } finally {
      setIsSending(false)
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Empty state
  if (!conversation) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <MessageSquare className="h-16 w-16 opacity-20 mb-4" />
        <h3 className="text-lg font-medium mb-2">No conversation selected</h3>
        <p className="text-sm text-muted-foreground">
          Select a conversation from the list to view details.
        </p>
      </div>
    )
  }

  const displayName =
    conversation.visitorName ?? conversation.visitorEmail ?? 'Anonymous'
  const avatarInitial = displayName.charAt(0).toUpperCase()

  return (
    <div className="flex flex-col h-full">
        {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 z-10 shrink-0">
        <div className="flex items-center gap-4">
          {/* Mobile back button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 md:hidden shrink-0 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors rounded-full"
            onClick={onBack}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>

          {/* Avatar */}
          <div className="relative">
            <Avatar className="h-10 w-10 shrink-0 ring-2 ring-background shadow-sm">
              <AvatarFallback className="text-sm font-semibold bg-gradient-to-br from-indigo-500 to-purple-600 text-white">
                {avatarInitial}
              </AvatarFallback>
            </Avatar>
            <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-background rounded-full"></span>
          </div>

          {/* Name / email */}
          <div className="flex flex-col min-w-0 justify-center">
            <p className="text-sm font-semibold tracking-tight truncate leading-tight focus:outline-none">{displayName}</p>
            {conversation.visitorEmail && conversation.visitorName && (
              <p className="text-xs text-muted-foreground truncate font-medium">
                {conversation.visitorEmail}
              </p>
            )}
          </div>
        </div>

        {/* Actions Dropdown */}
        <div className="flex items-center gap-3 z-20 shrink-0">
          {/* Show debug checkbox */}
          <label className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-100/80 hover:bg-neutral-200/80 dark:bg-neutral-800/80 dark:hover:bg-neutral-700/80 text-xs font-medium cursor-pointer transition-colors shadow-sm">
            <input
              type="checkbox"
              checked={showDebug}
              onChange={(e) => setShowDebug(e.target.checked)}
              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-600"
            />
            <span>Debug</span>
          </label>

          {/* Dropdown menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors rounded-full focus:ring-2 focus:ring-indigo-500/20 z-20 pointer-events-auto">
                <MoreVertical className="h-5 w-5 text-muted-foreground hover:text-foreground transition-colors" />
              </Button>
            </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() =>
                onStatusChange(conversation.status === 'open' ? 'closed' : 'open')
              }
            >
              {conversation.status === 'open' ? (
                <>
                  <Archive className="h-4 w-4 mr-2" />
                  Archive conversation
                </>
              ) : (
                <>
                  <ArchiveRestore className="h-4 w-4 mr-2" />
                  Reopen conversation
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => setShowDeleteDialog(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete conversation
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 bg-neutral-50/50 dark:bg-neutral-900/20 px-4 py-6 md:px-8">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            Loading messages...
          </div>
        ) : visibleMessages.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            No messages yet.
          </div>
        ) : (
          <div className="space-y-6">
            {visibleMessages.map((message, i) => {
              const isInternal = !!message.metadata?.internal
              const previousMessage = i > 0 ? visibleMessages[i - 1] : null;
              const isSequential = previousMessage && previousMessage.role === message.role && !isInternal && !previousMessage.metadata?.internal;

              if (isInternal) {
                // Debug/internal message
                return (
                  <div key={message.id} className="flex justify-center my-4 opacity-80 hover:opacity-100 transition-opacity">
                    <div
                      className={[
                        'rounded-xl border px-4 py-2 text-[11px] font-mono leading-relaxed max-w-[85%] text-left md:text-center',
                        getDebugMessageStyle(message),
                      ].join(' ')}
                    >
                      {message.content}
                    </div>
                  </div>
                )
              }

              if (message.role === 'visitor') {
                return (
                  <div key={message.id} className={`flex justify-end w-full group ${isSequential ? 'mt-1' : 'mt-6'}`}>
                     <div 
                      className={`bg-indigo-600 text-white shadow-sm px-4 py-2.5 max-w-[85%] md:max-w-[70%] text-[15px] leading-relaxed transition-all 
                        ${isSequential ? 'rounded-2xl rounded-tr-sm' : 'rounded-2xl'}
                      `}
                    >
                      {message.content}
                    </div>
                  </div>
                )
              }

              // Assistant
              return (
                <div key={message.id} className={`flex items-end gap-3 w-full group ${isSequential ? 'mt-1' : 'mt-6'}`}>
                  {!isSequential ? (
                    <Avatar className="h-8 w-8 shrink-0 shadow-sm border mb-1">
                      <AvatarFallback className="text-xs font-semibold bg-neutral-100 text-neutral-800">Op</AvatarFallback>
                    </Avatar>
                  ) : (
                    <div className="h-8 w-8 shrink-0"></div>
                  )}
                  <div 
                    className={`bg-white dark:bg-neutral-800 text-foreground border shadow-sm px-4 py-2.5 max-w-[85%] md:max-w-[70%] text-[15px] leading-relaxed transition-all
                      ${isSequential ? 'rounded-2xl rounded-tl-sm' : 'rounded-2xl'}
                    `}
                  >
                    {message.content}
                  </div>
                </div>
              )
            })}
            <div ref={messagesEndRef} className="h-2" />
          </div>
        )}
      </ScrollArea>

      {/* Send form */}
      <div className="px-4 py-4 md:px-6 md:py-5 border-t bg-background/95 backdrop-blur shrink-0 supports-[backdrop-filter]:bg-background/60">
        <div className="relative flex items-end gap-3 max-w-4xl mx-auto w-full z-20 pointer-events-auto">
          <Textarea
            placeholder="Type a message..."
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isSending}
            className="flex-1 resize-none min-h-[52px] max-h-[200px] text-[15px] p-3.5 pr-14 rounded-2xl bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 shadow-sm focus-visible:ring-indigo-500/20 focus-visible:border-indigo-500 transition-all pointer-events-auto shadow-inner"
            rows={1}
          />
          <Button
            size="icon"
            className={`absolute right-2 bottom-1.5 h-10 w-10 rounded-xl pointer-events-auto transition-all ${
              !messageText.trim() || isSending
                ? 'bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500'
                : 'bg-indigo-600 text-white hover:bg-indigo-700 hover:scale-105 shadow-md hover:shadow-lg'
            }`}
             onClick={(e) => {
              e.preventDefault();
              handleSend();
            }}
            disabled={!messageText.trim() || isSending}
          >
            <Send className="h-5 w-5 ml-0.5" />
          </Button>
        </div>
      </div>

      {/* Delete confirm dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the conversation with{' '}
              <strong>{displayName}</strong> and all its messages. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setShowDeleteDialog(false)
                onDelete()
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
