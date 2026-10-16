import type { MobileStore } from '../state/store';
import { pushSupported } from './subscribe';

/** What the phone holds: the subscription and the (base64url) server key it was made for, when the browser says. */
export type HeldSubscription = PushSubscriptionJSON & { serverKey?: string | null };

const b64url = (b: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function currentSubscription(): Promise<HeldSubscription | null> {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return null;
  const key = sub.options?.applicationServerKey;
  return { ...sub.toJSON(), serverKey: key ? b64url(key as ArrayBuffer) : null };
}

/**
 * On every `auth.ok`, hand the PC the subscription this phone already holds, so the PC has it after a reconnect, a
 * lost message or a daemon that forgot it. Only when permission is already granted: never prompts. A subscription made
 * for another PC key (the PC's keys were regenerated) is not re-sent: it is flagged, and enabling again, which needs a tap, replaces it.
 */
export function startPushSync(store: MobileStore, o: { supported?: () => boolean; granted?: () => boolean; subscription?: () => Promise<HeldSubscription | null> } = {}): () => void {
  const supported = o.supported ?? pushSupported;
  const granted = o.granted ?? (() => Notification.permission === 'granted');
  const subscription = o.subscription ?? currentSubscription;
  return store.listen(msg => {
    if (msg.type !== 'auth.ok' || !supported() || !granted()) return;
    // Asynchronous on purpose: the store marks the link online right after its listeners ran.
    const current = msg.vapidPublicKey;
    void subscription().then(sub => {
      const stale = !!(sub && current && sub.serverKey && sub.serverKey !== current);
      store.setPushStale(stale);
      if (stale) return;
      if (sub?.endpoint && sub.keys?.p256dh && sub.keys.auth) store.send({ type: 'push.subscribe', subscription: { endpoint: sub.endpoint, expirationTime: sub.expirationTime ?? null, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } } });
    }, () => { /* no service worker yet: the next auth.ok tries again */ });
  });
}
