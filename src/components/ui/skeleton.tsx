import { cn } from "@/lib/utils";

/**
 * A grey block standing in for content that has not arrived.
 *
 * Used by the loading.tsx files. On a phone over mobile data the difference
 * between a blank screen and a shape that already looks like the page is the
 * difference between "broken" and "loading", even when the wait is identical.
 */
export function Skeleton({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

/**
 * A card-shaped placeholder, matching the spacing of a real Card.
 *
 * rounded-2xl, not rounded-xl: it has to match what Card actually renders, or
 * the corners visibly tighten the moment real content replaces it. Takes a
 * className so a skeleton can carry the same grid spans as the tile it stands
 * in for - a placeholder in the wrong column is worse than none, because the
 * page then jumps as it settles.
 */
export function SkeletonCard({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 space-y-3 rounded-2xl border border-border bg-card p-5",
        className,
      )}
    >
      <Skeleton className="h-4 w-32" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className="h-3"
          style={{ width: `${90 - i * 15}%` }}
        />
      ))}
    </div>
  );
}

/** The grid of D / TT / AO / AC / FU / N tiles. */
export function SkeletonStats({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-lg bg-secondary px-2 py-2.5">
          <Skeleton className="mx-auto h-5 w-8" />
          <Skeleton className="mx-auto mt-1.5 h-2 w-6" />
        </div>
      ))}
    </div>
  );
}
