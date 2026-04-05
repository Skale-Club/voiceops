# Phase 6: Chat Inbox — Context

**Gathered:** 2026-04-05
**Status:** Ready for planning
**Source:** PRD Express Path (user-provided spec)

<domain>
## Phase Boundary

Phase 6 delivers:
1. **New database tables** — `conversations` and `conversation_messages` (replaces or extends `chat_sessions` and `chat_messages` from Phase 2)
2. **Admin API endpoints** — list/detail/messages/send/status/delete for conversations; settings read
3. **Admin inbox UI** — `/chat` page with responsive ConversationList + ChatArea, ResizablePanelGroup on desktop, slide animation on mobile
4. **Widget settings relocation** — `/widget` admin page moves under the Chat sidebar section (Chat > Settings); widget is no longer a standalone sidebar item
5. **TypeScript types** — `ConversationSummary` and `ConversationMessage` interfaces

</domain>

<decisions>
## Implementation Decisions

### Database Schema

#### Table: `conversations`
```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
org_id          UUID REFERENCES organizations(id) NOT NULL  -- RLS scope
status          TEXT DEFAULT 'open'                         -- 'open' | 'closed'
created_at      TIMESTAMPTZ DEFAULT NOW()
updated_at      TIMESTAMPTZ DEFAULT NOW()
last_message_at TIMESTAMPTZ
first_page_url  TEXT
visitor_name    TEXT
visitor_phone   TEXT
visitor_email   TEXT
last_message    TEXT    -- denormalized cache of latest message text
memory          JSONB DEFAULT '{}'
```

#### Table: `conversation_messages`
```sql
id               UUID PRIMARY KEY DEFAULT gen_random_uuid()
conversation_id  UUID REFERENCES conversations(id) ON DELETE CASCADE NOT NULL
org_id           UUID REFERENCES organizations(id) NOT NULL  -- denormalized for RLS
role             TEXT NOT NULL    -- 'assistant' | 'visitor'
content          TEXT NOT NULL
created_at       TIMESTAMPTZ DEFAULT NOW()
metadata         JSONB            -- { internal: bool, type: 'tool_call'|'tool_result', severity: 'error', toolName: string }
```

- `metadata.internal === true` → system/debug message, hidden from visitor and from admin default view
- RLS: `org_id` must equal `get_current_org_id()` on both tables
- Migration number: 014 (next available)

### Relationship to Existing Phase 2 Tables
Phase 2 created `chat_sessions` and `chat_messages`. Phase 6 introduces `conversations` and `conversation_messages` as the admin-visible representation. The planner must decide whether to:
- **Option A:** Rename/migrate Phase 2 tables and update the chat API to write to the new schema
- **Option B:** Create new tables and write a view or sync layer
- Recommended: **Option A** — rename `chat_sessions` → `conversations` and `chat_messages` → `conversation_messages`; update migration and all references in `/api/chat/[token]/route.ts`

### API Endpoints (all admin-auth gated via `getUser()`)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/chat/conversations` | List all conversations ordered by `last_message_at DESC`, with denormalized `last_message` |
| GET | `/api/chat/conversations/[id]` | Single conversation detail |
| GET | `/api/chat/conversations/[id]/messages` | Paginated messages. Params: `limit`, `before` (cursor UUID), `includeInternal=true` |
| POST | `/api/chat/conversations/[id]/messages` | Admin sends message. Body: `{ content, role: 'assistant' }` |
| POST | `/api/chat/conversations/[id]/status` | Update status. Body: `{ status: 'open' | 'closed' }` |
| DELETE | `/api/chat/conversations/[id]` | Delete conversation + messages |
| GET | `/api/chat/settings` | Widget settings for the org (display name, avatar URL) |

#### GET /conversations query:
```sql
SELECT conversations.*,
  COALESCE(conversations.last_message, (
    SELECT content FROM conversation_messages
    WHERE conversation_id = conversations.id
    ORDER BY created_at DESC LIMIT 1
  )) AS last_message
FROM conversations
WHERE org_id = get_current_org_id()
ORDER BY COALESCE(last_message_at, created_at) DESC
```

#### GET /messages pagination (cursor-based):
- No `before`: return last `limit` records → `{ messages, hasMore: bool }`
- With `before=<uuid>`: return `limit` messages before that ID (load older history)
- Without `includeInternal=true`: filter `WHERE metadata->>'internal' != 'true'`

### TypeScript Types
```ts
interface ConversationSummary {
  id: string;
  status: string;               // 'open' | 'closed'
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string | null;
  visitorName?: string | null;
  visitorEmail?: string | null;
  visitorPhone?: string | null;
  lastMessage?: string;
}

interface ConversationMessage {
  id: string;
  conversationId: string;
  role: string;                 // 'assistant' | 'visitor'
  content: string;
  createdAt: string;
  metadata?: Record<string, any> | null;
}
```

### Component Structure
```
src/app/(dashboard)/chat/page.tsx        ← New /chat route (server component shell)
src/components/chat/admin-chat-layout.tsx ← Client orchestrator
src/components/chat/conversation-list.tsx ← Sidebar list
src/components/chat/chat-area.tsx         ← Message thread + input
```

### AdminChatLayout State
```ts
const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
const [messages, setMessages] = useState<ConversationMessage[]>([])
const [isMessagesLoading, setIsMessagesLoading] = useState(false)
const [isMobileListVisible, setIsMobileListVisible] = useState(true)
```

### Data Fetching Strategy
- Conversations: React Query `useQuery` with `refetchInterval` (15s when conversation open, 30s otherwise), `refetchOnWindowFocus: false`, `refetchIntervalInBackground: false`
- Messages: manual fetch on conversation select + 15s polling (only when `document.visibilityState === 'visible'`)
- Optimistic send: append temp message → POST → reload silently → rollback on error

