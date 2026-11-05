import type {
  CaseMixByCategory,
  DailyConsultantSummary,
  PendingInception,
  TargetShortfall,
} from "@/types/database";
import type { CoachingWithNames } from "@/lib/coaching";
import type { LeaveReason } from "@/lib/constants";

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
  /**
   * Closed days since the last submission that the person was actually
   * expected to submit on - away days are subtracted, not merely hidden. A
   * week's holiday therefore leaves this at 0 rather than at 7.
   */
  missed: number;
  /**
   * How many of the days in that gap were declared leave. Returned so the
   * dashboard can tell "nothing to say" apart from "forgiven", rather than
   * showing a suspiciously small number with no explanation.
   */
  away_days: number;
  submitted_today: boolean;
  /** Away right now. Negative notices stay quiet during leave. */
  away_now: boolean;
};

/**
 * The active or next upcoming leave period, for the dashboard card.
 *
 * Null when there is neither. Past periods are not included: the card is a
 * summary with a link, and history belongs on /leave.
 */
export type DashboardLeave = {
  id: string;
  starts_on: string;
  ends_on: string;
  reason: LeaveReason;
  /** True when it covers today, which is the difference between "Away Mode
   *  is on" and "Leave coming up". */
  active: boolean;
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
  leave: DashboardLeave | null;
};
