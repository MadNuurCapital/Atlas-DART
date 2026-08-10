import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

/**
 * Shaped like the dashboard it stands in for.
 *
 * That shape is the whole point. A skeleton at the wrong width or column count
 * does not read as loading - it reads as the page loading wrong and then
 * jumping, which feels worse than no skeleton at all. So this mirrors the real
 * grid: six columns on a laptop, the same 4/2 and 3/3 spans, the same tile
 * radius.
 */
function Tile({ className }: { className?: string }) {
  return (
    <div
      className={`min-w-0 rounded-2xl border border-border bg-card p-5 ${className ?? ""}`}
    >
      <Skeleton className="h-4 w-24" />
      <div className="mt-4 space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="mx-auto grid w-full max-w-6xl auto-rows-min grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
      <div className="space-y-2 sm:col-span-2 lg:col-span-6">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-3 w-72" />
      </div>

      {/* Today, four columns wide, with its six DART figures. */}
      <div className="min-w-0 rounded-2xl border border-border bg-card p-5 sm:col-span-2 lg:col-span-4">
        <Skeleton className="h-4 w-16" />
        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="rounded-xl bg-secondary/70 px-2 py-3">
              <Skeleton className="mx-auto h-5 w-8" />
              <Skeleton className="mx-auto mt-1.5 h-2 w-5" />
            </div>
          ))}
        </div>
        <Skeleton className="mt-4 h-3 w-56" />
        <Skeleton className="mt-6 h-11 w-full rounded-md sm:w-52" />
      </div>

      {/* The GR ring. */}
      <div className="min-w-0 rounded-2xl border border-border bg-card p-5 lg:col-span-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mx-auto mt-4 aspect-square w-full max-w-[9rem] rounded-full" />
        <Skeleton className="mx-auto mt-4 h-5 w-28" />
        <Skeleton className="mx-auto mt-2 h-3 w-20" />
      </div>

      <Tile className="sm:col-span-2 lg:col-span-3" />
      <Tile className="sm:col-span-2 lg:col-span-3" />

      <SkeletonCard className="sm:col-span-2 lg:col-span-4" lines={4} />
      <Tile className="lg:col-span-2" />
    </div>
  );
}
