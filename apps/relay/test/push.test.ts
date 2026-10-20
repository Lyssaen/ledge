import { PGlite } from '@electric-sql/pglite';
import { createPublicKey, generateKeyPairSync, verify, type KeyObject } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PushSendResultSchema, RELAY_SESSION_COOKIE, type PushSend } from '@ledge/protocol';
import { accountsAuthenticator, type AccountsDeps } from '../src/accounts.js';
import type { RelayLogEvent } from '../src/log.js';
import { sendPush, type PushFetch, type Vapid } from '../src/push.js';
import { authRoutes } from '../src/routes.js';
import { createRelay } from '../src/server.js';
import { Store } from '../src/store.js';
import { hashToken, newDevicePeer, newSessionToken } from '../src/tokens.js';
import { fakeGitHub } from './fakeGithub.js';

function makeVapid(): Vapid {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = privateKey.export({ format: 'jwk' });
  const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]).toString('base64url');
  return { publicKey, privateKey, subject: 'mailto:ops@example.com' };
}
const publicOf = (v: Vapid): KeyObject => createPublicKey({
  key: { kty: 'EC', crv: 'P-256', x: Buffer.from(v.publicKey, 'base64url').subarray(1, 33).toString('base64url'), y: Buffer.from(v.publicKey, 'base64url').subarray(33).toString('base64url') },
  format: 'jwk'
});

const BODY_BYTES = Buffer.from('encrypted-aes128gcm-record-ÿ\u0000\u0001');
const MSG: PushSend = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/secret-subscription-id',
  body: BODY_BYTES.toString('base64url'),
  ttl: 3600, urgency: 'high', topic: 'sess_1'
};
const NOW = Date.UTC(2026, 9, 20, 10, 0, 0);

interface Call { url: string; init: RequestInit & { headers: Record<string, string> } }
function fakeFetch(respond: (c: Call) => Response | Promise<Response>): PushFetch & { calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (url: string, init: Call['init']) => { const c = { url, init }; calls.push(c); return respond(c); }) as PushFetch & { calls: Call[] };
  f.calls = calls;
  return f;
}
const status = (n: number) => new Response(null, { status: n });

