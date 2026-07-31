/**
 * Singapore business-date helpers.
 *
 * Every compliance decision in this application - which day a submission
 * belongs to, whether it was on time, whether it is still inside the edit
 * window - is made in `Asia/Singapore`, never in the browser's timezone.
 *
 * Singapore has had no daylight saving since 1935, but nothing here assumes
 * that: the UTC offset is always read from the IANA database via `Intl` for
 * the specific instant in question. If the offset ever changed, this module
 * would keep working.
 */

export const SG_TIME_ZONE = "Asia/Singapore";

/** A calendar date in `YYYY-MM-DD` form, as stored in Postgres `date` columns. */
export type BusinessDate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Milliseconds that `timeZone` is ahead of UTC at the given instant.
 * Positive for Singapore (+8h = 28_800_000).
 */
function tzOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts: Record<string, number> = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }

  // `hour` comes back as 24 for midnight under hour12:false in some engines.
  const wallClockAsUtc = Date.UTC(
    parts.year ?? 0,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    (parts.hour ?? 0) % 24,
    parts.minute ?? 0,
    parts.second ?? 0,
  );

  // formatToParts has no millisecond field, so wallClockAsUtc is truncated to
  // the whole second. Compare against a likewise-truncated instant, otherwise
  // the offset comes out short by the instant's own milliseconds - which is
  // exactly the case for a 23:59:59.999 deadline.
  const instantAtSecond = instant.getTime() - instant.getUTCMilliseconds();

  return wallClockAsUtc - instantAtSecond;
}

/**
 * Convert a Singapore wall-clock time into the UTC instant it refers to.
 *
 * Done in two passes: guess using the offset at the naive instant, then
 * re-read the offset at the corrected instant. One refinement is enough for
 * any real timezone and makes this correct even across an offset change.
 */
function sgWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const firstPass = naive - tzOffsetMs(new Date(naive), SG_TIME_ZONE);
  const refined = naive - tzOffsetMs(new Date(firstPass), SG_TIME_ZONE);
  return new Date(refined);
}

/** Split a `YYYY-MM-DD` string into numeric parts, rejecting anything malformed. */
export function parseBusinessDate(date: BusinessDate): {
  year: number;
  month: number;
  day: number;
} {
  if (!ISO_DATE.test(date)) {
    throw new Error(`Invalid business date "${date}" - expected YYYY-MM-DD`);
  }
  const [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return { year, month, day };
}

/** The Singapore calendar date at a given instant (defaults to now). */
export function toSgDateString(instant: Date = new Date()): BusinessDate {
  // en-CA formats as YYYY-MM-DD, which is exactly the Postgres `date` literal.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SG_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Today's Singapore business date. This is the app's notion of "today". */
export function sgToday(now: Date = new Date()): BusinessDate {
  return toSgDateString(now);
}

/**
 * The submission deadline for a business date: 23:59:59.999 Singapore time.
 * Returned as a UTC instant so it can be compared directly to a timestamptz.
 */
export function sgDeadline(date: BusinessDate): Date {
  const { year, month, day } = parseBusinessDate(date);
  return sgWallClockToUtc(year, month, day, 23, 59, 59, 999);
}

/**
 * Whether a submission counts as on time.
 *
 * Judged on FIRST submission only, which is what makes a later correction to
 * an originally on-time record stay on time.
 */
export function isOnTime(
  firstSubmittedAt: Date | string | null | undefined,
  businessDate: BusinessDate,
): boolean {
  if (!firstSubmittedAt) return false;
  const at =
    firstSubmittedAt instanceof Date
      ? firstSubmittedAt
      : new Date(firstSubmittedAt);
  return at.getTime() <= sgDeadline(businessDate).getTime();
}

/** Shift a business date by whole days, staying in the Singapore calendar. */
export function addDays(date: BusinessDate, days: number): BusinessDate {
  const { year, month, day } = parseBusinessDate(date);
  // Midday avoids any offset-change edge case pushing us onto the wrong day.
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12));
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(shifted);
}

/** Whole days between two business dates (`to - from`). */
export function daysBetween(from: BusinessDate, to: BusinessDate): number {
  const a = parseBusinessDate(from);
  const b = parseBusinessDate(to);
  const aUtc = Date.UTC(a.year, a.month - 1, a.day);
  const bUtc = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((bUtc - aUtc) / 86_400_000);
}

/**
 * How many days back a consultant may still edit their own submission.
 * Decision D2 - admins are not subject to this and their overrides are audited.
 */
export const EDIT_WINDOW_DAYS = 7;

/**
 * Whether a consultant may still write to this business date.
 * Future dates are never editable; there is no submitting tomorrow's numbers.
 */
export function isWithinEditWindow(
  businessDate: BusinessDate,
  today: BusinessDate = sgToday(),
  windowDays: number = EDIT_WINDOW_DAYS,
): boolean {
  const age = daysBetween(businessDate, today);
  return age >= 0 && age <= windowDays;
}

