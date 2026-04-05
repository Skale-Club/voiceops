// src/types/chat.ts
// Admin chat inbox TypeScript types.
// These interfaces represent the shape returned by /api/chat/conversations/* endpoints.

export interface ConversationSummary {
  id: string
  status: string               // 'open' | 'closed'
  createdAt: string
  updatedAt: string
  lastMessageAt?: string | null
  visitorName?: string | null
  visitorEmail?: string | null
  visitorPhone?: string | null
  lastMessage?: string | null
}

export interface ConversationMessage {
  id: string
  conversationId: string
  role: string                 // 'assistant' | 'visitor'
  content: string
  createdAt: string
  metadata?: Record<string, unknown> | null
}
