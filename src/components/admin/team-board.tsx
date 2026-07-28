"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, RefreshCw, CircleCheck, CircleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  CAMPAIGN_STATUS_LABELS,
  formatCurrency,
} from "@/lib/constants";
import { formatSgTime } from "@/lib/sg-date";
import type { TeamDailyRow } from "@/types/database";

function OfficeDot({ inOffice }: { inOffice: boolean | null }) {
  const cls =
    inOffice === null
      ? "bg-status-missing"
      : inOffice
        ? "bg-status-present"
        : "bg-status-absent";
  const label =
    inOffice === null
      ? "No submission"
      : inOffice
        ? "In the office"
        : "Not in the office";

  return (
    <span
      className={`inline-block size-3 shrink-0 rounded-full ${cls}`}
      title={label}
      aria-label={label}
      role="img"
    />
  );
}

function StatusBadge({ row }: { row: TeamDailyRow }) {
  if (row.status === "missing") return <Badge variant="danger">Missing</Badge>;
  if (row.status === "draft") return <Badge variant="muted">Draft</Badge>;
  return (
    <Badge variant={row.on_time ? "success" : "warning"}>
      {row.on_time ? (
        <CircleCheck className="size-3" aria-hidden="true" />
      ) : (
        <CircleAlert className="size-3" aria-hidden="true" />
      )}
      {row.on_time ? "On time" : "Late"}
    </Badge>
  );
}

function n(value: number | null): number {
  return value === null ? 0 : Number(value);
}

/**
 * Admin daily board.
 *
 * Every active person appears, whether or not they submitted, because "who is
 * missing" is the question this screen exists to answer - and a missing person
 * who simply is not in the list cannot be seen.
 *
 * A wide table on desktop, cards on mobile. The Excel spreadsheet is
 * deliberately not reproduced on a phone.
 */
