'use client'

import { useState, useEffect, useCallback } from 'react'

import { ConversationSummary, ConversationMessage } from '@/types/chat'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable'
import { ConversationList } from '@/components/chat/conversation-list'
import { ChatArea } from '@/components/chat/chat-area'

export function AdminChatLayout() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [isMessagesLoading, setIsMessagesLoading] = useState(false)
  const [isMobileListVisible, setIsMobileListVisible] = useState(true)

  // Fetch conversations
  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/conversations')
      if (!res.ok) return
      const data = await res.json()
      setConversations(data.conversations ?? [])
    } catch {
      // silently fail — will retry on next interval
    }
  }, [])

  // Fetch messages for a conversation
  const fetchMessages = useCallback(async (id: string) => {
    setIsMessagesLoading(true)
    try {
      const res = await fetch(
        `/api/chat/conversations/${id}/messages?includeInternal=true`
      )
      if (!res.ok) return
      const data = await res.json()
      setMessages(data.messages ?? [])
    } catch {
      // silently fail
    } finally {
      setIsMessagesLoading(false)
    }
  }, [])

  // Poll conversations: 30s normally, 15s when a conversation is open
  useEffect(() => {
    fetchConversations()
    const interval = setInterval(
      fetchConversations,
      selectedConversationId ? 15000 : 30000
    )
    return () => clearInterval(interval)
  }, [selectedConversationId, fetchConversations])

  // Poll messages for the selected conversation
  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([])
      return
    }
    fetchMessages(selectedConversationId)
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchMessages(selectedConversationId)
      }
    }, 15000)
    return () => clearInterval(interval)
  }, [selectedConversationId, fetchMessages])

  // Optimistic send
  async function handleSendMessage(content: string) {
    if (!selectedConversationId) return

    // Optimistic append
    const tempId = `temp-${Date.now()}`
    const tempMsg: ConversationMessage = {
      id: tempId,
      conversationId: selectedConversationId,
      role: 'assistant',
      content,
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, tempMsg])

    try {
      const res = await fetch(
        `/api/chat/conversations/${selectedConversationId}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, role: 'assistant' }),
        }
      )
      if (!res.ok) throw new Error('Failed to send')
      // Reload to get real message with server ID
      await fetchMessages(selectedConversationId)
    } catch {
      // Rollback on error
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
    }
  }

  async function handleStatusChange(status: 'open' | 'closed') {
    if (!selectedConversationId) return
    try {
      await fetch(
        `/api/chat/conversations/${selectedConversationId}/status`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        }
      )
      await fetchConversations()
    } catch {
      // silently fail
    }
  }

  async function handleDelete(id: string) {
    try {
      await fetch(`/api/chat/conversations/${id}`, { method: 'DELETE' })
      setSelectedConversationId(null)
      setMessages([])
      setIsMobileListVisible(true)
      await fetchConversations()
    } catch {
      // silently fail
    }
  }

  const selectedConversation =
    conversations.find((c) => c.id === selectedConversationId) ?? null

  return (
    <div className="flex flex-col h-full">
      {/* Desktop layout */}
      <ResizablePanelGroup
        direction="horizontal"
        className="hidden md:flex h-full"
      >
        <ResizablePanel
          defaultSize={25}
          minSize={20}
          maxSize={40}
          className="min-w-[280px]"
        >
          <ConversationList
            conversations={conversations}
            selectedId={selectedConversationId}
            onSelect={setSelectedConversationId}
            onConversationUpdated={fetchConversations}
            onConversationDeleted={(id) => {
              if (selectedConversationId === id) {
                setSelectedConversationId(null)
                setMessages([])
              }
              fetchConversations()
            }}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={75}>
          <ChatArea
            conversation={selectedConversation}
            messages={messages}
            isLoading={isMessagesLoading}
            onSendMessage={handleSendMessage}
            onStatusChange={handleStatusChange}
            onDelete={() =>
              selectedConversationId && handleDelete(selectedConversationId)
            }
            onBack={() => {}}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Mobile layout */}
      <div className="flex md:hidden relative flex-1 overflow-hidden">
        {/* List panel */}
        <div
          className={`absolute inset-0 transition-transform duration-300 ease-in-out ${
            isMobileListVisible ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <ConversationList
            conversations={conversations}
            selectedId={selectedConversationId}
            onSelect={(id) => {
              setSelectedConversationId(id)
              setIsMobileListVisible(false)
            }}
            onConversationUpdated={fetchConversations}
            onConversationDeleted={(id) => {
              if (selectedConversationId === id) {
                setSelectedConversationId(null)
                setMessages([])
              }
              fetchConversations()
            }}
          />
        </div>

        {/* Detail panel */}
        <div
          className={`absolute inset-0 transition-transform duration-300 ease-in-out ${
            isMobileListVisible ? 'translate-x-full' : 'translate-x-0'
          }`}
        >
          <ChatArea
            conversation={selectedConversation}
            messages={messages}
            isLoading={isMessagesLoading}
            onSendMessage={handleSendMessage}
            onStatusChange={handleStatusChange}
            onDelete={() =>
              selectedConversationId && handleDelete(selectedConversationId)
            }
            onBack={() => setIsMobileListVisible(true)}
          />
        </div>
      </div>
    </div>
  )
}
