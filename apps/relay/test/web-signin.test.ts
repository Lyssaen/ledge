import { PGlite } from '@electric-sql/pglite';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { MeResponseSchema, parseRelayServerMessage, RELAY_SESSION_COOKIE, type RelayServerMessage } from '@ledge/protocol';
import { accountsAuthenticator, type AccountsDeps } from '../src/accounts.js';
import type { RelayLogEvent } from '../src/log.js';
import { authRoutes } from '../src/routes.js';
import { createRelay } from '../src/server.js';
import { Store } from '../src/store.js';
import { hashToken, newSessionToken } from '../src/tokens.js';
import { fakeGitHub } from './fakeGithub.js';

const ALICE = { id: '1', login: 'alice' };
const BOB = { id: '2', login: 'bob' };
const STATE_COOKIE = 'ledge_oauth_state';

let db: PGlite;
let store: Store;
const running: Array<() => Promise<void>> = [];

beforeAll(async () => {
  db = new PGlite();
  store = new Store(db);
  await store.migrate();
}, 30_000);
afterAll(async () => { await db.close(); });
afterEach(async () => {
  for (const c of running.splice(0).reverse()) await c();
});

interface Mounted {
  base: string;
  ws: string;
  events: RelayLogEvent[];
  github: ReturnType<typeof fakeGitHub>;
  stop(): Promise<void>;
}

async function mount(opts: { allowed?: string[]; publicUrl?: string } = {}): Promise<Mounted> {
  const events: RelayLogEvent[] = [];
  const log = (e: RelayLogEvent) => events.push(e);
  const github = fakeGitHub();
  const deps: AccountsDeps & { github: typeof github } = {
    store, allowed: new Set(opts.allowed ?? ['1', '2']), publicUrl: 'http://127.0.0.1:0', log, github
  };
  const routes = authRoutes(deps);
  const relay = createRelay({ authenticator: accountsAuthenticator(deps), http: routes, log });
  await new Promise<void>((res) => relay.server.listen(0, '127.0.0.1', res));
  const port = (relay.server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  deps.publicUrl = opts.publicUrl ?? base;
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await relay.close();
    routes.stop();
  };
  running.push(stop);
  return { base, ws: `ws://127.0.0.1:${port}/ws`, events, github, stop };
}

/** The `name=value` of one cookie set by a response, or null; `cleared` when it is set with Max-Age=0. */
function setCookieOf(res: Response, name: string): { pair: string; raw: string; value: string } | null {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  if (!raw) return null;
  const pair = raw.split(';')[0]!;
  return { pair, raw, value: pair.slice(name.length + 1) };
}

const manual = (url: string, cookie?: string) => fetch(url, { redirect: 'manual', ...(cookie ? { headers: { cookie } } : {}) });

async function start(m: Mounted): Promise<{ state: string; cookie: string; location: URL }> {
  const res = await manual(`${m.base}/auth/github/start`);
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get('location')!);
  const c = setCookieOf(res, STATE_COOKIE)!;
  return { state: location.searchParams.get('state')!, cookie: c.pair, location };
}

const callback = (m: Mounted, q: Record<string, string>, cookie?: string) =>
  manual(`${m.base}/auth/github/callback?${new URLSearchParams(q).toString()}`, cookie);

async function signIn(m: Mounted, user = ALICE, existing?: string): Promise<Response> {
  const s = await start(m);
  const cookie = existing ? `${s.cookie}; ${existing}` : s.cookie;
  return callback(m, { code: m.github.codeFor(user), state: s.state }, cookie);
}

function inbox(ws: WebSocket) {
  const msgs: RelayServerMessage[] = [];
  const waiters: Array<() => void> = [];
  ws.on('message', (d) => { msgs.push(parseRelayServerMessage(JSON.parse(d.toString('utf8')))); waiters.splice(0).forEach((w) => w()); });
  return {
    async next(n: number) {
      while (msgs.length < n) await new Promise<void>((r) => waiters.push(r));
      return msgs[n - 1]!;
    }
  };
}

const noSession = async (m: Mounted) => expect((await fetch(`${m.base}/auth/me`)).status).toBe(401);

