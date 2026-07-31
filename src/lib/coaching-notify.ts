import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { sendPush } from "@/lib/push/send";
import type { CoachingReminderKind } from "@/types/database";

/**
 * Send a coaching notification and record that it went.
 *
 * Uses the service-role client rather than the caller's, for one reason: an
 * admin booking a session needs to read the CONSULTANT'S push subscriptions,
 * and the push_subscriptions policy quite rightly does not let one person read
 * another's devices. This is the same justification the scheduled reminder
 * functions have, and the same care applies - nothing here takes an id from a
 * browser.
 *
 * Recording happens whether or not the send worked. A silent failure is how a
 * reminder system rots without anyone noticing, so a failure is written with
 * its reason and the database refuses a failed row that has none.
 */
export async function notifyCoaching(opts: {
  sessionId: string;
  consultantId: string;
  kind: CoachingReminderKind;
  title: string;
  body: string;
  /**
   * Send again even if this kind has already gone for this session.
   *
   * Rescheduling twice must notify twice - the previous notification was about
   * a time that has since changed again.
   */
  replaceExisting?: boolean;
}): Promise<{ sent: number; failed: number }> {
  const supabase = createAdminClient();

  if (!opts.replaceExisting) {
    const { data: already } = await supabase
      .from("coaching_reminders_sent")
      .select("id")
      .eq("session_id", opts.sessionId)
      .eq("kind", opts.kind)
      .maybeSingle();

    if (already) return { sent: 0, failed: 0 };
  }

  const { data: devices } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", opts.consultantId)
    .lt("failure_count", 5);

  if (!devices || devices.length === 0) {
    // Not a failure. Plenty of people never turn notifications on, and the
    // dashboard card is doing the real work regardless.
    return { sent: 0, failed: 0 };
  }

  const appUrl = (process.env.APP_URL ?? "").trim().replace(/\/+$/, "");

  const results = await Promise.all(
    devices.map((device) =>
      sendPush(
        {
          endpoint: device.endpoint,
          p256dh: device.p256dh,
          auth: device.auth,
        },
        {
          title: opts.title,
          body: opts.body,
          tag: `coaching-${opts.sessionId}`,
          url: appUrl ? `${appUrl}/dashboard` : "/dashboard",
        },
      ),
    ),
  );

  const sent = results.filter((r) => r.ok).length;
  const failed = results.length - sent;
  const firstError = results.find((r) => !r.ok)?.error;

  await supabase.from("coaching_reminders_sent").upsert(
    {
      session_id: opts.sessionId,
      kind: opts.kind,
      status: sent > 0 ? "sent" : "failed",
      error_message:
        sent > 0 ? null : (firstError ?? "no device accepted the notification"),
      sent_at: new Date().toISOString(),
    },
    { onConflict: "session_id,kind" },
  );

  return { sent, failed };
}
