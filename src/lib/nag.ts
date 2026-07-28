import { SG_TIME_ZONE, sgToday, addDays, type BusinessDate } from "@/lib/sg-date";

/**
 * How hard to nag someone who has not submitted.
 *
 * The whole schedule is in Singapore hours, so it reads the same to everyone
 * regardless of where their phone thinks it is.
 *
 *   before 7pm   nothing. Chasing people mid-afternoon is how they learn to
 *                ignore it, and the dashboard already says the day is open.
 *   7pm - 11pm   hourly, with sound. These are the ones that actually prevent
 *                a missed day, because the deadline has not passed yet.
 *   midnight-6am hourly but SILENT. The day is already late whatever they do,
 *                so it waits on the lock screen rather than waking anyone.
 *   6am          admins get the list of who missed.
 */

export type NagLevel = "none" | "firm" | "urgent" | "final" | "overdue";

export function sgHour(now: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: SG_TIME_ZONE,
      hour: "2-digit",
      hour12: false,
    }).format(now),
  );
}

/** The first Singapore hour at which anyone is chased. */
export const NAG_START_HOUR = 19;

/** After this hour the overnight chase stops and admins are told instead. */
export const NAG_END_HOUR = 7;

/**
 * Which business date the nag is about.
 *
 * Between midnight and 6am the day being chased is YESTERDAY - today has
 * barely started and nobody owes anything for it yet.
 */
export function nagBusinessDate(now: Date = new Date()): BusinessDate {
  const today = sgToday(now);
  return sgHour(now) < NAG_END_HOUR ? addDays(today, -1) : today;
}

/** Are we past the deadline for the day being chased? */
export function isOverdue(now: Date = new Date()): boolean {
  return sgHour(now) < NAG_END_HOUR;
}

export function nagLevel(submitted: boolean, now: Date = new Date()): NagLevel {
  if (submitted) return "none";

  const hour = sgHour(now);

  // Overnight: yesterday is late, and saying so is the point.
  if (hour < NAG_END_HOUR) return "overdue";

  if (hour < NAG_START_HOUR) return "none";
  if (hour < 21) return "firm";
  if (hour < 23) return "urgent";
  return "final";
}

export type NagCopy = {
  title: string;
  body: string;
  /** Keep the notification on screen until dismissed. */
  insistent: boolean;
  /** No sound or vibration - used overnight. */
  silent: boolean;
};

export function nagCopy(level: NagLevel, firstName?: string): NagCopy | null {
  const name = firstName ? `, ${firstName}` : "";

  switch (level) {
    case "firm":
      return {
        title: `Your DART is not updated${name}`,
        body: "Closes at 11:59 PM. It takes about two minutes.",
        insistent: false,
        silent: false,
      };
    case "urgent":
      return {
        title: `Your DART is not updated${name}`,
        body: "Closes at 11:59 PM tonight. Submit before you forget.",
        insistent: true,
        silent: false,
      };
    case "final":
      return {
        title: `Last call${name} — DART closes at 11:59 PM`,
        body: "Submit now or today counts as missed.",
        insistent: true,
        silent: false,
      };
    case "overdue":
      return {
        title: `Yesterday's DART is still missing${name}`,
        body: "It is already late, but submit it before your admin gets the 6 AM list.",
        insistent: true,
        silent: true,
      };
    case "none":
      return null;
  }
}

/** Minutes left before tonight's 23:59 Singapore deadline. */
export function minutesToDeadline(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SG_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);

  return 23 * 60 + 59 - (hour * 60 + minute);
}

/** "3 hours left" / "45 minutes left" / "Deadline passed" once overdue. */
export function timeLeftLabel(now: Date = new Date()): string {
  if (isOverdue(now)) return "Deadline passed";

  const minutes = minutesToDeadline(now);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} left`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} left`;
}
