import { PGlite } from '@electric-sql/pglite';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  DevicePollResponseSchema,
  DeviceStartResponseSchema,
  MeResponseSchema,
  parseRelayServerMessage,
  RELAY_SESSION_COOKIE,
  type RelayServerMessage
} from '@ledge/protocol';
import { accountsAuthenticator, type AccountsDeps } from '../src/accounts.js';
import { RELAY_PROTOCOL_PREFIX } from '../src/auth.js';
import type { RelayLogEvent } from '../src/log.js';
import { authRoutes } from '../src/routes.js';
import { createRelay } from '../src/server.js';
import { Store } from '../src/store.js';
import { hashToken, newDevicePeer, newSessionToken } from '../src/tokens.js';
import { FAKE_ACCESS_PREFIX, fakeGitHub } from './fakeGithub.js';

const ALICE = { id: '1', login: 'alice' };
const BOB = { id: '2', login: 'bob' };

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
  /** Closes the relay and flushes the aggregated sign-in refusals into `events`. */
  stop(): Promise<void>;
}

async function mount(opts: { allowed?: string[]; maxGitHubCalls?: number; github?: ReturnType<typeof fakeGitHub> } = {}): Promise<Mounted> {
  const events: RelayLogEvent[] = [];
  const log = (e: RelayLogEvent) => events.push(e);
  const github = opts.github ?? fakeGitHub();
  // The port is known only after listen: publicUrl is filled in before any request.
  const deps: AccountsDeps & { github: typeof github; maxGitHubCalls?: number } = {
    store, allowed: new Set(opts.allowed ?? ['1', '2']), publicUrl: 'http://127.0.0.1:0', log, github,
    ...(opts.maxGitHubCalls !== undefined ? { maxGitHubCalls: opts.maxGitHubCalls } : {})
  };
  const routes = authRoutes(deps);
  const relay = createRelay({ authenticator: accountsAuthenticator(deps), http: routes, log });
  await new Promise<void>((res) => relay.server.listen(0, '127.0.0.1', res));
  const port = (relay.server.address() as AddressInfo).port;
  deps.publicUrl = `http://127.0.0.1:${port}`;
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await relay.close();
    routes.stop();
  };
  running.push(stop);
  return { base: deps.publicUrl, ws: `ws://127.0.0.1:${port}/ws`, events, github, stop };
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
const refused = (ws: WebSocket) => new Promise<number>((res) => {
  ws.once('unexpected-response', (_req, r) => { r.resume(); res(r.statusCode ?? 0); });
  ws.once('error', () => {});
});
const closed = (ws: WebSocket) => new Promise<number>((res) => ws.once('close', (code) => res(code)));

async function welcome(ws: WebSocket) {
  const box = inbox(ws);
  ws.once('error', () => {});
  return box.next(1);
}

const post = (url: string, body?: unknown, headers: Record<string, string> = {}) => fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {})
});

async function deviceStart(m: Mounted) {
  const res = await post(`${m.base}/auth/device/start`);
  expect(res.status).toBe(200);
  return DeviceStartResponseSchema.parse(await res.json());
}
async function devicePoll(m: Mounted, deviceCode: string) {
  const res = await post(`${m.base}/auth/device/poll`, { deviceCode });
  expect(res.status).toBe(200);
  return DevicePollResponseSchema.parse(await res.json());
}
/** A full device flow; returns the PC session token. */
async function signInPc(m: Mounted, user = ALICE): Promise<string> {
  const { deviceCode } = await deviceStart(m);
  m.github.approve(deviceCode, user);
  const r = await devicePoll(m, deviceCode);
  if (r.status !== 'ok') throw new Error(`poll gave ${r.status}`);
  return r.token;
}
const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

