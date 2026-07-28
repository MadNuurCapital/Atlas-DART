import { Skeleton } from "@/components/ui/skeleton";

/** Shaped like the team board, which is the heaviest page in the app. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3 w-64" />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="rounded-lg border border-border bg-card px-3 py-2.5"
          >
            <Skeleton className="h-5 w-12" />
            <Skeleton className="mt-1.5 h-2 w-16" />
          </div>
        ))}
      </div>

      <Skeleton className="h-12 w-full rounded-md" />

      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-xl border border-border bg-card p-4"
          >
            <Skeleton className="size-3 rounded-full" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
