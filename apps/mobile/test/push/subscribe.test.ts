import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { disablePush, enablePush, pushSupport } from '../../src/push/subscribe';
import { setup } from '../screens/setup';

const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill);
const KEY = b64u(bytes(65, 4));
const OTHER_KEY = b64u(bytes(65, 9));
const toJSON = () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: b64u(bytes(65, 1)), auth: b64u(bytes(16, 2)) } });

interface Env { calls: string[]; unsubscribe: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn>; requestPermission: ReturnType<typeof vi.fn>; fetchImpl: ReturnType<typeof vi.fn> }

/** Notification, PushManager, the service worker's push manager and /push/key, each call recorded in order. */
function env(o: { permission?: NotificationPermission; existingKey?: string | null; relay?: 'key' | 404 | 500; standalone?: boolean } = {}): Env {
  const calls: string[] = [];
  const requestPermission = vi.fn(async () => { calls.push('permission'); return o.permission ?? 'granted'; });
  vi.stubGlobal('Notification', { permission: 'default', requestPermission });
  vi.stubGlobal('PushManager', class {});
  const unsubscribe = vi.fn(async () => { calls.push('unsubscribe'); return true; });
  const existing = o.existingKey ? { options: { applicationServerKey: Uint8Array.from(atob(o.existingKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)).buffer }, unsubscribe, toJSON } : null;
  const subscribe = vi.fn(async () => { calls.push('subscribe'); return { unsubscribe, toJSON }; });
  const pushManager = { getSubscription: vi.fn(async () => existing), subscribe };
  Object.defineProperty(globalThis.navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve({ pushManager }) } });
  if (o.standalone !== undefined) Object.defineProperty(globalThis.navigator, 'standalone', { configurable: true, value: o.standalone });
  const fetchImpl = vi.fn(async (_u: string) => {
    calls.push('fetch');
    return o.relay === 404 ? new Response(null, { status: 404 }) : o.relay === 500 ? new Response(null, { status: 500 })
      : new Response(JSON.stringify({ publicKey: KEY }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return { calls, unsubscribe, subscribe, requestPermission, fetchImpl };
}

beforeEach(() => { Reflect.deleteProperty(globalThis.navigator, 'standalone'); });
afterEach(() => { vi.unstubAllGlobals(); Reflect.deleteProperty(globalThis.navigator, 'serviceWorker'); Reflect.deleteProperty(globalThis.navigator, 'standalone'); });

describe('pushSupport', () => {
  it('is ok with Notification and PushManager', () => {
    env();
    expect(pushSupport()).toBe('ok');
  });
  it('is unsupported without PushManager or Notification', () => {
    env();
    vi.stubGlobal('PushManager', undefined);
    expect(pushSupport()).toBe('unsupported');
    env();
    vi.stubGlobal('Notification', undefined);
    expect(pushSupport()).toBe('unsupported');
  });
  it('is unsupported on iOS outside the home screen, ok once installed', () => {
    env({ standalone: false });
    expect(pushSupport()).toBe('unsupported');
    env({ standalone: true });
    expect(pushSupport()).toBe('ok');
  });
  it('is denied when the permission was refused', () => {
    env();
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission: vi.fn() });
    expect(pushSupport()).toBe('denied');
  });
});

describe('enablePush', () => {
  it('asks the permission before anything else, then the key, subscribes, sends push.subscribe and waits for applied', async () => {
    const e = env();
    const t = setup();
    const p = enablePush(t.store, e.fetchImpl as unknown as typeof fetch);
    await vi.waitFor(() => expect(t.of('push.subscribe')).toHaveLength(1));
    expect(e.calls).toEqual(['permission', 'fetch', 'subscribe']);
    expect(e.fetchImpl).toHaveBeenCalledWith('/push/key', expect.anything());
    expect(e.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) });
    expect(t.of('push.subscribe')[0]).toMatchObject({ subscription: toJSON(), key: KEY });
    t.deliver({ type: 'operation.result', op: t.of('push.subscribe')[0]!.op, status: 'applied' });
    expect(await p).toBe('on');
  });

  it('denied permission → denied, nothing sent, the relay not asked', async () => {
    const e = env({ permission: 'denied' });
    const t = setup();
    expect(await enablePush(t.store, e.fetchImpl as unknown as typeof fetch)).toBe('denied');
    expect(e.fetchImpl).not.toHaveBeenCalled();
    expect(t.of('push.subscribe')).toEqual([]);
  });

  it('iOS outside the home screen → unsupported, the permission not even asked', async () => {
    const e = env({ standalone: false });
    const t = setup();
    expect(await enablePush(t.store, e.fetchImpl as unknown as typeof fetch)).toBe('unsupported');
    expect(e.requestPermission).not.toHaveBeenCalled();
  });

  it('a relay without push (404) → unavailable', async () => {
    const e = env({ relay: 404 });
    const t = setup();
    expect(await enablePush(t.store, e.fetchImpl as unknown as typeof fetch)).toBe('unavailable');
    expect(t.of('push.subscribe')).toEqual([]);
  });

  it('another relay failure → failed', async () => {
    const e = env({ relay: 500 });
    const t = setup();
    expect(await enablePush(t.store, e.fetchImpl as unknown as typeof fetch)).toBe('failed');
  });

  it('a subscription made with another key is unsubscribed before the new one', async () => {
    const e = env({ existingKey: OTHER_KEY });
    const t = setup();
    const p = enablePush(t.store, e.fetchImpl as unknown as typeof fetch);
    await vi.waitFor(() => expect(t.of('push.subscribe')).toHaveLength(1));
    expect(e.calls).toEqual(['permission', 'fetch', 'unsubscribe', 'subscribe']);
    t.deliver({ type: 'operation.result', op: t.of('push.subscribe')[0]!.op, status: 'applied' });
    expect(await p).toBe('on');
  });

  it('a subscription with the same key is kept', async () => {
    const e = env({ existingKey: KEY });
    const t = setup();
    const p = enablePush(t.store, e.fetchImpl as unknown as typeof fetch);
    await vi.waitFor(() => expect(t.of('push.subscribe')).toHaveLength(1));
    expect(e.calls).toEqual(['permission', 'fetch']);
    t.deliver({ type: 'operation.result', op: t.of('push.subscribe')[0]!.op, status: 'applied' });
    expect(await p).toBe('on');
  });

  it('push.subscribe rejected by the PC → failed', async () => {
    const e = env();
    const t = setup();
    const p = enablePush(t.store, e.fetchImpl as unknown as typeof fetch);
    await vi.waitFor(() => expect(t.of('push.subscribe')).toHaveLength(1));
    t.deliver({ type: 'operation.result', op: t.of('push.subscribe')[0]!.op, status: 'rejected', reason: 'invalid' });
    expect(await p).toBe('failed');
  });

  it('a link that is not ready → failed, nothing sent', async () => {
    const e = env();
    const t = setup('pc_offline');
    expect(await enablePush(t.store, e.fetchImpl as unknown as typeof fetch)).toBe('failed');
    expect(t.of('push.subscribe')).toEqual([]);
  });
});

describe('disablePush', () => {
  it('sends push.unsubscribe, then unsubscribes the browser', async () => {
    const e = env({ existingKey: KEY });
    const t = setup();
    const p = disablePush(t.store);
    await vi.waitFor(() => expect(t.of('push.unsubscribe')).toHaveLength(1));
    expect(e.unsubscribe).not.toHaveBeenCalled();
    t.deliver({ type: 'operation.result', op: t.of('push.unsubscribe')[0]!.op, status: 'applied' });
    await p;
    expect(e.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
