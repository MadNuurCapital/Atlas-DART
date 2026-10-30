import { Card, CardContent, CardHeader } from "@/components/ui/card";

/**
 * What the dashboard shows while its data is in flight.
 *
 * Next renders this immediately and streams the real page in behind it, so the
 * header, navigation and the shape of the page are on screen in the first few
 * milliseconds rather than after the database in Singapore has answered.
 *
 * The layout here deliberately mirrors the real grid - same column spans, same
 * tile heights. A skeleton that does not match causes the page to jump when
 * the data lands, which reads as slower than no skeleton at all even though it
 * is strictly faster.
 */
function Tile({ className = "" }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="h-8 w-32 animate-pulse rounded bg-muted" />
        <div className="h-3 w-full animate-pulse rounded bg-muted" />
      </CardContent>
    </Card>
  );
}

export default function DashboardLoading() {
  return (
    <div
      className="grid gap-4 lg:grid-cols-6"
      // Announced politely rather than assertively: it is a loading state, not
      // something that should interrupt what a screen reader is already saying.
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading your dashboard"
    >
      <Tile className="lg:col-span-6" />
      <Tile className="lg:col-span-2" />
      <Tile className="lg:col-span-2" />
      <Tile className="lg:col-span-2" />
      <Tile className="lg:col-span-3" />
      <Tile className="lg:col-span-3" />
    </div>
  );
}
