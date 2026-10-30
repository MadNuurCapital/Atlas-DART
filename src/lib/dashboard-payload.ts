import type {
  CaseMixByCategory,
  DailyConsultantSummary,
  PendingInception,
  TargetShortfall,
} from "@/types/database";
import type { CoachingWithNames } from "@/lib/coaching";

/**
 * Cases written this month, with the same slice of earlier months to compare
 * against. Derived on every read - see 0031_month_cases.sql for why a stored
 * counter would drift, and why the comparison is made at the same point in the
 * month rather than against a finished total.
 */
export type MonthCases = {
  this_month: number;
  /** The figure to beat, counted only to today's day number in earlier months. */
  best_start: number;
  best_total: number;
  last_month: number;
  is_best_start: boolean;
  month_label: string;
};

/**
 * How long somebody has gone without submitting. Counted over CLOSED days
 * only, so today is never held against anybody until it is over.
 */
export type MissedDays = {
  ever_submitted: boolean;
  last_submitted: string | null;
  missed: number;
  submitted_today: boolean;
};

/**
 * What `dashboard_payload()` returns.
 *
 * The function (supabase/migrations/0023_dashboard_payload.sql) answers in one
 * round trip what the dashboard used to ask in five, because the app runs in
 * the US and the database is in Singapore and each question cost about 330ms
 * of pure distance.
 *
 * The member types are the SAME ones the individual queries returned, which is
 * the point: the page's rendering code did not have to change, and a type
 * error here would mean the SQL and the page had drifted apart.
 *
 * Arrays are never null - the function coalesces each to '[]' - so the page can
 * map over them without guarding. `target` and `pending` are genuinely
 * nullable: no target set, and no cases awaiting inception, are both ordinary
 * states that render as "No target set" and as nothing at all.
 */
export type DashboardPayload = {
  days: DailyConsultantSummary[];
  target: TargetShortfall | null;
  pending: PendingInception | null;
  mix: CaseMixByCategory[];
  coaching: CoachingWithNames[];
  cases_month: MonthCases;
  missed: MissedDays;
};
