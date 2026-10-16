import { PushPayloadSchema } from '@ledge/protocol';

/** The few `Clients` members used (the DOM lib has no worker types). */
export interface WindowLike { url: string; focus(): Promise<unknown>; postMessage(m: unknown): void }
export interface ClientsLike {
  matchAll(o: { type: 'window'; includeUncontrolled: boolean }): Promise<readonly WindowLike[]>;
  openWindow(url: string): Promise<unknown>;
}

const ICON = '/m/icons/192.png';

/** What to show for a push; anything that is not a valid payload shows nothing. */
export function notificationFrom(data: unknown): { title: string; options: NotificationOptions } | null {
  const p = PushPayloadSchema.safeParse(data);
  if (!p.success) return null;
  return { title: p.data.title, options: { body: p.data.body, tag: p.data.tag, data: { url: p.data.url }, icon: ICON } };
}

/** Shown for a push whose payload is not understood (a newer daemon, say): iOS drops a subscription whose pushes show nothing. */
export function fallbackNotification(): { title: string; options: NotificationOptions } {
  return { title: 'Ledge', options: { tag: 'ledge', data: { url: '/m/#/' }, icon: ICON } };
}

/** The number of requests waiting, as the daemon counted it when it sent the push. */
export function badgeFrom(data: unknown): number | null {
  const p = PushPayloadSchema.safeParse(data);
  return p.success ? p.data.badge : null;
}

/** Sets the app badge, or clears it at 0; a no-op where the Badging API is missing (the app sets it again when opened). */
export async function setBadge(n: number, nav: { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> } = globalThis.navigator): Promise<void> {
  try {
    if (n > 0) await nav?.setAppBadge?.(n); else await nav?.clearAppBadge?.();
  } catch { /* the badge is a convenience */ }
}

const isAppWindow = (w: WindowLike): boolean => { try { return new URL(w.url).pathname.startsWith('/m/'); } catch { return false; } };

/** A tap on a notification: an open window of the app gets the link and focus, otherwise a new one opens on it. */
export async function openTarget(url: string, clients: ClientsLike): Promise<void> {
  const open = (await clients.matchAll({ type: 'window', includeUncontrolled: true })).find(isAppWindow);
  if (open) {
    open.postMessage({ type: 'open', url });
    await open.focus();
  } else {
    await clients.openWindow(url);
  }
}

/** The in-app hash of a notification link, only for links that stay inside the app. */
export function hashOf(url: unknown): string | null {
  return typeof url === 'string' && url.startsWith('/m/#/') ? url.slice('/m/'.length) : null;
}
