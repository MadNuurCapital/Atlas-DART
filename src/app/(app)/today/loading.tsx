import { Card, CardContent, CardHeader } from "@/components/ui/card";

/**
 * The shape of /today while its data is in flight.
 *
 * Deliberately NOT an empty form. An empty form and a day with nothing
 * recorded look identical, and someone who typed into one while the real
 * numbers were still arriving would overwrite them. A skeleton cannot be
 * typed into.
 */
function Block({ lines }: { lines: number }) {
  return (
    <Card>
      <CardHeader>
        <div className="h-5 w-32 animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="h-10 w-full animate-pulse rounded bg-muted" />
        ))}
      </CardContent>
    </Card>
  );
}

export default function TodayLoading() {
  return (
    <div
      className="mx-auto w-full max-w-2xl space-y-4"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading your day"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="size-11" aria-hidden="true" />
        <div className="h-6 w-40 animate-pulse rounded bg-muted" />
        <div className="size-11" aria-hidden="true" />
      </div>
      <Block lines={4} />
      <Block lines={2} />
    </div>
  );
}