/** Number of days in a given month. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Required days for the Submission Compliance report (decision D7).
 *
 * A finished month requires all of its days. The current month requires only
 * the days elapsed so far including today, so someone who has submitted every
 * day reads 100% on the 12th rather than 40%.
 */
export function requiredDaysInMonth(
  year: number,
  month: number,
  today: BusinessDate = sgToday(),
): number {
  const t = parseBusinessDate(today);
  if (year > t.year || (year === t.year && month > t.month)) return 0;
  if (year === t.year && month === t.month) return t.day;
  return daysInMonth(year, month);
}

/** Every business date in a month, capped at today for the current month. */
export function businessDatesInMonth(
  year: number,
  month: number,
  today: BusinessDate = sgToday(),
): BusinessDate[] {
  const count = requiredDaysInMonth(year, month, today);
  const mm = String(month).padStart(2, "0");
  return Array.from(
    { length: count },
    (_, i) => `${year}-${mm}-${String(i + 1).padStart(2, "0")}`,
  );
}

/** First and last calendar date of a month, as business dates. */
export function monthBounds(
  year: number,
  month: number,
): { start: BusinessDate; end: BusinessDate } {
  const mm = String(month).padStart(2, "0");
  return {
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${String(daysInMonth(year, month)).padStart(2, "0")}`,
  };
}

/** Human-readable Singapore date, e.g. "Tue, 28 Jul 2026". */
export function formatSgDate(date: BusinessDate | Date): string {
  const instant =
    date instanceof Date ? date : sgWallClockToUtc(...dateTuple(date), 12);
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: SG_TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(instant);
}

/** Human-readable Singapore date and time, e.g. "28 Jul 2026, 9:04 pm". */
export function formatSgDateTime(instant: Date | string): string {
  const at = instant instanceof Date ? instant : new Date(instant);
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: SG_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(at);
}

/** Singapore time only, e.g. "9:04 pm". */
export function formatSgTime(instant: Date | string): string {
  const at = instant instanceof Date ? instant : new Date(instant);
  return new Intl.DateTimeFormat("en-SG", {
    timeZone: SG_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(at);
}

function dateTuple(date: BusinessDate): [number, number, number] {
  const { year, month, day } = parseBusinessDate(date);
  return [year, month, day];
}

/**
 * Turn a date and a time as typed on a phone into an instant.
 *
 * The two halves come from a date input and a time input, neither of which
 * carries a timezone. Interpreting them in Singapore is what makes "2:00 PM"
 * mean two in the afternoon there rather than two in the afternoon wherever
 * the server happens to be running - which, on Netlify, is not Singapore.
 *
 * Goes through sgWallClockToUtc rather than appending a literal "+08:00",
 * because the offset is read from the timezone database for that specific
 * instant. Singapore has not moved its clocks since 1982 and probably never
 * will, but a hardcoded offset is exactly the assumption this module was
 * written to avoid.
 *
 * Returns null rather than an Invalid Date, so a caller cannot store one.
 */
export function sgDateTimeToInstant(
  date: BusinessDate,
  time: string,
): Date | null {
  if (!ISO_DATE.test(date)) return null;

  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;

  const { year, month, day } = parseBusinessDate(date);
  const at = sgWallClockToUtc(year, month, day, hour, minute);
  if (Number.isNaN(at.getTime())) return null;

  // Date arithmetic rolls over rather than complaining: month 13 quietly
  // becomes January of the next year, and 31 February becomes 3 March. A
  // malformed date silently turning into a valid but different one is worse
  // than a rejection, so confirm the instant really lands on the date asked
  // for. This catches every impossible date without enumerating any of them.
  return toSgDateString(at) === date ? at : null;
}

/**
 * How far away a moment is, in plain words: "Tomorrow at 2:00 pm".
 *
 * Compared by Singapore CALENDAR DAY rather than by elapsed hours, because
 * "tomorrow" is about the date on the wall, not about being within 24 hours -
 * a session at 9am tomorrow is tomorrow even when it is 11pm tonight.
 */
export function describeWhen(
  instant: Date | string,
  now: Date = new Date(),
): string {
  const at = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(at.getTime())) return "";

  const time = formatSgTime(at);
  const days = daysBetween(toSgDateString(now), toSgDateString(at));

  if (days === 0) return `Today at ${time}`;
  if (days === 1) return `Tomorrow at ${time}`;
  if (days === -1) return `Yesterday at ${time}`;
  if (days > 1 && days < 7) {
    const weekday = new Intl.DateTimeFormat("en-SG", {
      timeZone: SG_TIME_ZONE,
      weekday: "long",
    }).format(at);
    return `${weekday} at ${time}`;
  }
  return `${formatSgDate(toSgDateString(at))} at ${time}`;
}