export function TeamBoard({
  initialRows,
  businessDate,
}: {
  initialRows: TeamDailyRow[];
  businessDate: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [live, setLive] = useState(false);
  const [justUpdated, setJustUpdated] = useState(false);

  // Realtime: refresh the server component when anything that feeds this board
  // changes, so an admin watching the screen sees submissions land without
  // touching anything.
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const bump = () => {
      setJustUpdated(true);
      router.refresh();
      clearTimeout(timer);
      timer = setTimeout(() => setJustUpdated(false), 2000);
    };

    const channel = supabase
      .channel("team-board")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "daily_submissions" },
        bump,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "appointment_activities" },
        bump,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cases" },
        bump,
      )
      .subscribe((status) => setLive(status === "SUBSCRIBED"));

    return () => {
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [router]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return initialRows;
    return initialRows.filter((r) => r.full_name.toLowerCase().includes(q));
  }, [initialRows, query]);

  const totals = useMemo(() => {
    const submitted = initialRows.filter((r) => r.status === "submitted");
    return {
      people: initialRows.length,
      submitted: submitted.length,
      missing: initialRows.filter((r) => r.status !== "submitted").length,
      late: submitted.filter((r) => r.on_time === false).length,
      inOffice: initialRows.filter((r) => r.in_office === true).length,
      dials: initialRows.reduce((s, r) => s + n(r.dials), 0),
      talkedTo: initialRows.reduce((s, r) => s + n(r.talked_to), 0),
      ao: initialRows.reduce((s, r) => s + n(r.appointments_opening), 0),
      ac: initialRows.reduce((s, r) => s + n(r.appointments_closing), 0),
      fu: initialRows.reduce((s, r) => s + n(r.appointments_follow_up), 0),
      nom: initialRows.reduce((s, r) => s + n(r.appointments_nomination), 0),
      cases: initialRows.reduce((s, r) => s + n(r.signed_cases), 0),
      gr: initialRows.reduce((s, r) => s + n(r.active_gr), 0),
    };
  }, [initialRows]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {[
          { label: "People", value: totals.people },
          { label: "Submitted", value: totals.submitted },
          { label: "Missing", value: totals.missing },
          { label: "Late", value: totals.late },
          { label: "In office", value: totals.inOffice },
          { label: "Team GR", value: formatCurrency(totals.gr) },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-border bg-card px-3 py-2.5"
          >
            <div className="text-lg font-semibold tabular-nums">{s.value}</div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {s.label}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {[
          { label: "D", value: totals.dials },
          { label: "TT", value: totals.talkedTo },
          { label: "AO", value: totals.ao },
          { label: "AC", value: totals.ac },
          { label: "FU", value: totals.fu },
          { label: "N", value: totals.nom },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-lg bg-secondary px-2 py-2 text-center"
          >
            <div className="text-base font-semibold tabular-nums text-secondary-foreground">
              {s.value}
            </div>
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {s.label}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a consultant"
            className="pl-9"
            aria-label="Find a consultant"
          />
        </div>

        <span
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
          aria-live="polite"
        >
          <RefreshCw
            className={`size-3.5 ${justUpdated ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          {live ? (justUpdated ? "Updating…" : "Live") : "Connecting…"}
        </span>
      </div>

      {/* Desktop table */}
      <Card className="hidden overflow-hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60">
              <tr className="text-left">
                <th scope="col" className="px-3 py-2.5 font-medium">Consultant</th>
                <th scope="col" className="px-2 py-2.5 font-medium">Status</th>
                <th scope="col" className="px-2 py-2.5 text-right font-medium">D</th>
                <th scope="col" className="px-2 py-2.5 text-right font-medium">TT</th>
                <th scope="col" className="px-2 py-2.5 text-right font-medium">AO</th>
                <th scope="col" className="px-2 py-2.5 text-right font-medium">AC</th>
                <th scope="col" className="px-2 py-2.5 text-right font-medium">FU</th>
                <th scope="col" className="px-2 py-2.5 text-right font-medium">N</th>
                <th scope="col" className="px-2 py-2.5 font-medium">Campaign</th>
                <th scope="col" className="px-2 py-2.5 text-right font-medium">Cases</th>
                <th scope="col" className="px-2 py-2.5 text-right font-medium">GR</th>
                <th scope="col" className="px-2 py-2.5 text-center font-medium">Office</th>
                <th scope="col" className="px-2 py-2.5 font-medium">First</th>
                <th scope="col" className="px-2 py-2.5 font-medium">Updated</th>
                <th scope="col" className="px-2 py-2.5 text-right font-medium">Rev</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.user_id}
                  className={`border-t border-border ${
                    r.status === "missing" ? "bg-status-absent/5" : ""
                  }`}
                >
                  <th scope="row" className="px-3 py-2.5 text-left font-normal">
                    {r.full_name}
                    {r.role === "admin" && (
                      <span className="ml-1.5 text-[10px] uppercase text-muted-foreground">
                        admin
                      </span>
                    )}
                  </th>
                  <td className="px-2 py-2.5"><StatusBadge row={r} /></td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{r.dials ?? "—"}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{r.talked_to ?? "—"}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{r.appointments_opening ?? "—"}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{r.appointments_closing ?? "—"}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{r.appointments_follow_up ?? "—"}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{r.appointments_nomination ?? "—"}</td>
                  <td className="px-2 py-2.5">
                    {r.campaign_status
                      ? CAMPAIGN_STATUS_LABELS[r.campaign_status]
                      : "—"}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{r.signed_cases ?? "—"}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">
                    {r.active_gr === null ? "—" : formatCurrency(Number(r.active_gr))}
                  </td>
                  <td className="px-2 py-2.5 text-center"><OfficeDot inOffice={r.in_office} /></td>
                  <td className="px-2 py-2.5 text-xs text-muted-foreground">
                    {r.first_submitted_at ? formatSgTime(r.first_submitted_at) : "—"}
                  </td>
                  <td className="px-2 py-2.5 text-xs text-muted-foreground">
                    {r.last_submitted_at ? formatSgTime(r.last_submitted_at) : "—"}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums">
                    {r.revision_count ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Mobile cards */}
      <div className="space-y-2 md:hidden">
        {rows.map((r) => (
          <Card
            key={r.user_id}
            className={r.status === "missing" ? "border-status-absent/40" : ""}
          >
            <CardContent className="space-y-2 p-3.5">
              <div className="flex items-center gap-2">
                <OfficeDot inOffice={r.in_office} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {r.full_name}
                </span>
                <StatusBadge row={r} />
              </div>

              {r.status === "missing" ? (
                <p className="text-xs text-muted-foreground">
                  Nothing submitted for {businessDate}.
                </p>
              ) : (
                <>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    D {r.dials} · TT {r.talked_to} · AO{" "}
                    {r.appointments_opening} · AC {r.appointments_closing} · FU{" "}
                    {r.appointments_follow_up} · N {r.appointments_nomination}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.campaign_status
                      ? CAMPAIGN_STATUS_LABELS[r.campaign_status]
                      : "—"}
                    {" · "}
                    {n(r.signed_cases)} case
                    {n(r.signed_cases) === 1 ? "" : "s"}{" "}
                    {formatCurrency(n(r.active_gr))}
                    {r.first_submitted_at &&
                      ` · ${formatSgTime(r.first_submitted_at)}`}
                    {n(r.revision_count) > 0 &&
                      ` · ${r.revision_count} rev`}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {rows.length === 0 && (
        <Card>
          <CardContent className="pt-5 text-center text-sm text-muted-foreground">
            Nobody matches that search.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
