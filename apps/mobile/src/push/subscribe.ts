import { PushSubscriptionSchema, type ClientMessage } from '@ledge/protocol';

/** `failed`: permission was given but the subscription did not reach the PC (no push service, or the link was down). */
export type EnableResult = 'granted' | 'denied' | 'unsupported' | 'failed';

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '='));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

const READY_MS = 5000;

/** Whether this browser can do web push at all (iOS: only from the installed home-screen app). */
export function pushSupported(): boolean {
  return typeof Notification !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in globalThis;
}

/**
 * Asks for permission and subscribes this phone. Call it from the tap itself: the permission prompt must be the first
 * thing awaited, or iOS drops the user activation.
 */
export async function enableNotifications(o: { vapidPublicKey: string; /** Returns false when the message could not be sent (link down). */
  send(m: ClientMessage): boolean; reg?: ServiceWorkerRegistration }): Promise<EnableResult> {
  if (!pushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  try {
    const reg = o.reg ?? await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, no) => setTimeout(() => no(new Error('no service worker')), READY_MS))]);
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(o.vapidPublicKey) });
    const subscription = PushSubscriptionSchema.parse(sub.toJSON());
    return o.send({ type: 'push.subscribe', subscription }) ? 'granted' : 'failed';
  } catch {
    return 'failed';
  }
}
