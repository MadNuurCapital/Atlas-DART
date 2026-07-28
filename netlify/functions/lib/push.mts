import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "./reminders.mts";

/**
 * Delivering a web push notification, and keeping the device list honest.
 *
 * Both scheduled push jobs - the hourly chase aimed at consultants and the
 * 6 AM list aimed at admins - need the same three things: VAPID configured,
 * the live subscriptions for a set of people, and a send that treats a dead
 * endpoint differently from a flaky one. Doing that in one place is the only
 * way the two cannot drift apart on the rules that matter, particularly the
 * failure accounting, which is easy to get subtly and silently wrong.
 */

export type PushDevice = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failure_count: number;
};

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
  requireInteraction?: boolean;
  silent?: boolean;
};

export type DeliveryResult = {
  /** At least one of this person's devices accepted it. */
  delivered: boolean;
  sent: number;
  failed: number;
  removed: number;
  error?: string;
};

/**
 * A device is given up on after this many consecutive failures.
 *
 * Only failures that are not an outright 404/410 count - those are deleted
 * immediately. This covers the murkier case of a push service that keeps
 * erroring, where retrying hourly forever would be pointless noise.
 */
export const MAX_PUSH_FAILURES = 5;

/** Throws if the VAPID keys are absent, which is the only fatal misconfiguration. */
export function configureVapid(): void {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:admin@example.com",
    requireEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY"),
    requireEnv("VAPID_PRIVATE_KEY"),
  );
}

/**
 * Every live subscription belonging to any of these people, grouped by person.
 *
 * One query rather than one per person: a team of forty with two devices each
 * would otherwise be forty round trips before a single notification is sent.
 */
export async function loadDevices(
  supabase: SupabaseClient,
  userIds: string[],
): Promise<Map<string, PushDevice[]>> {
  const byUser = new Map<string, PushDevice[]>();
  if (userIds.length === 0) return byUser;

  const { data } = await supabase
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth, failure_count")
    .in("user_id", userIds)
    .lt("failure_count", MAX_PUSH_FAILURES);

  for (const device of (data as PushDevice[]) ?? []) {
    const list = byUser.get(device.user_id) ?? [];
    list.push(device);
    byUser.set(device.user_id, list);
  }

  return byUser;
}

/**
 * Send one notification to every device belonging to one person.
 *
 * A 404 or 410 means the browser has thrown the subscription away and it will
 * never work again, so the row is deleted. Anything else might be temporary -
 * a push service having a bad minute, a phone that has been off for a day - so
 * the failure count is INCREMENTED and the device gets another chance next
 * hour, up to MAX_PUSH_FAILURES.
 *
 * A successful send resets the count to zero. Without that, a device that
 * collected a scattered failure here and there over several months would
 * eventually cross the threshold and go quiet despite working perfectly well.
 */
export async function deliver(
  supabase: SupabaseClient,
  devices: PushDevice[],
  payload: PushPayload,
): Promise<DeliveryResult> {
  const result: DeliveryResult = {
    delivered: false,
    sent: 0,
    failed: 0,
    removed: 0,
  };

  for (const device of devices) {
    try {
      await webpush.sendNotification(
        {
          endpoint: device.endpoint,
          keys: { p256dh: device.p256dh, auth: device.auth },
        },
        JSON.stringify(payload),
        { TTL: 3600 },
      );

      result.delivered = true;
      result.sent += 1;

      const patch: Record<string, unknown> = {
        last_used_at: new Date().toISOString(),
      };
      if (device.failure_count > 0) patch.failure_count = 0;

      await supabase
        .from("push_subscriptions")
        .update(patch)
        .eq("id", device.id);
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      result.error = error instanceof Error ? error.message : String(error);

      if (status === 404 || status === 410) {
        await supabase.from("push_subscriptions").delete().eq("id", device.id);
        result.removed += 1;
      } else {
        await supabase
          .from("push_subscriptions")
          .update({ failure_count: device.failure_count + 1 })
          .eq("id", device.id);
        result.failed += 1;
      }
    }
  }

  return result;
}
