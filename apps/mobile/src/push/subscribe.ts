// Turning notifications on and off from the phone: the permission, the relay's VAPID key, the browser's subscription,
// then the PC, which keeps it. Nothing here reads a notification: the service worker shows them.
import { PushSubscriptionSchema } from '@ledge/protocol';
import { isLive } from '../state/operations';
import type { MobileStore } from '../state/store';

export type PushSupport = 'ok' | 'unsupported' | 'denied';
export type EnableResult = 'on' | 'denied' | 'unsupported' | 'unavailable' | 'failed';

/**
 * `unsupported`: no `PushManager` or `Notification`, or iOS outside the home screen (only iOS has `navigator.standalone`,
 * and a push needs the installed app there). `denied`: the permission was refused before.
 */
export function pushSupport(): PushSupport {
  const g = globalThis as { Notification?: { permission: string }; PushManager?: unknown; navigator?: { standalone?: boolean } };
  if (!g.Notification || !g.PushManager) return 'unsupported';
  const nav = g.navigator;
  if (nav && 'standalone' in nav && nav.standalone !== true) return 'unsupported';
  return g.Notification.permission === 'denied' ? 'denied' : 'ok';
}

const toBytes = (b64u: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(b64u.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
};
/** Resolves with the operation's last known phase: `applied`, or anything else when it did not go through. */
function outcome(store: MobileStore, op: string): Promise<'applied' | 'other'> {
  return new Promise(resolve => {
    const check = () => {
      const phase = store.getState().ops[op]?.phase;
      // `uncertain` (no answer in time, or the link broke) is not a success: the user may try again.
      if (!phase || (isLive(phase) && phase !== 'uncertain')) return false;
      off();
      resolve(phase === 'applied' ? 'applied' : 'other');
      return true;
    };
    const off = store.subscribe(check);
    check();
  });
}

/**
 * The permission is asked first, inside the tap (iOS wants it before any other wait), then the relay's key (404: it does
 * not push), then the browser's subscription (the old one dropped, a new one made), then the PC, which must
 * say `applied`.
 */
export async function enablePush(store: MobileStore, fetchImpl: typeof fetch = (i, o) => globalThis.fetch(i, o)): Promise<EnableResult> {
  const support = pushSupport();
  if (support === 'unsupported') return 'unsupported';
  try {
    if (await Notification.requestPermission() !== 'granted') return 'denied';
    const res = await fetchImpl('/push/key', { credentials: 'same-origin', cache: 'no-store' });
    if (res.status === 404) return 'unavailable';
    if (!res.ok) return 'failed';
    const body = await res.json() as { publicKey?: unknown };
    if (typeof body.publicKey !== 'string') return 'failed';
    const key = body.publicKey;
    const keyBytes = toBytes(key);
    const { pushManager } = await navigator.serviceWorker.ready;
    // Always made again: after a 410 the browser may still hand back the dead subscription, whatever its key.
    await (await pushManager.getSubscription())?.unsubscribe();
    const sub = await pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes });
    const subscription = PushSubscriptionSchema.safeParse(sub.toJSON());
    if (!subscription.success) return 'failed';
    const op = store.pushSubscribe(subscription.data, key);
    if (op === null) return 'failed';
    return await outcome(store, op) === 'applied' ? 'on' : 'failed';
  } catch {
    return 'failed';
  }
}

/** Tells the PC, then drops the browser's subscription whatever the PC said (a push to it would only be refused). True when the PC took it. */
export async function disablePush(store: MobileStore): Promise<boolean> {
  const op = store.pushUnsubscribe();
  const applied = op !== null && await outcome(store, op) === 'applied';
  try { await (await navigator.serviceWorker.ready).pushManager.getSubscription().then(s => s?.unsubscribe()); } catch { /* nothing left to drop */ }
  return applied;
}
