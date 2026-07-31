import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, POLICY_TYPES } from "@/lib/constants";
import type { CaseMixByCategory } from "@/types/database";

/**
 * Case Mix by Category (decision D18).
 *
 * Reproduces the cross-tab from the original Numbers workbook: counts and APE
 * per policy type. Categories with nothing in them are hidden rather than shown
 * as a row of zeros.
 */
export function CaseMixPanel({
  rows,
  title = "Case mix this month",
  className,
}: {
  rows: CaseMixByCategory[];
  title?: string;
  className?: string;
}) {
  const byType = new Map(rows.map((r) => [r.policy_type, r]));
  const present = POLICY_TYPES.filter((t) => byType.has(t));

  const totalCases = rows.reduce((n, r) => n + Number(r.case_count), 0);
  const totalApe = rows.reduce((n, r) => n + Number(r.ape), 0);

  if (present.length === 0) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No active cases this month yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th scope="col" className="pb-2 font-medium">
                  Category
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  Cases
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  APE
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  GR
                </th>
              </tr>
            </thead>
            <tbody>
              {present.map((type) => {
                const row = byType.get(type)!;
                return (
                  <tr key={type} className="border-b border-border/60">
                    <th scope="row" className="py-2 text-left font-normal">
                      {type}
                    </th>
                    <td className="py-2 text-right tabular-nums">
                      {row.case_count}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatCurrency(Number(row.ape))}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatCurrency(Number(row.gr))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-medium">
                <th scope="row" className="pt-2 text-left">
                  Total
                </th>
                <td className="pt-2 text-right tabular-nums">{totalCases}</td>
                <td className="pt-2 text-right tabular-nums">
                  {formatCurrency(totalApe)}
                </td>
                <td className="pt-2 text-right tabular-nums">
                  {formatCurrency(
                    rows.reduce((n, r) => n + Number(r.gr), 0),
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
