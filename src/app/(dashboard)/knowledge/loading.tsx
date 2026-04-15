import { Skeleton } from '@/components/ui/skeleton'

export default function KnowledgeLoading() {
  return (
    <div className="p-6 space-y-5">
      <div>
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-4 w-96 mt-1.5" />
      </div>
      <Skeleton className="h-32 w-full rounded-md" />
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-md" />
        ))}
      </div>
    </div>
  )
}
