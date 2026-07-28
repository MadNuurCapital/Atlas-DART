import { Skeleton, SkeletonStats } from "@/components/ui/skeleton";

/** Shaped like the daily form, so the page does not jump when it arrives. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="size-11 rounded-md" />
        <div className="space-y-1.5 text-center">
          <Skeleton className="mx-auto h-5 w-24" />
          <Skeleton className="mx-auto h-3 w-40" />
        </div>
        <Skeleton className="size-11 rounded-md" />
      </div>

      <div className="space-y-5 rounded-xl border border-border bg-card p-5">
        <Skeleton className="h-4 w-28" />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-12 w-full rounded-md" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-12 w-full rounded-md" />
          </div>
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-12 w-full rounded-md" />
        </div>
        <Skeleton className="h-16 w-full rounded-lg" />
        <div className="flex gap-2">
          <Skeleton className="h-14 flex-1 rounded-lg" />
          <Skeleton className="h-14 flex-1 rounded-lg" />
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-border bg-card p-5">
        <Skeleton className="h-4 w-28" />
        <SkeletonStats count={4} />
      </div>
    </div>
  );
}
