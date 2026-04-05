interface WidgetPreviewProps {
  displayName: string
  primaryColor: string
  welcomeMessage: string
  avatarUrl?: string | null
}

export function WidgetPreview({
  displayName,
  primaryColor,
  welcomeMessage,
  avatarUrl,
}: WidgetPreviewProps) {
  const initials = displayName.trim().slice(0, 2).toUpperCase() || 'AI'

  return (
    <div className="mx-auto w-full max-w-[360px] rounded-[28px] border bg-background p-3 shadow-sm">
      <div className="overflow-hidden rounded-[22px] border bg-white">
        <div className="flex items-center gap-3 border-b bg-zinc-50 px-4 py-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-semibold text-white overflow-hidden"
            style={{ backgroundColor: primaryColor }}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt={displayName} className="h-full w-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-950">{displayName}</p>
            <p className="text-xs text-zinc-500">Usually replies in a few seconds</p>
          </div>
        </div>

        <div className="space-y-3 bg-white px-4 py-5">
          <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-zinc-100 px-4 py-3 text-sm text-zinc-900">
            {welcomeMessage}
          </div>
          <div
            className="ml-auto max-w-[75%] rounded-2xl rounded-br-md px-4 py-3 text-sm text-white"
            style={{ backgroundColor: primaryColor }}
          >
            I&apos;d like to learn more.
          </div>
          <div className="max-w-[80%] rounded-2xl rounded-tl-md bg-zinc-100 px-4 py-3 text-sm text-zinc-900">
            Absolutely — I can answer questions or help route you to the next step.
          </div>
        </div>

        <div className="flex items-center gap-3 border-t bg-white px-4 py-3">
          <div className="h-10 flex-1 rounded-full border bg-zinc-50 px-4 text-sm leading-10 text-zinc-400">
            Type your message...
          </div>
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white"
            style={{ backgroundColor: primaryColor }}
          >
            ↑
          </div>
        </div>
      </div>
    </div>
  )
}
