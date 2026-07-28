import { SkeletonCard } from "@/components/ui/skeleton";

/**
 * Shown the instant a navigation starts, while the server renders.
 *
 * Without this the screen simply does not change until every query has come
 * back, which reads as a frozen app rather than a loading one - especially on
 * a phone, and especially when the database is a long way from the server.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <SkeletonCard lines={2} />
      <SkeletonCard lines={3} />
    </div>
  );
}
