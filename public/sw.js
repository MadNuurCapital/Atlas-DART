/**
 * Service worker for DART & Case Tracker.
 *
 * Its only job is notifications. There is deliberately no offline caching:
 * a cached daily form would show stale figures and let someone submit against
 * yesterday's state, which is worse than a page that simply says it is offline.
 */

self.addEventListener("install", () => {
  // Take over immediately rather than waiting for every tab to close, so an
  // updated worker is live on the next notification rather than next week.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "DART reminder", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Your DART update is missing";
  const options = {
    body: payload.body || "Tap to submit today's figures.",
    icon: "/icon-192.png",
    badge: "/badge-72.png",
    // A stable tag means a later nag REPLACES the earlier one rather than
    // stacking six identical notifications by bedtime.
    tag: payload.tag || "dart-daily-reminder",
    renotify: true,
    requireInteraction: Boolean(payload.requireInteraction),
    // Overnight the day is already late, so the notification waits on the
    // lock screen rather than waking the whole team at 3am.
    silent: Boolean(payload.silent),
    data: { url: payload.url || "/today" },
    // The label follows the payload: the 6am digest to an admin says "See who",
    // not "Submit now", because there is nothing for them to submit.
    actions: [{ action: "open", title: payload.action || "Submit now" }],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/today";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Focus an open tab if there is one, rather than piling up windows.
        for (const client of clientList) {
          if ("focus" in client) {
            client.navigate(target);
            return client.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(target);
        return undefined;
      }),
  );
});