describe('sendPush', () => {
  it('sends the body untouched with the VAPID headers, and reports sent', async () => {
    const vapid = makeVapid();
    const f = fakeFetch(() => status(201));
    expect(await sendPush(f, vapid, MSG, () => NOW)).toEqual({ result: 'sent', status: 201 });
    const { url, init } = f.calls[0]!;
    expect(url).toBe(MSG.endpoint);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(Buffer.from(init.body as Uint8Array).equals(BODY_BYTES)).toBe(true);
    expect(init.headers).toMatchObject({ 'Content-Encoding': 'aes128gcm', TTL: '3600', Urgency: 'high', Topic: 'sess_1' });
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(init.headers.Authorization ?? '');
    expect(m).not.toBeNull();
    expect(m![4]).toBe(vapid.publicKey);
    const sig = Buffer.from(m![3]!, 'base64url');
    expect(sig.length).toBe(64);
    expect(verify('sha256', Buffer.from(`${m![1]}.${m![2]}`), { key: publicOf(vapid), dsaEncoding: 'ieee-p1363' }, sig)).toBe(true);
    expect(JSON.parse(Buffer.from(m![1]!, 'base64url').toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
    const claims = JSON.parse(Buffer.from(m![2]!, 'base64url').toString());
    expect(claims.aud).toBe('https://fcm.googleapis.com');
    expect(claims.sub).toBe('mailto:ops@example.com');
    expect(claims.exp).toBeGreaterThan(NOW / 1000);
    expect(claims.exp).toBeLessThanOrEqual(NOW / 1000 + 12 * 3600);
  });

  it('maps statuses: 404 and 410 gone, others failed', async () => {
    const vapid = makeVapid();
    expect(await sendPush(fakeFetch(() => status(410)), vapid, MSG, () => NOW)).toEqual({ result: 'gone', status: 410 });
    expect(await sendPush(fakeFetch(() => status(404)), vapid, MSG, () => NOW)).toEqual({ result: 'gone', status: 404 });
    expect(await sendPush(fakeFetch(() => status(500)), vapid, MSG, () => NOW)).toEqual({ result: 'failed', status: 500 });
    expect(await sendPush(fakeFetch(() => status(413)), vapid, MSG, () => NOW)).toEqual({ result: 'failed', status: 413 });
  });

  it('does not follow a redirect: a 301 is failed and nothing else is requested', async () => {
    const f = fakeFetch(() => new Response(null, { status: 301, headers: { location: 'https://evil.example/' } }));
    expect(await sendPush(f, makeVapid(), MSG, () => NOW)).toEqual({ result: 'failed', status: 301 });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.init.redirect).toBe('manual');
  });

  it('fails on a network error and on timeout', async () => {
    const vapid = makeVapid();
    expect(await sendPush(fakeFetch(() => { throw new Error('boom'); }), vapid, MSG, () => NOW)).toEqual({ result: 'failed' });
    const hang = fakeFetch(({ init }) => new Promise<Response>((_, rej) => {
      init.signal?.addEventListener('abort', () => rej(init.signal!.reason));
    }));
    expect(await sendPush(hang, vapid, MSG, () => NOW, 20)).toEqual({ result: 'failed' });
  });
});

let db: PGlite;
let store: Store;
const running: Array<() => Promise<void>> = [];
beforeAll(async () => { db = new PGlite(); store = new Store(db); await store.migrate(); }, 30_000);
afterAll(async () => { await db.close(); });
afterEach(async () => { for (const c of running.splice(0).reverse()) await c(); });

async function mount(opts: { vapid?: Vapid; fetch?: PushFetch; now?: () => number } = {}) {
  const events: RelayLogEvent[] = [];
  const log = (e: RelayLogEvent) => events.push(e);
  const deps: AccountsDeps & { github: ReturnType<typeof fakeGitHub> } = {
    store, allowed: new Set(['1', '2']), publicUrl: 'http://127.0.0.1:0', log, github: fakeGitHub()
  };
  const routes = authRoutes({
    ...deps,
    ...(opts.vapid ? { vapid: opts.vapid } : {}),
    push: { fetch: opts.fetch ?? fakeFetch(() => status(201)), ...(opts.now ? { now: opts.now } : {}) }
  });
  const relay = createRelay({ authenticator: accountsAuthenticator(deps), http: routes, log });
  await new Promise<void>((res) => relay.server.listen(0, '127.0.0.1', res));
  const base = `http://127.0.0.1:${(relay.server.address() as AddressInfo).port}`;
  deps.publicUrl = base;
  running.push(async () => { await relay.close(); routes.stop(); });
  return { base, events };
}

async function session(account: string, kind: 'pc' | 'device') {
  const token = newSessionToken();
  const peer = kind === 'pc' ? 'pc' : newDevicePeer();
  await store.upsertAccount(account, `u${account}`);
  await store.createSession(hashToken(token), { accountId: account, login: `u${account}`, peer, kind });
  return token;
}
const post = (url: string, body: unknown, headers: Record<string, string> = {}) => fetch(url, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body)
});
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

describe('GET /push/key', () => {
  it('is 404 without VAPID', async () => {
    const m = await mount();
    expect((await fetch(`${m.base}/push/key`)).status).toBe(404);
  });
  it('answers the public key', async () => {
    const vapid = makeVapid();
    const m = await mount({ vapid });
    const res = await fetch(`${m.base}/push/key`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ publicKey: vapid.publicKey });
  });
});