### Desktop Layout
- `ResizablePanelGroup direction="horizontal"`
- Left panel: `defaultSize={25}`, `minSize={20}`, `maxSize={40}`, `min-w-[280px]`
- Right panel: `defaultSize={75}`
- Settings sheet trigger in left panel header

### Mobile Layout
- Two `absolute inset-0` divs with CSS transform slide animation (300ms ease-in-out)
- List: `translate-x-0` when visible, `-translate-x-full` when hidden
- Detail: `translate-x-full` when hidden, `translate-x-0` when visible
- Back button (ArrowLeft) in ChatArea header, only on mobile (`md:hidden`)

### ConversationList
- Search field with `Search` icon (filters on `visitorName`, `lastMessage`, `visitorEmail`)
- Tabs: Open / Archived / All (maps to `status === 'open'` / `status === 'closed'` / all)
- Items: visitor name, badge if archived, relative time from `lastMessageAt`, last message preview (line-clamp-2)
- Selected item shows Archive/Reopen button and Delete (AlertDialog-gated) buttons
- Selected state: `bg-slate-100 border-slate-300 dark:bg-slate-800/80 dark:border-slate-700`
- Hover state: `hover:bg-slate-100 dark:hover:bg-slate-800/70`

### ChatArea
- Header: avatar + visitor name/email, "Show debug" checkbox, DropdownMenu for Archive/Delete
- Message bubbles:
  - Visitor: right-aligned, `bg-blue-600 text-white`, `rounded-2xl`
  - Assistant: left-aligned, `bg-white dark:bg-slate-800 border`, `rounded-2xl`, assistant avatar shown
  - Internal/debug: centered, monospace font, color-coded by type:
    - `tool_call` → blue (`bg-blue-50 border-blue-200 text-blue-700`)
    - `tool_result` → green (`bg-green-50 border-green-200 text-green-700`)
    - `error` → red (`bg-red-50 border-red-200 text-red-700`)
    - other internal → secondary muted
- Auto-scroll to bottom on messages change (`messagesEndRef.current?.scrollIntoView`)
- Textarea input, min-h `44px`, max-h `150px`, Enter sends (Shift+Enter = newline)
- Send button absolutely positioned inside textarea, right-bottom

### Widget Settings Sidebar Relocation
- Remove `/widget` as standalone sidebar item
- Add **Chat** group to sidebar: Chat > Inbox, Chat > Settings
- `/chat` → Inbox, `/widget` → Settings (URL stays the same, only nav changes)
- Use `MessageSquare` icon for Chat group

### Empty State (no conversation selected)
- `MessageSquare` icon at 20% opacity
- "No conversation selected" heading
- "Select a conversation from the list to view details."

### Dependencies to install/verify
- `@tanstack/react-query` — already installed (verify in package.json)
- `date-fns` — verify installed
- shadcn components to add if missing: `resizable`, `sheet`, `dropdown-menu`, `alert-dialog`, `avatar`, `badge`, `tabs`, `textarea`, `scroll-area`

### Claude's Discretion
- Exact migration number (recommend 014, confirm no collision)
- Whether to use React Query's `QueryClientProvider` already present or add it
- Error boundary / skeleton loading states design
- Whether `GET /api/chat/settings` reuses existing `/api/widget/[token]/config` logic or is a new separate admin-only route
- Exact shadcn component availability (check before using, install if missing)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Auth & Client Pattern
- `src/lib/supabase/server.ts` — cached `getUser()` and `createClient()` helpers (always use these, never `supabase.auth.getUser()` directly)
- `CLAUDE.md` — project-wide conventions (auth, API routes, components, file structure)

### Existing Chat Infrastructure (Phase 2)
- `src/app/api/chat/[token]/route.ts` — current chat API writing to `chat_sessions`/`chat_messages`
- `supabase/migrations/011_chat_tables.sql` — Phase 2 schema (tables to rename/migrate)
- `supabase/migrations/012_widget_token.sql` — widget token migration

### Sidebar Navigation
- `src/components/layout/app-sidebar.tsx` — current sidebar; add Chat group here

### Widget Settings Page (to relocate under Chat)
- `src/app/(dashboard)/widget/page.tsx` — stays at `/widget`, only sidebar nav changes

### Database Types
- `src/types/database.ts` — update after migration

### React Query Setup
- `package.json` — verify `@tanstack/react-query` present
- Check if `QueryClientProvider` already wraps the app (likely in a layout or root)

</canonical_refs>

<specifics>
## Specific Ideas

- Message list uses cursor-based pagination (not offset) for correctness with real-time data
- `metadata.internal` is the canonical flag for debug/tool messages — not a separate table
- Denormalize `org_id` on `conversation_messages` for RLS without joins (same pattern as Phase 2 `chat_messages`)
- The "Show debug" toggle is a client-side filter (no API call), just `filter(msg => showDebug || !msg.metadata?.internal)`
- Token regeneration warning copy in the Widget Settings page must reference that old embed scripts break — already implemented in Phase 5

</specifics>

<deferred>
## Deferred Ideas

- Real-time push (WebSocket / Supabase Realtime) — polling is acceptable for MVP
- Visitor-initiated file/image upload in chat
- Admin-to-admin internal notes on conversations
- Conversation assignment to specific team members
- Email/SMS notification when new conversation arrives
- Read/unread tracking per message

</deferred>

---

*Phase: 06-chat-inbox*
*Context gathered: 2026-04-05 via PRD Express Path (user spec)*
