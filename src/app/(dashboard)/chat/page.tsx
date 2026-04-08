// Admin chat — Inbox tab + Playground tab
// Tab is URL-driven: ?tab=inbox (default) | ?tab=playground
// Auth: handled by (dashboard)/layout.tsx
import Link from 'next/link'
import { AdminChatLayout } from '@/components/chat/admin-chat-layout'
import { PlaygroundChat } from '@/components/chat/playground-chat'
import { getPlaygroundConfig } from './actions'

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const params = await searchParams
  const tab = params.tab === 'playground' ? 'playground' : 'inbox'

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-0 border-b shrink-0">
        <Link
          href="/chat?tab=inbox"
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'inbox'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Inbox
        </Link>
        <Link
          href="/chat?tab=playground"
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'playground'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Playground
        </Link>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'inbox' ? (
          <AdminChatLayout />
        ) : (
          <PlaygroundTab />
        )}
      </div>
    </div>
  )
}

async function PlaygroundTab() {
  const config = await getPlaygroundConfig()
  if (!config) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Could not load playground — widget token not found.
      </div>
    )
  }
  return (
    <PlaygroundChat
      widgetToken={config.widgetToken}
      displayName={config.displayName}
      avatarUrl={config.avatarUrl}
    />
  )
}
