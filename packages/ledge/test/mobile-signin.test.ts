import { describe, it, expect } from 'vitest';
import { signOut, startSignIn } from '../src/mobile/signin.js';

const RELAY = 'http://127.0.0.1:9';
const DEVICE_CODE = 'device-code-secret-123';
const START = { deviceCode: DEVICE_CODE, userCode: 'ABCD-EFGH', verificationUri: 'https://github.com/login/device', expiresIn: 900, interval: 5 };

type Call = { url: string; method: string; body: unknown; headers: Record<string, string>; signal: boolean };

/** A fetch that answers `/auth/device/start` with START, then each poll with the next of `polls`. */
function fakeFetch(polls: unknown[], opts: { throwOnPoll?: Error } = {}) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined, headers, signal: !!init?.signal });
    if (url.endsWith('/auth/device/start')) return Response.json(START);
    if (url.endsWith('/auth/device/poll')) {
      if (opts.throwOnPoll) throw opts.throwOnPoll;
      return Response.json(polls.shift() ?? { status: 'pending' });
    }
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  return { impl, calls };
}

describe('startSignIn', () => {
  it('polls through pending and slow_down, then signs in with the relay URL in the session', async () => {
    const f = fakeFetch([{ status: 'pending' }, { status: 'slow_down', interval: 10 }, { status: 'ok', token: 'tok', accountId: '42', login: 'octo' }]);
    const sleeps: number[] = [];
    const codes: unknown[] = [];
    const before = Date.now();
    const s = startSignIn({ relayUrl: RELAY, onCode: (c) => codes.push(c), fetchImpl: f.impl, sleep: async (ms) => { sleeps.push(ms); } });
    expect(await s.result).toEqual({ status: 'ok', session: { token: 'tok', accountId: '42', login: 'octo', relayUrl: RELAY } });
    expect(sleeps).toEqual([5000, 5000, 10000]);
    expect(codes).toHaveLength(1);
    const code = codes[0] as { userCode: string; verificationUri: string; expiresAt: string };
    expect(code).toMatchObject({ userCode: 'ABCD-EFGH', verificationUri: 'https://github.com/login/device' });
    expect(Object.keys(code).sort()).toEqual(['expiresAt', 'userCode', 'verificationUri']);
    expect(Date.parse(code.expiresAt) - before).toBeGreaterThanOrEqual(900_000);
    expect(Date.parse(code.expiresAt) - Date.now()).toBeLessThanOrEqual(900_000);
    expect(f.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST ${RELAY}/auth/device/start`,
      `POST ${RELAY}/auth/device/poll`, `POST ${RELAY}/auth/device/poll`, `POST ${RELAY}/auth/device/poll`
    ]);
    expect(f.calls.slice(1).every((c) => JSON.stringify(c.body) === JSON.stringify({ deviceCode: DEVICE_CODE }))).toBe(true);
    expect(f.calls.every((c) => c.signal)).toBe(true);
  });

  for (const status of ['not_allowed', 'expired', 'denied'] as const) {
    it(`returns ${status} as is`, async () => {
      const f = fakeFetch([{ status: 'pending' }, { status }]);
      const s = startSignIn({ relayUrl: RELAY, onCode: () => {}, fetchImpl: f.impl, sleep: async () => {} });
      expect(await s.result).toEqual({ status });
      expect(f.calls).toHaveLength(3);
    });
  }

  it('cancel() during the wait gives cancelled, and no further call', async () => {
    const f = fakeFetch([]);
    let slept!: () => void;
    const sleeping = new Promise<void>((res) => { slept = res; });
    const s = startSignIn({ relayUrl: RELAY, onCode: () => {}, fetchImpl: f.impl, sleep: () => { slept(); return new Promise<void>(() => {}); } });
    await sleeping;
    s.cancel();
    expect(await s.result).toEqual({ status: 'cancelled' });
    await new Promise((r) => setTimeout(r, 20));
    expect(f.calls).toHaveLength(1);
  });

  it('cancel() with the default sleep stops the real timer', async () => {
    const f = fakeFetch([]);
    let coded!: () => void;
    const shown = new Promise<void>((res) => { coded = res; });
    const s = startSignIn({ relayUrl: RELAY, onCode: () => coded(), fetchImpl: f.impl });
    await shown;
    s.cancel();
    expect(await s.result).toEqual({ status: 'cancelled' });
    expect(f.calls).toHaveLength(1);
  });

  it('a fetch that throws gives failed, without the device code in the error', async () => {
    const f = fakeFetch([], { throwOnPoll: new Error(`network down while sending {"deviceCode":"${DEVICE_CODE}"}`) });
    const s = startSignIn({ relayUrl: RELAY, onCode: () => {}, fetchImpl: f.impl, sleep: async () => {} });
    const r = await s.result;
    expect(r.status).toBe('failed');
    expect(JSON.stringify(r)).not.toContain(DEVICE_CODE);
    expect(r).toMatchObject({ error: expect.stringContaining('network down') });
  });

  it('an error answer from the relay gives failed', async () => {
    const impl = (async () => Response.json({ error: 'github' }, { status: 502 })) as typeof fetch;
    const r = await startSignIn({ relayUrl: RELAY, onCode: () => {}, fetchImpl: impl, sleep: async () => {} }).result;
    expect(r).toEqual({ status: 'failed', error: 'relay answered 502' });
  });
});

describe('signOut', () => {
  const session = { token: 'tok-secret', accountId: '42', login: 'octo', relayUrl: RELAY };

  it('posts /auth/logout with the bearer', async () => {
    const f = fakeFetch([]);
    await signOut(session, f.impl);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toMatchObject({ method: 'POST', url: `${RELAY}/auth/logout`, signal: true });
    expect(f.calls[0]!.headers.authorization).toBe('Bearer tok-secret');
  });

  it('swallows a network error', async () => {
    const impl = (async () => { throw new Error('offline'); }) as typeof fetch;
    await expect(signOut(session, impl)).resolves.toBeUndefined();
  });
});
