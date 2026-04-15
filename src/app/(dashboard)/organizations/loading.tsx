import { Skeleton } from '@/components/ui/skeleton'

export default function OrganizationsLoading() {
  return (
    <div className="p-6 space-y-5">
      <div>
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-4 w-80 mt-1.5" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-md" />
        ))}
      </div>
    </div>
  )
}
