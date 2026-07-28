import type { Config } from "@netlify/functions";
import webpush from "web-push";
import {
  adminClient,
  authoriseManualRun,
  findMissing,
  sgToday,
  requireEnv,
} from "./lib/reminders.mts";

/**
 * The hourly chase.
 *
 * Runs every hour from 11:00 to 22:00 UTC, which is 19:00 through 06:00 in
 * Singapore - a contiguous UTC range even though it crosses Singapore midnight.
 *
 *   7pm - 11pm SGT   with sound. The deadline has not passed, so these are the
 *                    ones that actually prevent a missed day.
 *   midnight - 6am   SILENT, and about YESTERDAY. The day is already late
 *                    whatever anyone does, so the notification waits on the
 *                    lock screen rather than waking the whole team at 3am.
 *
 * Submitting removes someone from the list, and the chase stops. That is the
 * only way to stop it, which is the point.
 */

const NAG_END_HOUR = 7;

type Level = "firm" | "urgent" | "final" | "overdue";

function levelForHour(hour: number): Level {
  if (hour < NAG_END_HOUR) return "overdue";
  if (hour < 21) return "firm";
  if (hour < 23) return "urgent";
  return "final";
}

function copyFor(level: Level, firstName: string) {
  switch (level) {
    case "overdue":
      return {
        title: `Yesterday's DART is still missing, ${firstName}`,
        body: "It is already late. Submit it before your admin gets the 6 AM list.",
        requireInteraction: true,
        silent: true,
      };
    case "final":
      return {
        title: `Last call, ${firstName} — DART closes at 11:59 PM`,
        body: "Submit now or today counts as missed.",
        requireInteraction: true,
        silent: false,
      };
    case "urgent":
      return {
        title: `Your DART is not updated, ${firstName}`,
        body: "Closes at 11:59 PM tonight. Submit before you forget.",
        requireInteraction: true,
        silent: false,
      };
    default:
      return {
        title: `Your DART is not updated, ${firstName}`,
        body: "Closes at 11:59 PM. It takes about two minutes.",
        requireInteraction: false,
        silent: false,
      };
  }
}

function sgHourNow(now: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Singapore",
      hour: "2-digit",
      hour12: false,
    }).format(now),
  );
}

/** Yesterday, in the Singapore calendar. */
function previousDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d - 1, 12));
  return shifted.toISOString().slice(0, 10);
}

export default async function handler(request: Request) {
  const url = new URL(request.url);
  const scheduled = url.searchParams.get("scheduled") !== null;

  if (!scheduled && !authoriseManualRun(request)) {
    return new Response("Unauthorised", { status: 401 });
  }

  const hour = Number(url.searchParams.get("hour") ?? sgHourNow());
  const level = levelForHour(hour);

  // Overnight the day being chased is yesterday. Today has barely started.
  const businessDate =
    url.searchParams.get("date") ??
    (hour < NAG_END_HOUR ? previousDay(sgToday()) : sgToday());

  const dryRun = url.searchParams.get("dryRun") === "true";
  const reminderType = `push_${hour}`;

  console.log(
    "[push-reminders] start date=%s hour=%d level=%s dryRun=%s",
    businessDate,
    hour,
    level,
    dryRun,
  );

  try {
    const publicKey = requireEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
    const privateKey = requireEnv("VAPID_PRIVATE_KEY");
    const appUrl = process.env.APP_URL ?? "";

    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? "mailto:admin@example.com",
      publicKey,
      privateKey,
    );

    const supabase = adminClient();
    const missing = await findMissing(supabase, businessDate);

    if (missing.length === 0) {
      console.log("[push-reminders] nobody missing - nothing to do");
      return Response.json({ businessDate, hour, level, missing: 0, sent: 0 });
    }

    // One query for every live subscription belonging to anyone missing,
    // rather than a query per person.
    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth, failure_count")
      .in(
        "user_id",
        missing.map((m) => m.user_id),
      )
      .lt("failure_count", 5);

    const byUser = new Map<string, NonNullable<typeof subs>>();
    for (const sub of subs ?? []) {
      const list = byUser.get(sub.user_id) ?? [];
      list.push(sub);
      byUser.set(sub.user_id, list);
    }

    let sent = 0;
    let failed = 0;
    let removed = 0;
    let skipped = 0;

    for (const person of missing) {
      const devices = byUser.get(person.user_id) ?? [];
      if (devices.length === 0) {
        skipped += 1;
        continue;
      }

      // Already chased this person in this hour? A Netlify retry must not
      // buzz the same phone twice.
      const { data: already } = await supabase
        .from("reminder_logs")
        .select("id")
        .eq("user_id", person.user_id)
        .eq("business_date", businessDate)
        .eq("reminder_type", reminderType)
        .maybeSingle();

      if (already || dryRun) {
        skipped += 1;
        continue;
      }

      const firstName = person.full_name.split(" ")[0] ?? person.full_name;
      const message = copyFor(level, firstName);
      let deliveredToAny = false;
      let lastError: string | undefined;

      for (const device of devices) {
        try {
          await webpush.sendNotification(
            {
              endpoint: device.endpoint,
              keys: { p256dh: device.p256dh, auth: device.auth },
            },
            JSON.stringify({
              ...message,
              tag: "dart-daily-reminder",
              url: appUrl
                ? `${appUrl}/today?date=${businessDate}`
                : `/today?date=${businessDate}`,
            }),
            { TTL: 3600 },
          );
          deliveredToAny = true;
          sent += 1;

          // Clear any accumulated failures. Without this a device that had a
          // few transient errors over previous days would eventually cross the
          // threshold and go silent despite working perfectly.
          if (device.failure_count > 0) {
            await supabase
              .from("push_subscriptions")
              .update({ failure_count: 0, last_used_at: new Date().toISOString() })
              .eq("id", device.id);
          } else {
            await supabase
              .from("push_subscriptions")
              .update({ last_used_at: new Date().toISOString() })
              .eq("id", device.id);
          }
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          lastError = error instanceof Error ? error.message : String(error);

          if (status === 404 || status === 410) {
            // The browser threw this subscription away. It will never work
            // again, so delete it rather than retrying every hour forever.
            await supabase
              .from("push_subscriptions")
              .delete()
              .eq("id", device.id);
            removed += 1;
          } else {
            // INCREMENT, not set. Setting it to 1 each time meant it never
            // reached the threshold, so a permanently broken endpoint was
            // retried every hour forever and the give-up logic never ran.
            await supabase
              .from("push_subscriptions")
              .update({ failure_count: device.failure_count + 1 })
              .eq("id", device.id);
            failed += 1;
          }
        }
      }

      await supabase.from("reminder_logs").upsert(
        {
          user_id: person.user_id,
          business_date: businessDate,
          reminder_type: reminderType,
          status: deliveredToAny ? "sent" : "failed",
          error_message: deliveredToAny
            ? null
            : (lastError ?? "no device accepted the notification"),
          sent_at: new Date().toISOString(),
        },
        { onConflict: "user_id,business_date,reminder_type" },
      );
    }

    const summary = {
      businessDate,
      hour,
      level,
      silent: level === "overdue",
      dryRun,
      missing: missing.length,
      sent,
      failed,
      removed,
      skipped,
      withoutDevices: missing.filter((m) => !byUser.has(m.user_id)).length,
    };

    console.log("[push-reminders] done %o", summary);
    return Response.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[push-reminders] fatal: %s", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

export const config: Config = {
  // Hourly 11:00-22:00 UTC = 19:00-06:00 Asia/Singapore. Contiguous in UTC
  // even though it crosses Singapore midnight.
  schedule: "0 11-22 * * *",
};