describe('POST /push/send', { timeout: 30_000 }, () => {
  it('sends for a PC bearer, answers the result and logs only the host', async () => {
    const f = fakeFetch(() => status(201));
    const m = await mount({ vapid: makeVapid(), fetch: f });
    const pc = await session('1', 'pc');
    const res = await post(`${m.base}/push/send`, MSG, bearer(pc));
    expect(res.status).toBe(200);
    expect(PushSendResultSchema.parse(await res.json())).toEqual({ result: 'sent', status: 201 });
    expect(Buffer.from(f.calls[0]!.init.body as Uint8Array).equals(BODY_BYTES)).toBe(true);
    expect(m.events).toContainEqual({ ev: 'push', account: '1', host: 'fcm.googleapis.com', result: 'sent', status: 201 });
    const logged = JSON.stringify(m.events);
    expect(logged).not.toContain('secret-subscription-id');
    expect(logged).not.toContain(MSG.body);
  });

  it('reports gone and failed', async () => {
    let n = 410;
    const m = await mount({ vapid: makeVapid(), fetch: fakeFetch(() => status(n)) });
    const pc = await session('1', 'pc');
    expect(await (await post(`${m.base}/push/send`, MSG, bearer(pc))).json()).toEqual({ result: 'gone', status: 410 });
    n = 500;
    expect(await (await post(`${m.base}/push/send`, MSG, bearer(pc))).json()).toEqual({ result: 'failed', status: 500 });
  });

  it('is 404 without VAPID', async () => {
    const m = await mount();
    const pc = await session('1', 'pc');
    expect((await post(`${m.base}/push/send`, MSG, bearer(pc))).status).toBe(404);
  });

  it('is 401 without a token, from a cookie, or from a device token', async () => {
    const m = await mount({ vapid: makeVapid() });
    const pc = await session('1', 'pc');
    const dev = await session('1', 'device');
    expect((await post(`${m.base}/push/send`, MSG)).status).toBe(401);
    expect((await post(`${m.base}/push/send`, MSG, { cookie: `${RELAY_SESSION_COOKIE}=${pc}`, origin: m.base })).status).toBe(401);
    expect((await post(`${m.base}/push/send`, MSG, { cookie: `${RELAY_SESSION_COOKIE}=${dev}`, origin: m.base })).status).toBe(401);
    expect((await post(`${m.base}/push/send`, MSG, bearer(dev))).status).toBe(401);
  });

  it('is 400 for a malformed body or a refused endpoint, without sending', async () => {
    const f = fakeFetch(() => status(201));
    const m = await mount({ vapid: makeVapid(), fetch: f });
    const pc = await session('1', 'pc');
    for (const endpoint of [
      'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://evil.example/x', 'https://u:p@web.push.apple.com/x'
    ]) expect((await post(`${m.base}/push/send`, { ...MSG, endpoint }, bearer(pc))).status).toBe(400);
    expect((await post(`${m.base}/push/send`, { ...MSG, ttl: 1e9 }, bearer(pc))).status).toBe(400);
    expect((await post(`${m.base}/push/send`, { ...MSG, body: 'not base64url!' }, bearer(pc))).status).toBe(400);
    expect((await post(`${m.base}/push/send`, '{' as unknown, bearer(pc))).status).toBe(400);
    expect(f.calls).toHaveLength(0);
  });

  it('takes a full 4 096-byte record', async () => {
    const f = fakeFetch(() => status(201));
    const m = await mount({ vapid: makeVapid(), fetch: f });
    const pc = await session('1', 'pc');
    const body = Buffer.alloc(4_096, 7).toString('base64url');
    expect((await post(`${m.base}/push/send`, { ...MSG, body }, bearer(pc))).status).toBe(200);
  });

  it('answers 429 from the 121st send of the minute, per account, and recovers', async () => {
    let t = NOW;
    const f = fakeFetch(() => status(201));
    const m = await mount({ vapid: makeVapid(), fetch: f, now: () => t });
    const pc = await session('1', 'pc');
    for (let i = 0; i < 120; i++) expect((await post(`${m.base}/push/send`, MSG, bearer(pc))).status).toBe(200);
    expect((await post(`${m.base}/push/send`, MSG, bearer(pc))).status).toBe(429);
    expect(f.calls).toHaveLength(120);
    expect(m.events).toContainEqual({ ev: 'push', account: '1', host: 'fcm.googleapis.com', result: 'refused' });
    const other = await session('2', 'pc');
    expect((await post(`${m.base}/push/send`, MSG, bearer(other))).status).toBe(200);
    t += 60_001;
    expect((await post(`${m.base}/push/send`, MSG, bearer(pc))).status).toBe(200);
  });
});
