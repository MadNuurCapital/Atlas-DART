import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-3 w-72" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-12 flex-1 rounded-md" />
        <Skeleton className="h-12 w-28 rounded-md" />
      </div>
      <SkeletonCard lines={3} />
      <SkeletonCard lines={3} />
    </div>
  );
}
