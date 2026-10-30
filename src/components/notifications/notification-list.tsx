import { PartyPopper, Flame, Trophy, Bell as BellIcon } from "lucide-react";
import { formatSgTime, formatSgDate, sgToday } from "@/lib/sg-date";
import type { FeedItem } from "@/lib/notification-feed";

/**
 * The notification centre's list.
 *
 * Personal notifications and the team's wins, woven together newest first.
 * They are visually distinguished but not separated into tabs: the point of a
 * centre is one place to glance at, and with fifteen people there is not
 * enough volume to need sorting.
 */

function iconFor(item: FeedItem) {
  if (item.source === "team") return PartyPopper;
  if (item.kind.startsWith("streak")) return Flame;
  if (item.kind.startsWith("milestone")) return Trophy;
  return BellIcon;
}

/** "2:14 PM" for today, "3 Mar, 2:14 PM" for anything older. */
function when(iso: string): string {
  const date = iso.slice(0, 10);
  const time = formatSgTime(iso);
  return date === sgToday() ? time : `${formatSgDate(date)} · ${time}`;
}

export function NotificationList({ items }: { items: FeedItem[] }) {
  if (items.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Nothing yet. Your achievements and the team&rsquo;s wins will appear
        here.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {items.map((item) => {
        const Icon = iconFor(item);

        return (
          <li
            key={`${item.source}-${item.id}`}
            className="flex items-start gap-3 py-3"
          >
            <span
              aria-hidden="true"
              className={
                item.source === "team"
                  ? "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-status-present/12 text-status-present"
                  : "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground"
              }
            >
              <Icon className="size-4" />
            </span>

            <div className="min-w-0 flex-1">
              <p
                className={
                  // Unread is weighted rather than coloured: a list where half
                  // the rows are tinted reads as a list of problems.
                  item.read
                    ? "text-sm text-foreground"
                    : "text-sm font-semibold text-foreground"
                }
              >
                {item.title}
              </p>
              {item.body && (
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {item.body}
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {when(item.created_at)}
              </p>
            </div>

            {!item.read && (
              <span
                className="mt-2 size-2 shrink-0 rounded-full bg-primary"
                aria-label="Unread"
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
