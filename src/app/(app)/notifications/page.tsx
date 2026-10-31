import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { EnablePush } from "@/components/notifications/enable-push";
import { NotificationCentre } from "@/components/notifications/notification-centre";
import { MarkAllRead } from "@/components/notifications/mark-all-read";
import { fetchNotificationFeed } from "@/lib/notification-feed";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

/**
 * Four reminders, then one silent one. This list must match the slots in
 * netlify/functions/push-reminders.mts - it is the only place anyone is told
 * what to expect, and a promise of "every hour" that no longer happens is
 * worse than no list at all.
 */
const SCHEDULE = [
  ["7:00 PM", "First reminder"],
  ["9:00 PM", "Second reminder"],
  ["11:00 PM", "Last call"],
  ["11:59 PM", "Final call — after this the day counts as late"],
  ["6:00 AM", "One silent reminder about yesterday, on your lock screen"],
  ["6:00 AM", "Your admin gets the list of who missed"],
] as const;

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const profile = await requireProfile();

  // "Show more" widens the window rather than paginating. With fifteen people
  // the whole history is small; what mattered was not opening the page with
  // all of it.
  const { show } = await searchParams;
  const limit = Math.min(Math.max(Number(show) || 15, 15), 200);
  const supabase = await createClient();

  const { data: devices, error } = await supabase
    .from("push_subscriptions")
    .select("id, user_agent, created_at")
    .eq("user_id", profile.id);

  // Deliberately not unwrap(): a missing table here is a setup step nobody has
  // done yet, not a fault. Throwing would show "something went wrong", which
  // is the least useful thing to tell the one person who can actually fix it.
  const tableMissing =
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    /relation .*push_subscriptions.* does not exist|could not find the table/i.test(
      error?.message ?? "",
    );

  if (error && !tableMissing) {
    console.error("[notifications] could not read devices: %s", error.message);
  }

  const count = devices?.length ?? 0;

  // The centre itself. One round trip, already paid for by the bell in the
  // layout - this asks for the full page of items rather than just the count.
  const feed = await fetchNotificationFeed(limit);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Notifications</h1>
        <p className="text-sm text-muted-foreground">
          Your achievements, and the team&rsquo;s wins.
        </p>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-base">
            Recent
            {feed.unread > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {feed.unread} unread
              </span>
            )}
          </CardTitle>
          {feed.unread > 0 && <MarkAllRead />}
        </CardHeader>
        <CardContent className="pt-0">
          <NotificationCentre
            personal={feed.personal}
            team={feed.team}
            teamTotal={feed.teamTotal}
            limit={limit}
          />
        </CardContent>
      </Card>

      {/* The reminder schedule and devices stay on this page rather than
          moving somewhere else. People now come here to see their wins, and
          the control that turns notifications ON is the thing most of them
          have never found - a bell icon nobody notices was the whole reason
          two advisors went months without a registered device. */}
      <div className="pt-2">
        <h2 className="text-lg font-semibold">Reminders</h2>
        <p className="text-sm text-muted-foreground">
          So you never lose a day to forgetting.
        </p>
      </div>

      {tableMissing ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Reminders are not set up yet
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              The place that stores which devices to notify does not exist in
              the database yet, so notifications cannot be turned on.
            </p>
            <p>
              {profile.role === "admin"
                ? "Run the push_subscriptions setup in the Supabase SQL editor, then come back to this page."
                : "Your administrator needs to finish setting this up. Nothing is wrong with your phone."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <EnablePush
          vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null}
          initiallyEnabled={count > 0}
        />
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            What happens if you have not submitted
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {SCHEDULE.map(([time, what]) => (
              <li
                // Two rows read "6:00 AM" - the silent personal one and the
                // admin list - so the time alone is not a unique key.
                key={`${time} ${what}`}
                className="flex items-baseline justify-between gap-3 text-sm"
              >
                <span className="font-medium tabular-nums">{time}</span>
                <span className="text-muted-foreground">{what}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 rounded-md border border-border bg-muted px-3 py-2.5 text-xs text-muted-foreground">
            All of it stops the moment you submit. Nothing fires before 7 PM,
            nothing fires overnight, and the 6 AM one is silent. Submitting is
            the only way to make it leave you alone — which is rather the point.
          </p>

          {profile.role === "admin" && (
            <p className="mt-2 rounded-md border border-border bg-muted px-3 py-2.5 text-xs text-muted-foreground">
              As an admin you also get the 6 AM notification naming everyone who
              missed the day before — on the same devices as below, so enabling
              notifications here is what makes that arrive. If everyone
              submitted, it comes through silently.
            </p>
          )}
        </CardContent>
      </Card>

      {count > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {count} device{count === 1 ? "" : "s"} subscribed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              {devices?.map((d) => (
                <li key={d.id} className="truncate">
                  {describeDevice(d.user_agent)}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** A user-agent string is unreadable; this is enough to tell devices apart. */
function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent)) return "iPad";
  if (/Android/.test(userAgent)) return "Android phone";
  if (/Macintosh/.test(userAgent)) return "Mac";
  if (/Windows/.test(userAgent)) return "Windows PC";
  return "Other device";
}
