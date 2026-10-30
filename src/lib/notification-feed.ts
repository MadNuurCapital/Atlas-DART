import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * One entry in the notification centre.
 *
 * `source` says where it came from, and the two differ in a way that matters:
 * a `personal` row is addressed to you and has a read state, a `team` row is
 * the same row everyone else is reading and is always marked read. The bell's
 * badge counts only the former.
 */
export type FeedItem = {
  id: string;
  source: "personal" | "team";
  kind: string;
  title: string;
  body: string | null;
  url: string | null;
  read: boolean;
  created_at: string;
};

export type NotificationFeed = {
  items: FeedItem[];
  unread: number;
};

/**
 * The notification centre's contents, in one round trip.
 *
 * Both streams and the unread count come back together - see
 * 0027_notification_feed.sql. Asking separately would reopen the problem that
 * 0023-0025 closed, and this one runs in the app shell on every page.
 *
 * Never throws. A notification centre that cannot load is a disappointment; a
 * notification centre that takes the whole app down with it is a fault. The
 * bell simply shows no badge, and the page says there is nothing yet.
 */
export async function fetchNotificationFeed(
  limit = 50,
): Promise<NotificationFeed> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("notification_feed", {
    p_limit: limit,
  });

  if (error || !data) {
    console.error("[notifications] feed failed: %s", error?.message);
    return { items: [], unread: 0 };
  }

  return {
    items: data.items ?? [],
    // Postgres count() is a bigint, which PostgREST renders as a string to
    // avoid losing precision on numbers no notification centre will ever see.
    unread: Number(data.unread ?? 0),
  };
}
