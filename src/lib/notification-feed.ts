import "server-only";

import { createClient } from "@/lib/supabase/server";

/** Something addressed to you. Has a read state; counts toward the badge. */
export type PersonalNotification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  url: string | null;
  read: boolean;
  created_at: string;
};

/**
 * A colleague's day, not a single case.
 *
 * The feed groups one line per person per Singapore day, because somebody
 * entering a batch produced three identical rows a minute apart, and because
 * "Faisal had a good day" is the truer summary of what happened than three
 * separate events.
 */
export type TeamDay = {
  actor_id: string;
  /** First name only, as everywhere else. */
  name: string;
  /** The Singapore calendar day, as YYYY-MM-DD. */
  sg_day: string;
  cases: number;
  /** The most recent case in the group, for ordering and for "x ago". */
  latest: string;
};

export type NotificationFeed = {
  personal: PersonalNotification[];
  team: TeamDay[];
  /** Total groups available, so the page knows whether to offer more. */
  teamTotal: number;
  unread: number;
};

/**
 * The notification centre, in one round trip.
 *
 * Never throws. A notification centre that cannot load is a disappointment; a
 * notification centre that takes the app's header down with it is a fault -
 * and this runs in the layout, on every page.
 */
export async function fetchNotificationFeed(
  limit = 15,
): Promise<NotificationFeed> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("notification_feed", {
    p_limit: limit,
  });

  if (error || !data) {
    console.error("[notifications] feed failed: %s", error?.message);
    return { personal: [], team: [], teamTotal: 0, unread: 0 };
  }

  return {
    personal: data.personal ?? [],
    team: data.team ?? [],
    // Postgres count() is a bigint, which PostgREST renders as a string to
    // avoid losing precision on numbers no notification centre will ever see.
    teamTotal: Number(data.team_total ?? 0),
    unread: Number(data.unread ?? 0),
  };
}
