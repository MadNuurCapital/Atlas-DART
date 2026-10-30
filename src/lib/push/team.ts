import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { sendPush, pushConfigured } from "@/lib/push/send";

/**
 * Tell the team, on their phones, that somebody has written business.
 *
 * This is the half the in-app toast cannot do. A toast only exists if Atlas
 * DART happens to be open on your screen at that moment, and most of the time
 * it is not - which is why a real case went out and nobody heard about it.
 *
 * NOT SENT TO THE PERSON WHO SUBMITTED IT, for the same reason the toast
 * skips them: they have just closed a congratulations dialog naming their
 * client, their policy type and what the case did to their month.
 *
 * MUST NEVER FAIL THE CASE. The case is already saved by the time this runs -
 * it is called from `after()`, once the response has been sent - and every
 * failure path here ends in a log line rather than a throw. A celebration
 * nobody receives costs nothing. That lesson cost a morning of lost
 * submissions, so it is enforced here rather than remembered.
 */

/** A device that failed this many times is given up on, as elsewhere. */
const FAILURE_LIMIT = 5;

export async function announceCaseToTeam(opts: {
  actorId: string;
  actorName: string;
}): Promise<void> {
  if (!pushConfigured()) {
    // No VAPID keys. Not an error - the in-app toast still works, and the
    // notification centre still lists it.
    return;
  }

  try {
    const admin = createAdminClient();

    // Everyone else's usable devices. The admin client is needed because a
    // consultant may not read another person's subscriptions - which is
    // correct, and is exactly why this cannot run as the signed-in user.
    const { data: devices, error } = await admin
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .neq("user_id", opts.actorId)
      .lt("failure_count", FAILURE_LIMIT);

    if (error) {
      console.error("[team-push] could not load devices: %s", error.message);
      return;
    }
    if (!devices || devices.length === 0) return;

    const firstName = opts.actorName.split(" ")[0] ?? opts.actorName;

    const results = await Promise.allSettled(
      devices.map((d) =>
        sendPush(
          { endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth },
          {
            title: `🎉 Congratulations ${firstName}!`,
            body: "Another case submitted for the team.",
            // A shared tag means a second win replaces the first in the tray
            // rather than stacking. On a good afternoon this is the
            // difference between encouragement and a wall of notifications.
            tag: "atlas-team-case",
            url: "/notifications",
          },
        ),
      ),
    );

    // Subscriptions the push service says are gone for good. Left in place
    // they would be retried on every case forever.
    const dead: string[] = [];
    let sent = 0;

    results.forEach((result, i) => {
      if (result.status !== "fulfilled") return;
      if (result.value.ok) sent += 1;
      else if (result.value.gone) dead.push(devices[i]!.id);
    });

    if (dead.length > 0) {
      await admin.from("push_subscriptions").delete().in("id", dead);
    }

    console.log(
      "[team-push] case by %s: %d sent, %d devices, %d removed",
      opts.actorId,
      sent,
      devices.length,
      dead.length,
    );
  } catch (err) {
    // Deliberately swallowed. See the note at the top of this file.
    console.error(
      "[team-push] announcement failed: %s",
      err instanceof Error ? err.message : String(err),
    );
  }
}
