import { Skeleton, SkeletonCard, SkeletonStats } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-3 w-64" />
      </div>

      <div className="space-y-4 rounded-xl border border-border bg-card p-5">
        <Skeleton className="h-4 w-20" />
        <SkeletonStats />
        <Skeleton className="h-11 w-40 rounded-md" />
      </div>

      <SkeletonCard lines={3} />
    </div>
  );
}
