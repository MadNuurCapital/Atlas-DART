import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Honest placeholder for a route whose screen is built in a later phase.
 *
 * Deliberately says what is not built yet rather than showing an empty state
 * that looks like real data. The route exists now so navigation, the layout and
 * the access rules can be tested end to end.
 */
export function PhasePlaceholder({
  title,
  phase,
  description,
}: {
  title: string;
  phase: string;
  description: string;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>{description}</p>
          <p className="inline-flex rounded-md bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
            Arrives in {phase}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
