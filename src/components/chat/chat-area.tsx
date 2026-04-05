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
    return 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-950/50 dark:border-blue-800 dark:text-blue-300'
  }
  if (type === 'tool_result') {
    return 'bg-green-50 border-green-200 text-green-700 dark:bg-green-950/50 dark:border-green-800 dark:text-green-300'
  }
  if (type === 'error' || severity === 'error') {
    return 'bg-red-50 border-red-200 text-red-700 dark:bg-red-950/50 dark:border-red-800 dark:text-red-300'
  }
  return 'bg-muted text-muted-foreground'
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
      <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0">
        {/* Mobile back button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 md:hidden shrink-0"
          onClick={onBack}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        {/* Avatar */}
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarFallback className="text-xs">{avatarInitial}</AvatarFallback>
        </Avatar>

        {/* Name / email */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{displayName}</p>
          {conversation.visitorEmail && conversation.visitorName && (
            <p className="text-xs text-muted-foreground truncate">
              {conversation.visitorEmail}
            </p>
          )}
        </div>

        {/* Show debug checkbox */}
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={showDebug}
            onChange={(e) => setShowDebug(e.target.checked)}
            className="h-3 w-3"
          />
          Show debug
        </label>

        {/* Dropdown menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
              <MoreVertical className="h-4 w-4" />
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

      {/* Messages */}
      <ScrollArea className="flex-1 px-4 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            Loading messages...
          </div>
        ) : visibleMessages.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            No messages yet.
          </div>
        ) : (
          <div className="space-y-3">
            {visibleMessages.map((message) => {
              const isInternal = !!message.metadata?.internal

              if (isInternal) {
                // Debug/internal message — centered, monospace, color-coded
                return (
                  <div key={message.id} className="flex justify-center">
                    <div
                      className={[
                        'rounded-md border px-3 py-1.5 text-xs font-mono max-w-[90%] text-center',
                        getDebugMessageStyle(message),
                      ].join(' ')}
                    >
                      {message.content}
                    </div>
                  </div>
                )
              }

              if (message.role === 'visitor') {
                // Visitor: right-aligned, blue
                return (
                  <div key={message.id} className="flex justify-end">
                    <div className="bg-primary text-primary-foreground rounded-2xl px-4 py-2 max-w-[75%] text-sm">
                      {message.content}
                    </div>
                  </div>
                )
              }

              // Assistant: left-aligned, white/dark border with avatar
              return (
                <div key={message.id} className="flex items-end gap-2">
                  <Avatar className="h-6 w-6 shrink-0">
                    <AvatarFallback className="text-xs">A</AvatarFallback>
                  </Avatar>
                  <div className="bg-muted border rounded-2xl px-4 py-2 max-w-[75%] text-sm">
                    {message.content}
                  </div>
                </div>
              )
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      {/* Send form */}
      <div className="px-4 py-3 border-t shrink-0">
        <div className="relative">
          <Textarea
            placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isSending}
            className="pr-12 resize-none min-h-[44px] max-h-[150px] text-sm"
            rows={1}
          />
          <Button
            size="icon"
            className="absolute right-2 bottom-2 h-8 w-8"
            onClick={handleSend}
            disabled={!messageText.trim() || isSending}
          >
            <Send className="h-4 w-4" />
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
