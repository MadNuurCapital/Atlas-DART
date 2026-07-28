import "server-only";

import webpush from "web-push";

/**
 * Web push sending.
 *
 * VAPID identifies this application to the browser vendors' push services.
 * The keys are generated once and never change - rotating them silently
 * invalidates every existing subscription, and every phone goes quiet without
 * anyone noticing.
 */

export type PushSubscriptionRecord = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushPayload = {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  requireInteraction?: boolean;
};

export type PushOutcome = {
  ok: boolean;
  /** True when the endpoint is gone for good and should be deleted. */
  gone?: boolean;
  error?: string;
};

let configured = false;

function configure(): boolean {
  if (configured) return true;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@example.com";

  if (!publicKey || !privateKey) return false;

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export async function sendPush(
  subscription: PushSubscriptionRecord,
  payload: PushPayload,
): Promise<PushOutcome> {
  if (!configure()) {
    return {
      ok: false,
      error: "Push is not configured - VAPID keys are missing.",
    };
  }

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 6 },
    );
    return { ok: true };
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;

    // 404 and 410 mean the browser has thrown the subscription away - the app
    // was uninstalled, or notifications were revoked. Nothing will ever be
    // delivered again, so the row should go rather than being retried hourly
    // for the rest of time.
    if (status === 404 || status === 410) {
      return { ok: false, gone: true, error: `Subscription expired (${status})` };
    }

    return {
      ok: false,
      error:
        error instanceof Error
          ? `${status ?? ""} ${error.message}`.trim()
          : String(error),
    };
  }
}

/** Is push usable at all in this environment? */
export function pushConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY,
  );
}
