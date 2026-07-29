"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { Bell, BellOff, Loader2, Send, Share, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  savePushSubscription,
  removePushSubscription,
  sendTestPush,
} from "@/app/(app)/notifications/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Base64url to the byte buffer the Push API insists on.
 *
 * Returns an ArrayBuffer rather than a Uint8Array: applicationServerKey is
 * typed as BufferSource over a plain ArrayBuffer, and a Uint8Array's backing
 * buffer is ArrayBufferLike, which does not satisfy it.
 */
function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalised);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i);
  return buffer;
}

type Support =
  | { kind: "checking" }
  | { kind: "ready" }
  | { kind: "needs-install" }
  | { kind: "unsupported"; reason: string }
  | { kind: "blocked" };

/**
 * What this browser can actually do, read synchronously at render.
 *
 * Deliberately not computed in an effect: browser capability is not something
 * that changes over time, and setting state from an effect to describe it is
 * both a React violation and a guaranteed flash of the wrong UI.
 */
function detectSupport(vapidPublicKey: string | null): Support {
  if (typeof window === "undefined") return { kind: "checking" };

  if (!vapidPublicKey) {
    return {
      kind: "unsupported",
      reason: "Notifications are not configured on the server yet.",
    };
  }

  // Everything below asks the browser about itself, and this runs inside
  // getSnapshot - so anything that throws here throws during render, which
  // takes down the entire page rather than just this card. Browsers disagree
  // about these APIs in ways that are genuinely hard to predict: matchMedia
  // and Notification behave differently in a private window, in an embedded
  // webview, and inside an installed iOS app, and a locked-down device can
  // make simply reading Notification.permission throw.
  //
  // No capability check is worth a broken page. If the browser will not answer
  // the question, the honest response is that notifications are unavailable
  // here - which is exactly what "unsupported" says.
  try {
    // iOS only allows web push from a site added to the Home Screen. Detect
    // that rather than letting someone tap a button that silently does nothing.
    const isIos = /iP(hone|ad|od)/.test(navigator.userAgent);
    const isStandalone =
      window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
      ("standalone" in navigator &&
        (navigator as unknown as { standalone?: boolean }).standalone === true);

    if (isIos && !isStandalone) return { kind: "needs-install" };

    const hasApi =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;

    if (!hasApi) {
      return {
        kind: "unsupported",
        reason: "This browser does not support notifications.",
      };
    }

    if (Notification.permission === "denied") return { kind: "blocked" };

    return { kind: "ready" };
  } catch (error) {
    console.error("[push] could not read notification support", error);
    return {
      kind: "unsupported",
      reason:
        "This browser would not say whether it supports notifications, so they cannot be turned on here.",
    };
  }
}

/**
 * Browser capability never changes, so there is nothing to subscribe to.
 *
 * Hoisted to module scope rather than written inline: a new function on every
 * render makes React tear down and re-establish the subscription each time.
 */
const NEVER_CHANGES = () => () => {};

/** One shared instance, so the server snapshot is referentially stable. */
const CHECKING: Support = { kind: "checking" };

export function EnablePush({
  vapidPublicKey,
  initiallyEnabled,
}: {
  vapidPublicKey: string | null;
  initiallyEnabled: boolean;
}) {
  // getSnapshot MUST return the same object every time until the underlying
  // value actually changes. React compares snapshots by reference to decide
  // whether the store has settled, so returning a fresh object literal on each
  // call looks like a store changing infinitely - and React gives up with
  // "Maximum update depth exceeded", which took the whole page down with it.
  //
  // detectSupport() reads the browser, so its answer is fixed for the life of
  // the page. Computing it once and handing back the same object is both
  // correct and what React requires.
  const getSupport = useMemo(() => {
    let cached: Support | null = null;
    return () => (cached ??= detectSupport(vapidPublicKey));
  }, [vapidPublicKey]);

  // "checking" on the server, the real answer on the client.
  // useSyncExternalStore is the supported way to read a browser-only value
  // without a hydration mismatch and without setting state from an effect.
  const detected = useSyncExternalStore(
    NEVER_CHANGES,
    getSupport,
    () => CHECKING,
  );

  // Only ever set from an event handler, e.g. after permission is refused.
  const [overridden, setOverridden] = useState<Support | null>(null);
  const support = overridden ?? detected;

  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [pending, startTransition] = useTransition();

  function enable() {
    if (!vapidPublicKey) return;

    startTransition(async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setOverridden({ kind: "blocked" });
          toast.error("Notifications were not allowed.");
          return;
        }

        const registration = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;

        const existing = await registration.pushManager.getSubscription();
        const subscription =
          existing ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToBuffer(vapidPublicKey),
          }));

        const json = subscription.toJSON();
        const result = await savePushSubscription({
          endpoint: subscription.endpoint,
          p256dh: json.keys?.p256dh ?? "",
          auth: json.keys?.auth ?? "",
          userAgent: navigator.userAgent.slice(0, 500),
        });

        if (result.ok) {
          setEnabled(true);
          toast.success(result.message ?? "Reminders on.");
        } else {
          toast.error(result.message ?? "Could not turn reminders on.");
        }
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not turn reminders on.",
        );
      }
    });
  }

  function disable() {
    startTransition(async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();

        if (subscription) {
          await subscription.unsubscribe();
          await removePushSubscription(subscription.endpoint);
        }

        setEnabled(false);
        toast.success("Reminders off.");
      } catch {
        toast.error("Could not turn reminders off.");
      }
    });
  }

  function test() {
    startTransition(async () => {
      const result = await sendTestPush();
      if (result.ok) toast.success(result.message ?? "Sent.");
      else toast.error(result.message ?? "Could not send.");
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Daily reminders</CardTitle>
          {enabled && <Badge variant="success">On</Badge>}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {support.kind === "needs-install" && (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              To get reminders on an iPhone, add this to your Home Screen first.
              Apple only allows notifications from installed apps.
            </p>
            <ol className="space-y-1.5 text-sm">
              <li className="flex items-center gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium">
                  1
                </span>
                Tap <Share className="inline size-4" aria-hidden="true" /> Share
                at the bottom of Safari
              </li>
              <li className="flex items-center gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium">
                  2
                </span>
                Tap <Plus className="inline size-4" aria-hidden="true" /> Add to
                Home Screen
              </li>
              <li className="flex items-center gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium">
                  3
                </span>
                Open it from your Home Screen and come back here
              </li>
            </ol>
          </div>
        )}

        {support.kind === "blocked" && (
          <p className="text-sm text-muted-foreground">
            Notifications are blocked for this site. Turn them back on in your
            browser settings, then reload this page.
          </p>
        )}

        {support.kind === "unsupported" && (
          <p className="text-sm text-muted-foreground">{support.reason}</p>
        )}

        {support.kind === "ready" && (
          <>
            <p className="text-sm text-muted-foreground">
              {enabled
                ? "You will be reminded every hour from 7pm until you submit. Silent after midnight. It stops the moment you do."
                : "Get a notification on your phone every hour from 7pm until you have submitted. Silent overnight."}
            </p>

            <div className="flex flex-wrap gap-2">
              {enabled ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={test}
                    data-testid="test-push"
                  >
                    {pending ? (
                      <Loader2 className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Send aria-hidden="true" />
                    )}
                    Send a test
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={pending}
                    onClick={disable}
                  >
                    <BellOff aria-hidden="true" />
                    Turn off
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  disabled={pending}
                  onClick={enable}
                  data-testid="enable-push"
                >
                  {pending ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Bell aria-hidden="true" />
                  )}
                  Turn on reminders
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
