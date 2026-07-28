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
 * The nagging push notification.
 *
 * Runs every hour from 09:00 to 15:00 UTC, which is 17:00 to 23:00 Singapore.
 * Anyone who has not submitted gets a notification every one of those hours;
 * the moment they submit, they drop off the list and it stops. That is the
 * whole mechanism - there is no snooze, because the only way to stop it is the
 * thing we want them to do.
 *
 * Each hour writes its own reminder_logs row (push_17, push_18, ...) so the
 * unique key still makes a Netlify retry idempotent within that hour, without
 * one hour's row blocking the next.
 */

type Level = "gentle" | "firm" | "urgent" | "final";

function levelForHour(sgHour: number): Level {
  if (sgHour < 19) return "firm";
  if (sgHour < 22) return "urgent";
  return "final";
}

function copyFor(level: Level, firstName: string, hour: number) {
  const remaining = 24 - hour;

  switch (level) {
    case "final":
      return {
        title: `Last call, ${firstName}`,
        body: "DART closes at 11:59 PM. Submit now or today counts as missed.",
        requireInteraction: true,
      };
    case "urgent":
      return {
        title: `${firstName}, your DART is still missing`,
        body: `${remaining} hour${remaining === 1 ? "" : "s"} left. It takes two minutes.`,
        requireInteraction: true,
      };
    default:
      return {
        title: `Today's DART is not in yet, ${firstName}`,
        body: "Submit it before you get pulled into something else.",
        requireInteraction: false,
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

export default async function handler(request: Request) {
  const url = new URL(request.url);
  const scheduled = url.searchParams.get("scheduled") !== null;

  if (!scheduled && !authoriseManualRun(request)) {
    return new Response("Unauthorised", { status: 401 });
  }

  const businessDate = url.searchParams.get("date") ?? sgToday();
  const dryRun = url.searchParams.get("dryRun") === "true";
  const hour = Number(url.searchParams.get("hour") ?? sgHourNow());
  const level = levelForHour(hour);
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
      return Response.json({ businessDate, hour, missing: 0, sent: 0 });
    }

    // One query for every live subscription belonging to anyone missing,
    // rather than a query per person.
    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in(
        "user_id",
        missing.map((m) => m.user_id),
      )
      .lt("failure_count", 5);

    const byUser = new Map<string, typeof subs>();
    for (const sub of subs ?? []) {
      const list = byUser.get(sub.user_id) ?? [];
      list.push(sub);
      byUser.set(sub.user_id, list as typeof subs);
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

      // Already nagged this person in this hour? A Netlify retry must not
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
      const message = copyFor(level, firstName, hour);
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
              url: appUrl ? `${appUrl}/today` : "/today",
            }),
            { TTL: 3600 },
          );
          deliveredToAny = true;
          sent += 1;
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          lastError =
            error instanceof Error ? error.message : String(error);

          if (status === 404 || status === 410) {
            // The browser threw this subscription away. It will never work
            // again, so delete it rather than retrying every hour forever.
            await supabase
              .from("push_subscriptions")
              .delete()
              .eq("id", device.id);
            removed += 1;
          } else {
            await supabase
              .from("push_subscriptions")
              .update({ failure_count: 1 })
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
  // Hourly from 09:00 to 15:00 UTC = 17:00 to 23:00 Asia/Singapore.
  schedule: "0 9-15 * * *",
};
