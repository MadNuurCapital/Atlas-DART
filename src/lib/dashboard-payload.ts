import type {
  CaseMixByCategory,
  DailyConsultantSummary,
  PendingInception,
  TargetShortfall,
} from "@/types/database";
import type { CoachingWithNames } from "@/lib/coaching";

/**
 * Derived from daily_submissions on every read, never stored - see
 * 0031_streaks.sql for why a stored counter would drift.
 */
export type Streaks = {
  current: number;
  longest: number;
  submitted_today: boolean;
  total_days: number;
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
  streaks: Streaks;
};
