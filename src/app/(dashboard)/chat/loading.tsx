import { Skeleton } from '@/components/ui/skeleton'

export default function ChatLoading() {
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1 px-4 pt-3 pb-0 border-b shrink-0 h-12">
        <Skeleton className="h-7 w-16" />
        <Skeleton className="h-7 w-24" />
      </div>
      <div className="flex-1 flex">
        <div className="w-72 border-r p-3 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-md" />
          ))}
        </div>
        <div className="flex-1 p-6 flex items-center justify-center">
          <Skeleton className="h-32 w-full max-w-md rounded-md" />
        </div>
      </div>
    </div>
  )
}
