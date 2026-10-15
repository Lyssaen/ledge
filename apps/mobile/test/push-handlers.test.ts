import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PushPayload } from '@ledge/protocol';
import { badgeFrom, hashOf, notificationFrom, openTarget, setBadge, type ClientsLike, type WindowLike } from '../src/push/handlers';
import { enableNotifications } from '../src/push/subscribe';

const ok: PushPayload = { v: 1, kind: 'request', title: 'Votre accord est demandé', body: 'Otto · Lancer les tests', url: '/m/#/request/s1/p1', badge: 1, tag: 'p1' };

describe('notificationFrom', () => {
  it('builds the notification from a valid payload and ignores anything else', () => {
    expect(notificationFrom(ok)).toEqual({ title: ok.title, options: { body: ok.body, tag: 'p1', data: { url: ok.url }, icon: '/m/icons/192.png' } });
    expect(notificationFrom({ ...ok, url: 'https://evil.example/' })).toBeNull();
    expect(notificationFrom({ ...ok, tag: 'x'.repeat(33) })).toBeNull();
    expect(notificationFrom({ ...ok, v: 2 })).toBeNull();
    expect(notificationFrom(null)).toBeNull();
    expect(notificationFrom('text')).toBeNull();
  });
  it('reads the badge count', () => {
    expect(badgeFrom(ok)).toBe(1);
    expect(badgeFrom({ ...ok, badge: 0 })).toBe(0);
    expect(badgeFrom({ nope: 1 })).toBeNull();
  });
  it('keeps only in-app links', () => {
    expect(hashOf('/m/#/request/a/b')).toBe('#/request/a/b');
    expect(hashOf('/other/#/x')).toBeNull();
    expect(hashOf(3)).toBeNull();
  });
});

describe('setBadge', () => {
  it('sets the count, clears at 0 and does nothing where the API is missing', async () => {
    const nav = { setAppBadge: vi.fn().mockResolvedValue(undefined), clearAppBadge: vi.fn().mockResolvedValue(undefined) };
    await setBadge(3, nav); expect(nav.setAppBadge).toHaveBeenCalledWith(3);
    await setBadge(0, nav); expect(nav.clearAppBadge).toHaveBeenCalledTimes(1);
    await expect(setBadge(2, {})).resolves.toBeUndefined();
    await expect(setBadge(2, { setAppBadge: () => Promise.reject(new Error('no')) })).resolves.toBeUndefined();
  });
});

function fakeClients(wins: { url: string }[]) {
  const made: (WindowLike & { posted: unknown[]; focused: number })[] = wins.map(w => ({ ...w, posted: [], focused: 0, focus() { this.focused++; return Promise.resolve(); }, postMessage(m: unknown) { this.posted.push(m); } } as WindowLike & { posted: unknown[]; focused: number }));
  const opened: string[] = [];
  const clients: ClientsLike = { matchAll: () => Promise.resolve(made), openWindow: url => { opened.push(url); return Promise.resolve(null); } };
  return { clients, made, opened };
}

describe('openTarget', () => {
  it('focuses an open window and sends it the url', async () => {
    const f = fakeClients([{ url: 'https://pc.ts.net/m/#/' }]);
    await openTarget(ok.url, f.clients);
    expect(f.made[0]!.posted).toEqual([{ type: 'open', url: ok.url }]);
    expect(f.made[0]!.focused).toBe(1);
    expect(f.opened).toEqual([]);
  });
  it('opens a window on the url when none of the app is open', async () => {
    const f = fakeClients([{ url: 'https://pc.ts.net/other/' }]);
    await openTarget(ok.url, f.clients);
    expect(f.opened).toEqual([ok.url]);
    expect(f.made[0]!.posted).toEqual([]);
  });
});

describe('enableNotifications', () => {
  afterEach(() => { vi.unstubAllGlobals(); Reflect.deleteProperty(navigator, 'serviceWorker'); });
  const sub = { toJSON: () => ({ endpoint: 'https://push.example/x', expirationTime: null, keys: { p256dh: 'p', auth: 'a' } }) };
  const setup = (permission: string) => {
    vi.stubGlobal('Notification', { requestPermission: vi.fn().mockResolvedValue(permission) });
    vi.stubGlobal('PushManager', class {});
    Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true });
    const subscribe = vi.fn().mockResolvedValue(sub);
    return { subscribe, reg: { pushManager: { subscribe } } as unknown as ServiceWorkerRegistration };
  };
  it('asks permission, subscribes with the key and sends push.subscribe', async () => {
    const { subscribe, reg } = setup('granted');
    const send = vi.fn();
    await expect(enableNotifications({ vapidPublicKey: 'BAQAB-_w', send, reg })).resolves.toBe('granted');
    const arg = subscribe.mock.calls[0]![0] as { userVisibleOnly: boolean; applicationServerKey: Uint8Array };
    expect(arg.userVisibleOnly).toBe(true);
    expect([...arg.applicationServerKey]).toEqual([4, 4, 0, 7, 239, 240]);
    expect(send).toHaveBeenCalledWith({ type: 'push.subscribe', subscription: { endpoint: 'https://push.example/x', expirationTime: null, keys: { p256dh: 'p', auth: 'a' } } });
  });
  it('does not subscribe when permission is refused', async () => {
    const { subscribe, reg } = setup('denied');
    const send = vi.fn();
    await expect(enableNotifications({ vapidPublicKey: 'k', send, reg })).resolves.toBe('denied');
    expect(subscribe).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });
  it('is unsupported without the Notification API', async () => {
    vi.stubGlobal('Notification', undefined);
    await expect(enableNotifications({ vapidPublicKey: 'k', send: vi.fn() })).resolves.toBe('unsupported');
  });
});