describe('accounts', { timeout: 30_000 }, () => {
  it('signs a PC in by device flow; the token opens /ws as bearer and as subprotocol, and /auth/me names it', async () => {
    const m = await mount();
    const { deviceCode, userCode, verificationUri, interval } = await deviceStart(m);
    expect(userCode).not.toBe('');
    expect(verificationUri).not.toBe('');
    expect(interval).toBeGreaterThan(0);
    expect(await devicePoll(m, deviceCode)).toEqual({ status: 'pending' });
    m.github.approve(deviceCode, ALICE);
    const r = await devicePoll(m, deviceCode);
    expect(r).toMatchObject({ status: 'ok', accountId: '1', login: 'alice' });
    const token = (r as Extract<typeof r, { status: 'ok' }>).token;

    const ws1 = new WebSocket(m.ws, bearer(token));
    expect(await welcome(ws1)).toEqual({ type: 'welcome', accountId: '1', self: 'pc', online: [] });
    const replaced = closed(ws1);
    const ws2 = new WebSocket(m.ws, [`${RELAY_PROTOCOL_PREFIX}${token}`]);
    expect(await welcome(ws2)).toMatchObject({ type: 'welcome', accountId: '1', self: 'pc' });
    expect(await replaced).toBe(4000);
    ws2.close();

    const me = await fetch(`${m.base}/auth/me`, bearer(token));
    expect(me.status).toBe(200);
    expect(MeResponseSchema.parse(await me.json())).toEqual({ accountId: '1', login: 'alice', peer: 'pc', kind: 'pc' });
  });

  it('answers denied, not_allowed (with nothing stored) and 502 on a GitHub failure', async () => {
    const m = await mount();
    const a = await deviceStart(m);
    m.github.deny(a.deviceCode);
    expect(await devicePoll(m, a.deviceCode)).toEqual({ status: 'denied' });

    const b = await deviceStart(m);
    m.github.approve(b.deviceCode, { id: '9', login: 'mallory' });
    expect(await devicePoll(m, b.deviceCode)).toEqual({ status: 'not_allowed' });
    expect((await db.query('SELECT 1 FROM accounts WHERE github_id = 9')).rows).toEqual([]);
    expect((await db.query('SELECT 1 FROM sessions WHERE account_id = 9')).rows).toEqual([]);

    const c = await deviceStart(m);
    m.github.failNext('unavailable');
    const res = await post(`${m.base}/auth/device/poll`, { deviceCode: c.deviceCode });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'github' });
    m.github.failNext('rejected');
    const s = await post(`${m.base}/auth/device/start`);
    expect(s.status).toBe(502);
    expect(await s.json()).toEqual({ error: 'github' });
  });

  it('answers expired for an unknown device code', async () => {
    const m = await mount();
    expect(await devicePoll(m, 'nope')).toEqual({ status: 'expired' });
  });

  it('answers 400 to an invalid poll body, 413 past 4 KiB, and lets unknown /auth paths 404', async () => {
    const m = await mount();
    expect((await post(`${m.base}/auth/device/poll`, '{not json')).status).toBe(400);
    const bad = await post(`${m.base}/auth/device/poll`, { deviceCode: 42 });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'bad_request' });
    const big = await post(`${m.base}/auth/device/poll`, { deviceCode: 'x'.repeat(5000) });
    expect(big.status).toBe(413);
    expect(await big.json()).toEqual({ error: 'too_large' });
    expect((await fetch(`${m.base}/auth/nope`)).status).toBe(404);
  });

  it('keeps one PC per account: a second sign-in closes the first socket with 4001 and voids its token', async () => {
    const m = await mount();
    const first = await signInPc(m);
    const ws1 = new WebSocket(m.ws, bearer(first));
    expect(await welcome(ws1)).toMatchObject({ self: 'pc' });
    const gone = closed(ws1);
    const second = await signInPc(m);
    expect(await gone).toBe(4001);
    expect(await refused(new WebSocket(m.ws, bearer(first)))).toBe(401);
    const ws2 = new WebSocket(m.ws, bearer(second));
    expect(await welcome(ws2)).toMatchObject({ accountId: '1', self: 'pc' });
    ws2.close();
  });

  it('rechecks the allow-list at every authentication', async () => {
    const before = await mount();
    const token = await signInPc(before, BOB);
    await before.stop();
    const m = await mount({ allowed: ['1'] });
    expect(await refused(new WebSocket(m.ws, bearer(token)))).toBe(401);
    const me = await fetch(`${m.base}/auth/me`, bearer(token));
    expect(me.status).toBe(401);
    expect(await me.json()).toEqual({ error: 'unauthorized' });
  });

  it('accepts a cookie session only with the relay Origin', async () => {
    const m = await mount();
    const token = newSessionToken();
    const peer = newDevicePeer();
    await store.upsertAccount('1', 'alice');
    await store.createSession(hashToken(token), { accountId: '1', login: 'alice', peer, kind: 'device' });
    const cookie = `other=1; ${RELAY_SESSION_COOKIE}=${token}`;

    const ok = new WebSocket(m.ws, { headers: { cookie, origin: m.base } });
    expect(await welcome(ok)).toMatchObject({ type: 'welcome', accountId: '1', self: peer });
    ok.close();
    expect(await refused(new WebSocket(m.ws, { headers: { cookie, origin: 'https://evil.example' } }))).toBe(401);
    expect(await refused(new WebSocket(m.ws, { headers: { cookie } }))).toBe(401);

    // A GET of /auth/me does not check Origin.
    const me = await fetch(`${m.base}/auth/me`, { headers: { cookie } });
    expect(await me.json()).toEqual({ accountId: '1', login: 'alice', peer, kind: 'device' });
  });

  it('logs out by bearer: 204, the PC socket closes with 4001, the token is void', async () => {
    const m = await mount();
    const token = await signInPc(m);
    const ws = new WebSocket(m.ws, bearer(token));
    expect(await welcome(ws)).toMatchObject({ self: 'pc' });
    const gone = closed(ws);
    const res = await post(`${m.base}/auth/logout`, undefined, bearer(token).headers);
    expect(res.status).toBe(204);
    expect(await gone).toBe(4001);
    expect(await refused(new WebSocket(m.ws, bearer(token)))).toBe(401);
    expect((await post(`${m.base}/auth/logout`, undefined, bearer(token).headers)).status).toBe(401);
    expect((await post(`${m.base}/auth/logout`)).status).toBe(401);
  });

  it('logs out by cookie only with the relay Origin, and clears the cookie', async () => {
    const m = await mount();
    const token = newSessionToken();
    const peer = newDevicePeer();
    await store.upsertAccount('1', 'alice');
    await store.createSession(hashToken(token), { accountId: '1', login: 'alice', peer, kind: 'device' });
    const cookie = `${RELAY_SESSION_COOKIE}=${token}`;

    const evil = await post(`${m.base}/auth/logout`, undefined, { cookie, origin: 'https://evil.example' });
    expect(evil.status).toBe(401);
    expect((await fetch(`${m.base}/auth/me`, { headers: { cookie } })).status).toBe(200);

    const ws = new WebSocket(m.ws, { headers: { cookie, origin: m.base } });
    expect(await welcome(ws)).toMatchObject({ self: peer });
    const gone = closed(ws);
    const res = await post(`${m.base}/auth/logout`, undefined, { cookie, origin: m.base });
    expect(res.status).toBe(204);
    const set = res.headers.get('set-cookie') ?? '';
    expect(set).toContain(`${RELAY_SESSION_COOKIE}=;`);
    expect(set).toContain('Max-Age=0');
    expect(set).toContain('HttpOnly');
    expect(set).toContain('SameSite=Lax');
    expect(set).not.toContain('Secure');
    expect(await gone).toBe(4001);
    expect((await fetch(`${m.base}/auth/me`, { headers: { cookie } })).status).toBe(401);
  });

  it('never logs a session token, a device code, a GitHub token or the login', async () => {
    const m = await mount();
    const secrets: string[] = [];
    const a = await deviceStart(m);
    secrets.push(a.deviceCode, a.userCode);
    m.github.approve(a.deviceCode, ALICE);
    const r = await devicePoll(m, a.deviceCode);
    if (r.status !== 'ok') throw new Error('expected ok');
    secrets.push(r.token);
    const ws = new WebSocket(m.ws, bearer(r.token));
    await welcome(ws);
    const gone = closed(ws);
    expect((await post(`${m.base}/auth/logout`, undefined, bearer(r.token).headers)).status).toBe(204);
    await gone;

    const b = await deviceStart(m);
    secrets.push(b.deviceCode);
    m.github.deny(b.deviceCode);
    await devicePoll(m, b.deviceCode);
    const c = await deviceStart(m);
    secrets.push(c.deviceCode);
    m.github.approve(c.deviceCode, { id: '9', login: 'mallory' });
    await devicePoll(m, c.deviceCode);
    m.github.failNext('unavailable');
    await post(`${m.base}/auth/device/start`);
    await m.stop();

    const text = m.events.map((e) => JSON.stringify(e)).join('\n');
    for (const s of [...secrets, 'alice', 'mallory', FAKE_ACCESS_PREFIX]) expect(text).not.toContain(s);
    expect(m.events).toContainEqual({ ev: 'sign_in', account: '1', peer: 'pc', kind: 'pc' });
    expect(m.events).toContainEqual({ ev: 'sign_out', account: '1', peer: 'pc' });
    for (const reason of ['denied', 'not_allowed', 'github'] as const) {
      expect(m.events).toContainEqual({ ev: 'sign_in_refused', reason, count: 1 });
    }
  });

  it('answers 503 busy past maxGitHubCalls in flight', async () => {
    const github = fakeGitHub();
    const m = await mount({ maxGitHubCalls: 1, github });
    const hold = github.holdDeviceStart();
    const first = post(`${m.base}/auth/device/start`);
    await hold.reached;
    const second = await post(`${m.base}/auth/device/start`);
    expect(second.status).toBe(503);
    expect(await second.json()).toEqual({ error: 'busy' });
    hold.release();
    expect((await first).status).toBe(200);
    expect((await post(`${m.base}/auth/device/start`)).status).toBe(200);
  });
});
