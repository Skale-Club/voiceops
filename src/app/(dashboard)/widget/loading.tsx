import { Skeleton } from '@/components/ui/skeleton'

export default function WidgetLoading() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-4 w-80 mt-1.5" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-md" />
          ))}
          <Skeleton className="h-10 w-32 rounded-md" />
        </div>
        <Skeleton className="h-72 w-full rounded-md" />
      </div>
    </div>
  )
}
