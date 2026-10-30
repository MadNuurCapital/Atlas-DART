import Link from "next/link";
import { PartyPopper, Flame, Trophy, Bell as BellIcon } from "lucide-react";
import { formatSgDate, formatSgTime, sgToday, addDays } from "@/lib/sg-date";
import type {
  PersonalNotification,
  TeamDay,
} from "@/lib/notification-feed";

/**
 * The notification centre.
 *
 * Yours first, then the team. Personal notifications would otherwise be one
 * row among forty celebrations, and an achievement nobody sees is not an
 * achievement.
 *
 * The team feed is one line per person per day. Before this it was one row per
 * case, each carrying the same sentence underneath - "Another case submitted
 * for the team" - which is three lines of height to say nothing the title had
 * not already said.
 */

/**
 * Declared at module level rather than picked into a local inside the row.
 * A component created during render is a new component type on every pass,
 * which throws away its state each time.
 */
function KindIcon({ kind }: { kind: string }) {
  if (kind.startsWith("streak")) return <Flame className="size-4" />;
  if (kind.startsWith("milestone") || kind.startsWith("best")) {
    return <Trophy className="size-4" />;
  }
  return <BellIcon className="size-4" />;
}

/** "Today", "Yesterday", or "Fri, 30 Oct". */
function dayLabel(sgDay: string): string {
  const today = sgToday();
  if (sgDay === today) return "Today";
  if (sgDay === addDays(today, -1)) return "Yesterday";
  return formatSgDate(sgDay);
}

function PersonalRow({ item }: { item: PersonalNotification }) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground"
      >
        <KindIcon kind={item.kind} />
      </span>

      <div className="min-w-0 flex-1">
        <p
          className={
            // Unread is weighted rather than coloured: a list where half the
            // rows are tinted reads as a list of problems.
            item.read
              ? "text-sm text-foreground"
              : "text-sm font-semibold text-foreground"
          }
        >
          {item.title}
        </p>
        {item.body && (
          <p className="mt-0.5 text-sm text-muted-foreground">{item.body}</p>
        )}
      </div>

      <span className="shrink-0 pt-0.5 text-xs text-muted-foreground">
        {formatSgTime(item.created_at)}
      </span>
    </li>
  );
}

function TeamRow({ day }: { day: TeamDay }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-status-present/12 text-status-present"
      >
        <PartyPopper className="size-4" />
      </span>

      <p className="min-w-0 flex-1 truncate text-sm text-foreground">
        <span className="font-semibold">{day.name}</span>
        <span className="text-muted-foreground">
          {" · "}
          {day.cases} {day.cases === 1 ? "case" : "cases"}
        </span>
      </p>

      <span className="shrink-0 text-xs text-muted-foreground">
        {formatSgTime(day.latest)}
      </span>
    </li>
  );
}

export function NotificationCentre({
  personal,
  team,
  teamTotal,
  limit,
}: {
  personal: PersonalNotification[];
  team: TeamDay[];
  teamTotal: number;
  limit: number;
}) {
  if (personal.length === 0 && team.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Nothing yet. Your achievements and the team&rsquo;s wins will appear
        here.
      </p>
    );
  }

  // Day headings, so the date stops repeating on every row.
  const byDay: { label: string; rows: TeamDay[] }[] = [];
  for (const row of team) {
    const label = dayLabel(row.sg_day);
    const last = byDay[byDay.length - 1];
    if (last && last.label === label) last.rows.push(row);
    else byDay.push({ label, rows: [row] });
  }

  return (
    <div className="space-y-5">
      {/* Hidden entirely when empty, rather than shown as an empty state. A
          heading over nothing is just something else to scroll past. */}
      {personal.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Yours
          </h3>
          <ul className="divide-y divide-border">
            {personal.map((item) => (
              <PersonalRow key={item.id} item={item} />
            ))}
          </ul>
        </section>
      )}

      {team.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            The team
          </h3>

          {byDay.map((group) => (
            <div key={group.label} className="mt-2 first:mt-0">
              <p className="py-1 text-xs font-medium text-muted-foreground">
                {group.label}
              </p>
              <ul className="divide-y divide-border">
                {group.rows.map((row) => (
                  <TeamRow key={`${row.actor_id}-${row.sg_day}`} day={row} />
                ))}
              </ul>
            </div>
          ))}

          {teamTotal > team.length && (
            <Link
              href={`/notifications?show=${limit + 25}`}
              className="mt-3 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Show more ({teamTotal - team.length} older)
            </Link>
          )}
        </section>
      )}
    </div>
  );
}
