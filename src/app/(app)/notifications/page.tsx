import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { EnablePush } from "@/components/notifications/enable-push";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Reminders" };
export const dynamic = "force-dynamic";

const SCHEDULE = [
  ["7:00 PM", "First reminder"],
  ["8:00 – 10:00 PM", "Every hour"],
  ["11:00 PM", "Last call"],
  ["11:59 PM", "Deadline — after this the day counts as late"],
  ["Midnight – 6:00 AM", "Every hour, but silent — it waits on your lock screen"],
  ["6:00 AM", "Your admin gets the list of who missed"],
] as const;

export default async function NotificationsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: devices } = await supabase
    .from("push_subscriptions")
    .select("id, user_agent, created_at")
    .eq("user_id", profile.id);

  const count = devices?.length ?? 0;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Reminders</h1>
        <p className="text-sm text-muted-foreground">
          So you never lose a day to forgetting.
        </p>
      </div>

      <EnablePush
        vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null}
        initiallyEnabled={count > 0}
      />

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
                key={time}
                className="flex items-baseline justify-between gap-3 text-sm"
              >
                <span className="font-medium tabular-nums">{time}</span>
                <span className="text-muted-foreground">{what}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 rounded-md border border-border bg-muted px-3 py-2.5 text-xs text-muted-foreground">
            All of it stops the moment you submit. Nothing fires before 7 PM,
            and nothing makes a sound after midnight. Submitting is the only
            way to make it leave you alone — which is rather the point.
          </p>
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
