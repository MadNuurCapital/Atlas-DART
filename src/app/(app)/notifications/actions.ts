"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1000),
  p256dh: z.string().min(1).max(500),
  auth: z.string().min(1).max(500),
  userAgent: z.string().max(500).optional(),
});

export type PushResult = { ok: boolean; message?: string };

/**
 * Save a browser's push subscription.
 *
 * Upserts on the endpoint, which is unique per browser installation. Opening
 * the app twice on the same phone therefore updates one row rather than
 * accumulating a duplicate that would double every notification.
 *
 * failure_count resets to zero: a device that is subscribing right now is
 * plainly alive, whatever it did last week.
 */
export async function savePushSubscription(
  input: unknown,
): Promise<PushResult> {
  const profile = await requireProfile();
  const parsed = subscriptionSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, message: "That subscription could not be read." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: profile.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.p256dh,
      auth: parsed.data.auth,
      user_agent: parsed.data.userAgent ?? null,
      failure_count: 0,
      last_used_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );

  if (error) {
    console.error("[push] could not save subscription: %s", error.message);
    return { ok: false, message: "Notifications could not be turned on." };
  }

  revalidatePath("/", "layout");
  return { ok: true, message: "Reminders on. We will nudge you until you submit." };
}

/** Genuinely delete, so a phone stops buzzing when someone asks it to. */
export async function removePushSubscription(
  endpoint: string,
): Promise<PushResult> {
  await requireProfile();

  const supabase = await createClient();
  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint);

  if (error) {
    return { ok: false, message: "Notifications could not be turned off." };
  }

  revalidatePath("/", "layout");
  return { ok: true, message: "Reminders off." };
}

/** Does this person have at least one live subscription? */
export async function hasPushSubscription(): Promise<boolean> {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { count } = await supabase
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", profile.id);

  return (count ?? 0) > 0;
}

/**
 * Send a test notification to the caller's own devices.
 *
 * Enabling notifications and then having to wait until 5pm to discover whether
 * it worked is not a reasonable way to find out.
 */
export async function sendTestPush(): Promise<PushResult> {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", profile.id);

  if (!subs || subs.length === 0) {
    return { ok: false, message: "No devices are subscribed yet." };
  }

  const { sendPush } = await import("@/lib/push/send");
  const results = await Promise.all(
    subs.map((s) =>
      sendPush(
        { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth },
        {
          title: "Notifications are working",
          body: "This is what your daily reminder will look like.",
          tag: "dart-test",
          url: "/today",
        },
      ),
    ),
  );

  const delivered = results.filter((r) => r.ok).length;

  if (delivered === 0) {
    return {
      ok: false,
      message: results[0]?.error ?? "The test notification could not be sent.",
    };
  }

  return {
    ok: true,
    message: `Sent to ${delivered} device${delivered === 1 ? "" : "s"}.`,
  };
}
