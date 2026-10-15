import type { MobileStore } from '../state/store';
import { pushSupported } from './subscribe';

/** The browser's current push subscription, if any. */
async function currentSubscription(): Promise<PushSubscriptionJSON | null> {
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription())?.toJSON() ?? null;
}

/**
 * On every `auth.ok`, hand the PC the subscription this phone already holds, so the PC has it after a reconnect, a
 * lost message or a daemon that forgot it. Only when permission is already granted: never prompts.
 */
export function startPushSync(store: MobileStore, o: { supported?: () => boolean; granted?: () => boolean; subscription?: () => Promise<PushSubscriptionJSON | null> } = {}): () => void {
  const supported = o.supported ?? pushSupported;
  const granted = o.granted ?? (() => Notification.permission === 'granted');
  const subscription = o.subscription ?? currentSubscription;
  return store.listen(msg => {
    if (msg.type !== 'auth.ok' || !supported() || !granted()) return;
    // Asynchronous on purpose: the store marks the link online right after its listeners ran.
    void subscription().then(sub => {
      if (sub?.endpoint && sub.keys?.p256dh && sub.keys.auth) store.send({ type: 'push.subscribe', subscription: { endpoint: sub.endpoint, expirationTime: sub.expirationTime ?? null, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } } });
    }, () => { /* no service worker yet: the next auth.ok tries again */ });
  });
}
