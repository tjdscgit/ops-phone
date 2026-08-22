// Service worker for the Roseberry Ops phone app.
//
// Its only real job is receiving Web Push messages while the app is closed —
// that is the whole reason a service worker exists here. There is deliberately
// no offline caching: the app is a thin form over Supabase, and a stale cached
// task list would be worse than a spinner.

const APP_URL = self.registration.scope;

// Push arrives as an encrypted payload the sender built (see
// scripts/send-reminders.mjs). Fall back to a generic message if the payload
// is missing or malformed, because a push event MUST result in a visible
// notification — Chrome revokes push permission from origins that receive a
// push and show nothing.
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || 'Roseberry Ops';
  const options = {
    body: payload.body || 'You have something due.',
    // Tag collapses repeats: a second reminder for the same task replaces the
    // first in the shade rather than stacking up.
    tag: payload.tag || 'ops-reminder',
    renotify: true,
    // Badge/icon are monochrome and full-colour respectively per Android's
    // notification conventions.
    icon: payload.icon || './icon-192.png',
    badge: './icon-badge.png',
    data: { url: payload.url || APP_URL },
    // Vibrate so it registers when the phone is in a pocket in a paddock.
    vibrate: [120, 60, 120],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping the notification should focus an already-open tab rather than piling
// up new ones — the common case is the app is already open in the background.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || APP_URL;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.startsWith(APP_URL) && 'focus' in client) {
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      }),
  );
});

// Push services occasionally rotate a subscription. When that happens the old
// endpoint stops working, so the page needs to re-register on next open. We
// can't reach Supabase from here without the session, so just flag it.
self.addEventListener('pushsubscriptionchange', () => {
  // Best-effort: the page checks and re-subscribes on load.
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
