// Web Push registration for this device.

import { sb, cfg } from '../lib/db.js';
import { toast, fail } from '../lib/ui.js';

// VAPID keys are base64url; the browser wants a Uint8Array.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function enablePush() {
  if (!cfg.vapidPublicKey) { toast('No VAPID public key set in config.js.', 'err'); return; }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      toast('Permission denied — enable it in browser settings for this site.', 'err');
      return;
    }

    const reg = await navigator.serviceWorker.ready;
    // Re-subscribing the same device upserts by endpoint, so this is safe to
    // press repeatedly.
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(cfg.vapidPublicKey),
    });

    const json = sub.toJSON();
    const { error } = await sb.from('push_subscriptions').upsert({
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      label: navigator.userAgent.slice(0, 120),
      failed_at: null,
    }, { onConflict: 'endpoint' });

    if (error) { fail(error); return; }
    toast('Notifications enabled on this device.');
  } catch (err) {
    fail(err);
  }
}

// Report where notifications actually stand, because a tappable "enable"
// button tells you nothing about whether it worked last time.
export async function pushStatus() {
  if (typeof Notification === 'undefined') return 'This browser has no notification support.';
  if (Notification.permission === 'denied') {
    return 'Blocked in browser settings for this site.';
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'Notifications are on for this device.' : 'Not enabled on this device yet.';
  } catch {
    return 'Not enabled on this device yet.';
  }
}
