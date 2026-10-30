import { Card, CardContent, CardHeader } from "@/components/ui/card";

/**
 * The admin overview while the team's day is in flight.
 *
 * Fifteen placeholder rows rather than a spinner: the board is a list of
 * people, and a list-shaped skeleton means the page does not jump when the
 * real names land.
 */
export default function AdminOverviewLoading() {
  return (
    <div
      className="space-y-4"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading the team overview"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            </CardHeader>
            <CardContent>
              <div className="h-8 w-28 animate-pulse rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="h-5 w-36 animate-pulse rounded bg-muted" />
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 15 }).map((_, i) => (
            <div
              key={i}
              className="h-12 w-full animate-pulse rounded bg-muted"
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