describe('web sign-in', () => {
  it('runs the full flow and opens /ws with the cookie', async () => {
    const m = await mount();
    const s = await start(m);
    expect(s.location.origin + s.location.pathname).toBe('https://github.fake/login/oauth/authorize');
    expect(s.location.searchParams.get('redirect_uri')).toBe(`${m.base}/auth/github/callback`);
    expect(s.cookie).toBe(`${STATE_COOKIE}=${s.state}`);
    const startRes = await manual(`${m.base}/auth/github/start`);
    const raw = setCookieOf(startRes, STATE_COOKIE)!.raw;
    expect(raw).toContain('Path=/auth/github');
    expect(raw).toContain('Max-Age=600');
    expect(raw).toContain('HttpOnly');

    const res = await callback(m, { code: m.github.codeFor(ALICE), state: s.state }, s.cookie);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/?signin=ok');
    const session = setCookieOf(res, RELAY_SESSION_COOKIE)!;
    expect(session.raw).toContain('HttpOnly');
    expect(session.raw).toContain('SameSite=Lax');
    expect(session.raw).toContain('Path=/');
    expect(session.raw).toContain(`Max-Age=${90 * 24 * 60 * 60}`);
    expect(session.raw).not.toContain('Secure');
    const cleared = setCookieOf(res, STATE_COOKIE)!;
    expect(cleared.raw).toContain('Max-Age=0');
    expect(cleared.raw).toContain('Path=/auth/github');

    const ws = new WebSocket(m.ws, { headers: { cookie: session.pair, origin: m.base } });
    ws.once('error', () => {});
    const w = await inbox(ws).next(1);
    expect(w).toMatchObject({ type: 'welcome', accountId: '1' });
    expect((w as { self: string }).self).toMatch(/^d_/);
    ws.close();

    const me = await fetch(`${m.base}/auth/me`, { headers: { cookie: session.pair } });
    expect(MeResponseSchema.parse(await me.json())).toMatchObject({ kind: 'device', accountId: '1', login: 'alice' });
    expect(m.events).toContainEqual({ ev: 'sign_in', account: '1', peer: (w as { self: string }).self, kind: 'device' });
    // No token, code or state in the redirect or the logs.
    expect(res.headers.get('location')).not.toContain(s.state);
    expect(JSON.stringify(m.events)).not.toContain(s.state);
    expect(JSON.stringify(m.events)).not.toContain(session.value);
  });

  it('refuses a wrong state, a missing state cookie and a replay, and creates no session', async () => {
    const m = await mount();
    const s = await start(m);
    const code = m.github.codeFor(ALICE);

    const wrong = await callback(m, { code, state: 'x'.repeat(s.state.length) }, s.cookie);
    expect(wrong.headers.get('location')).toBe('/?signin=bad_state');
    const short = await callback(m, { code, state: 'x' }, s.cookie);
    expect(short.headers.get('location')).toBe('/?signin=bad_state');
    const none = await callback(m, { code, state: s.state });
    expect(none.headers.get('location')).toBe('/?signin=bad_state');
    const noState = await callback(m, { code }, s.cookie);
    expect(noState.headers.get('location')).toBe('/?signin=bad_state');
    for (const r of [wrong, short, none, noState]) {
      expect(setCookieOf(r, RELAY_SESSION_COOKIE)).toBeNull();
      expect(setCookieOf(r, STATE_COOKIE)!.raw).toContain('Max-Age=0');
    }
    await noSession(m);

    // The code was never used: a correct call works once, its replay (state cookie cleared by the browser) fails.
    const ok = await callback(m, { code, state: s.state }, s.cookie);
    expect(ok.headers.get('location')).toBe('/?signin=ok');
    const replay = await callback(m, { code, state: s.state });
    expect(replay.headers.get('location')).toBe('/?signin=bad_state');
    expect(setCookieOf(replay, RELAY_SESSION_COOKIE)).toBeNull();

    await m.stop();
    expect(m.events.filter((e) => e.ev === 'sign_in')).toHaveLength(1);
    expect(m.events).toContainEqual({ ev: 'sign_in_refused', reason: 'bad_state', count: 5 });
  });

  it('answers denied, not_allowed and error', async () => {
    const m = await mount({ allowed: ['1'] });
    const s = await start(m);
    const denied = await callback(m, { error: 'access_denied', state: s.state }, s.cookie);
    expect(denied.headers.get('location')).toBe('/?signin=denied');
    // A bad state wins over access_denied.
    const badDenied = await callback(m, { error: 'access_denied', state: 'nope' }, s.cookie);
    expect(badDenied.headers.get('location')).toBe('/?signin=bad_state');

    const notAllowed = await signIn(m, BOB);
    expect(notAllowed.headers.get('location')).toBe('/?signin=not_allowed');
    expect(setCookieOf(notAllowed, RELAY_SESSION_COOKIE)).toBeNull();

    const s2 = await start(m);
    const code = m.github.codeFor(ALICE);
    m.github.failNext('unavailable');
    const failed = await callback(m, { code, state: s2.state }, s2.cookie);
    expect(failed.headers.get('location')).toBe('/?signin=error');
    expect(setCookieOf(failed, RELAY_SESSION_COOKIE)).toBeNull();
    await noSession(m);

    await m.stop();
    for (const reason of ['denied', 'bad_state', 'not_allowed', 'github'] as const) {
      expect(m.events).toContainEqual({ ev: 'sign_in_refused', reason, count: 1 });
    }
  });

  it('keeps the device peer on a second sign-in and revokes the old token', async () => {
    const m = await mount();
    const first = setCookieOf(await signIn(m), RELAY_SESSION_COOKIE)!;
    const peer1 = (await (await fetch(`${m.base}/auth/me`, { headers: { cookie: first.pair } })).json() as { peer: string }).peer;
    const second = setCookieOf(await signIn(m, ALICE, first.pair), RELAY_SESSION_COOKIE)!;
    expect(second.value).not.toBe(first.value);
    const me2 = await fetch(`${m.base}/auth/me`, { headers: { cookie: second.pair } });
    expect((await me2.json() as { peer: string }).peer).toBe(peer1);
    expect((await fetch(`${m.base}/auth/me`, { headers: { cookie: first.pair } })).status).toBe(401);

    // A session of another account, or a PC session, does not lend its peer.
    const bob = setCookieOf(await signIn(m, BOB), RELAY_SESSION_COOKIE)!;
    const bobPeer = (await (await fetch(`${m.base}/auth/me`, { headers: { cookie: bob.pair } })).json() as { peer: string }).peer;
    const alice3 = setCookieOf(await signIn(m, ALICE, bob.pair), RELAY_SESSION_COOKIE)!;
    const p3 = (await (await fetch(`${m.base}/auth/me`, { headers: { cookie: alice3.pair } })).json() as { peer: string }).peer;
    expect(p3).not.toBe(bobPeer);
    expect((await fetch(`${m.base}/auth/me`, { headers: { cookie: bob.pair } })).status).toBe(200);

    const pcToken = newSessionToken();
    await store.createSession(hashToken(pcToken), { accountId: '1', login: 'alice', peer: 'pc', kind: 'pc' });
    const alice4 = setCookieOf(await signIn(m, ALICE, `${RELAY_SESSION_COOKIE}=${pcToken}`), RELAY_SESSION_COOKIE)!;
    const p4 = (await (await fetch(`${m.base}/auth/me`, { headers: { cookie: alice4.pair } })).json() as { peer: string }).peer;
    expect(p4).toMatch(/^d_/);
    expect((await fetch(`${m.base}/auth/me`, { headers: { cookie: `${RELAY_SESSION_COOKIE}=${pcToken}` } })).status).toBe(200);
  });

  it('sets Secure exactly when publicUrl is https', async () => {
    const m = await mount({ publicUrl: 'https://relay.example' });
    const s = await manual(`${m.base}/auth/github/start`);
    expect(setCookieOf(s, STATE_COOKIE)!.raw).toContain('Secure');
    expect(new URL(s.headers.get('location')!).searchParams.get('redirect_uri')).toBe('https://relay.example/auth/github/callback');
    const res = await signIn(m);
    expect(res.headers.get('location')).toBe('/?signin=ok');
    expect(setCookieOf(res, RELAY_SESSION_COOKIE)!.raw).toContain('Secure');
    expect(setCookieOf(res, STATE_COOKIE)!.raw).toContain('Secure');
  });

  it('keeps accounts apart: a phone of alice cannot reach the PC of account 2', async () => {
    const m = await mount();
    const phone = setCookieOf(await signIn(m, ALICE), RELAY_SESSION_COOKIE)!;
    const pcToken = newSessionToken();
    await store.createSession(hashToken(pcToken), { accountId: '2', login: 'bob', peer: 'pc', kind: 'pc' });
    const pc = new WebSocket(m.ws, { headers: { authorization: `Bearer ${pcToken}` } });
    pc.once('error', () => {});
    const pcBox = inbox(pc);
    await pcBox.next(1);
    const ph = new WebSocket(m.ws, { headers: { cookie: phone.pair, origin: m.base } });
    ph.once('error', () => {});
    const phBox = inbox(ph);
    await phBox.next(1);
    ph.send(JSON.stringify({ type: 'send', to: 'pc', body: 'x' }));
    expect(await phBox.next(2)).toEqual({ type: 'error', code: 'offline', to: 'pc' });
    await new Promise((r) => setTimeout(r, 50));
    await expect(Promise.race([pcBox.next(2), new Promise((r) => setTimeout(() => r('nothing'), 100))])).resolves.toBe('nothing');
    ph.close();
    pc.close();
  });
});
