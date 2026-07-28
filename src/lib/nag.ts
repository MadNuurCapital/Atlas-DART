import { SG_TIME_ZONE } from "@/lib/sg-date";

/**
 * How hard to nag someone who has not submitted yet.
 *
 * The escalation is by Singapore hour, so it reads the same to everyone
 * regardless of where their phone thinks it is. Nothing before 09:00 - being
 * chased for today's numbers at breakfast is how people learn to ignore the
 * thing entirely.
 */

export type NagLevel = "none" | "gentle" | "firm" | "urgent" | "final";

export function sgHour(now: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: SG_TIME_ZONE,
      hour: "2-digit",
      hour12: false,
    }).format(now),
  );
}

export function nagLevel(
  submitted: boolean,
  now: Date = new Date(),
): NagLevel {
  if (submitted) return "none";

  const hour = sgHour(now);
  if (hour < 9) return "none";
  if (hour < 15) return "gentle";
  if (hour < 19) return "firm";
  if (hour < 22) return "urgent";
  return "final";
}

export type NagCopy = {
  title: string;
  body: string;
  /** Push notifications only: keep the banner on screen until dismissed. */
  insistent: boolean;
};

export function nagCopy(level: NagLevel, firstName?: string): NagCopy | null {
  const name = firstName ? `, ${firstName}` : "";

  switch (level) {
    case "gentle":
      return {
        title: `Today's DART is not in yet${name}`,
        body: "It takes about two minutes. Closes at 11:59 PM.",
        insistent: false,
      };
    case "firm":
      return {
        title: `Still waiting on today's DART${name}`,
        body: "Submit before you get pulled into something else.",
        insistent: false,
      };
    case "urgent":
      return {
        title: `Your DART is still missing${name}`,
        body: "Closes at 11:59 PM tonight. Two minutes and it is done.",
        insistent: true,
      };
    case "final":
      return {
        title: `Last call — DART closes at 11:59 PM${name}`,
        body: "Submit now or today counts as missed.",
        insistent: true,
      };
    case "none":
      return null;
  }
}

/**
 * Minutes left before tonight's 23:59 Singapore deadline.
 *
 * Never negative, and that is not an oversight: the deadline is the last
 * minute of the day, so the moment it passes it is already a new Singapore day
 * with a fresh deadline nearly 24 hours out. There is no window in which
 * "today" is closed but still today.
 */
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

/** "3 hours left" / "45 minutes left". */
export function timeLeftLabel(now: Date = new Date()): string {
  const minutes = minutesToDeadline(now);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} left`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} left`;
}
