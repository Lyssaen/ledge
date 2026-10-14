import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import type { Session } from '@ledge/protocol';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import { DeviceStore, type MobileControl } from '../src/daemon/devices.js';
import { createPairing, type Pairing } from '../src/daemon/pairing.js';
import { startRemoteListener } from '../src/daemon/remote/listener.js';
import { startDaemon } from '../src/daemon/index.js';
import type { MobileConfig } from '../src/mobile/config.js';
import type { Tmux } from '../src/tmux.js';
import { connect } from '../src/client.js';
import { createSoftAuthenticator } from './soft-authenticator.js';

const origin = 'https://pc.t.ts.net';
const cfg: MobileConfig = { origin, rpID: 'pc.t.ts.net' };
const CODE = '482913';
const T0 = '2026-10-14T18:00:00.000Z';
const cred = { id: 'c', publicKey: 'pk', counter: 0 };
const mk = (id: string, extra: Partial<Session> = {}): Session => ({
  id, name: 'Otto', tool: 'claude', cwd: '/w/harness-assistant', project: 'harness-assistant', title: 'Otto · harness-assistant',
  tmuxSession: `ledge-${id}`, state: 'working', helpers: [], startedAt: T0, lastActivityAt: T0, source: 'launcher', ...extra
});

function fakeTmux(): Tmux & { sent: string[][] } {
  const sent: string[][] = [];
  return {
    sent,
    async newSession() {}, async sendText(n, t) { sent.push(['text', n, t]); }, async sendKeys(n, k) { sent.push(['keys', n, ...k]); },
    async capture() { return ''; }, async hasSession() { return true; }, async listSessions() { return []; },
    async setOption() {}, async killSession(n) { sent.push(['kill', n]); }, attachArgs: n => ['attach', n]
  };
}

/** A phone socket: every message it receives is kept, `closed` resolves with the close code. */
function phone(port: number, o: { origin?: string; path?: string } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${o.path ?? '/m/ws'}`, o.origin === undefined ? {} : { origin: o.origin });
  const got: any[] = []; let read = 0;
  ws.on('message', d => got.push(JSON.parse(String(d))));
  const closed = new Promise<number>(res => ws.on('close', code => res(code)));
  ws.on('error', () => {});
  const opened = new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('unexpected-response', () => rej(new Error('refused'))); });
  return {
    ws, got, closed, opened,
    send: async (m: unknown) => { await opened; ws.send(JSON.stringify(m)); },
    async next(type: string, ms = 1500): Promise<any> {
      const end = Date.now() + ms;
      for (;;) {
        const i = got.findIndex((m, k) => k >= read && m.type === type);
        if (i >= 0) { read = i + 1; return got[i]; }
        if (Date.now() > end) throw new Error(`timeout waiting for ${type}; got ${JSON.stringify(got)}`);
        await new Promise(r => setTimeout(r, 10));
      }
    }
  };
}

function upgradeStatus(port: number, o: { origin?: string; path?: string }): Promise<number> {
  return new Promise(res => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${o.path ?? '/m/ws'}`, o.origin === undefined ? {} : { origin: o.origin });
    ws.on('unexpected-response', (_req, r) => { res(r.statusCode ?? 0); ws.terminate(); });
    ws.on('open', () => { res(101); ws.close(); });
    ws.on('error', () => {});
  });
}

const logText = () => { const p = join(process.env.LEDGE_HOME!, 'daemon.log'); return existsSync(p) ? readFileSync(p, 'utf8') : ''; };

describe('remote entry', () => {
  let home: string; let staticDir: string; let store: Store; let tmux: ReturnType<typeof fakeTmux>;
  let devices: DeviceStore; let pairing: Pairing; let srv: Awaited<ReturnType<typeof startServer>>;
  let remote: Awaited<ReturnType<typeof startRemoteListener>>; let base: string;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'ledge-remote-'));
    process.env.LEDGE_HOME = home;
    writeFileSync(join(home, 'sessions.json'), '{"secret":true}');
    staticDir = join(home, 'pwa');
    mkdirSync(join(staticDir, 'assets'), { recursive: true });
    writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>Ledge</title>');
    writeFileSync(join(staticDir, 'sw.js'), 'self.addEventListener("fetch", () => {});');
    writeFileSync(join(staticDir, 'assets', 'app-1a2b.js'), 'console.log(1)');
    store = new Store(); tmux = fakeTmux();
    devices = new DeviceStore({ path: join(home, 'devices.json') });
    pairing = createPairing({ config: () => cfg, devices, randomCode: () => CODE });
    const mobile: MobileControl = { devices, pairing, state: () => ({ origin, listening: true }), configure: async () => {} };
    srv = await startServer({ store, tmux, port: 0, launcher: ['node', 'x'], agentEnv: async () => process.env, mobile });
    remote = await startRemoteListener({ server: srv, config: cfg, devices, pairing, port: 0, staticDir, authTimeoutMs: 300, pcName: 'pc' });
    base = `http://127.0.0.1:${remote.port}`;
  });
  afterEach(async () => { await remote.close(); await srv.close(); });

  const authed = async () => {
    const { device, token } = await devices.create('iPhone', cred);
    const p = phone(remote.port, { origin });
    await p.send({ type: 'auth', token });
    await p.next('auth.ok');
    return { p, device, token };
  };

  it('serves the PWA under /m/ with security headers; 404 elsewhere; no traversal', async () => {
    const r = await fetch(`${base}/m/`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('<title>Ledge</title>');
    const csp = r.headers.get('content-security-policy');
    expect(csp).toBe("default-src 'self'; connect-src 'self' wss://pc.t.ts.net; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    expect(r.headers.get('cache-control')).toBe('no-cache');
    expect(r.headers.get('content-type')).toMatch(/^text\/html/);

    const sw = await fetch(`${base}/m/sw.js`);
    expect(sw.status).toBe(200);
    expect(sw.headers.get('cache-control')).toBe('no-cache');
    expect(sw.headers.get('service-worker-allowed')).toBe('/m/');
    expect(sw.headers.get('content-type')).toMatch(/javascript/);
    const asset = await fetch(`${base}/m/assets/app-1a2b.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toContain('immutable');

    const head = await fetch(`${base}/m/`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    const root = await fetch(`${base}/`, { redirect: 'manual' });
    expect(root.status).toBe(302);
    expect(root.headers.get('location')).toBe('/m/');

    for (const path of ['/m/..%2f..%2fsessions.json', '/m/..%2fsessions.json', '/m/%2e%2e/sessions.json', '/m/assets/..%2f..%2f..%2fsessions.json', '/m/assets', '/m/missing.js', '/m/%00', '/m/%E0%A4%A', '/api', '/sessions.json', '/m'])
      expect((await fetch(`${base}${path}`)).status, path).toBe(404);
    expect((await fetch(`${base}/m/`, { method: 'POST' })).status).toBe(404);
  });

  it('answers 503 when the PWA is not built', async () => {
    const other = await startRemoteListener({ server: srv, config: cfg, devices, pairing, port: 0, staticDir: join(home, 'nope'), pcName: 'pc' });
    try {
      const r = await fetch(`http://127.0.0.1:${other.port}/m/`);
      expect(r.status).toBe(503);
      expect(await r.text()).toBe('PWA not built');
    } finally { await other.close(); }
  });

  it('closes a silent socket with 4408', async () => {
    expect(await phone(remote.port, { origin }).closed).toBe(4408);
  });

  it('an unknown token closes with 4401 and logs the attempt without the token', async () => {
    const token = 'x'.repeat(43);
    const p = phone(remote.port, { origin });
    await p.send({ type: 'auth', token });
    expect(await p.closed).toBe(4401);
    expect(p.got).toEqual([]);
    expect(logText()).toContain('remote auth refused from 127.0.0.1');
    expect(logText()).not.toContain(token);
  });

  it('refuses a WebSocket from another Origin, without Origin, or on another path', async () => {
    expect(await upgradeStatus(remote.port, { origin: 'https://evil.example' })).toBe(403);
    expect(await upgradeStatus(remote.port, {})).toBe(403);
    expect(await upgradeStatus(remote.port, { origin, path: '/ws' })).toBe(403);
    expect(await upgradeStatus(remote.port, { origin: 'tauri://localhost' })).toBe(403);
    expect(logText()).toContain('remote upgrade refused');
    expect(logText()).toContain('"https://evil.example"');
  });

  it('an unpaired phone receives no snapshot and no session', async () => {
    store.upsert(mk('a'));
    const p = phone(remote.port, { origin });
    await p.send({ type: 'snapshot.request' });
    expect(await p.closed).toBe(4401);
    expect(p.got).toEqual([]);
  });

  it('a pre-auth message that fails its schema closes with 4401', async () => {
    srv.broadcast({ type: 'session.removed', id: 'x' });
    const p = phone(remote.port, { origin });
    await p.send({ type: 'pair.complete', code: CODE, deviceName: 'x'.repeat(61), webauthn: {} });
    expect(await p.closed).toBe(4401);
    const q = phone(remote.port, { origin });
    await q.opened; q.ws.send('not json');
    expect(await q.closed).toBe(4401);
  });

  it('pairs end to end, then authenticates and gets a projected snapshot', async () => {
    store.upsert(mk('a')); store.touchRecent('/w/harness-assistant', 'harness-assistant', T0);
    const pc = await connect({ port: srv.port }); await pc.next('snapshot');
    pc.send({ type: 'pair.begin' });
    expect(await pc.next('pair.code')).toMatchObject({ code: CODE, url: 'https://pc.t.ts.net/m/#/pair' });

    const soft = createSoftAuthenticator(cfg);
    const p = phone(remote.port, { origin });
    await p.send({ type: 'pair.options', code: CODE });
    const challenge = await p.next('pair.challenge');
    // Face ID takes longer than the auth timeout: a proven code keeps the socket open for the pairing window.
    await new Promise(r => setTimeout(r, 450));
    await p.send({ type: 'pair.complete', code: CODE, deviceName: 'iPhone de Joffrey', webauthn: soft.register(challenge.options) });
    const done = await p.next('pair.done');
    expect(done.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await p.closed).toBe(1000);
    expect(devices.get(done.deviceId)?.name).toBe('iPhone de Joffrey');
    // The overlay learns of the new device without asking.
    expect((await pc.next('devices')).devices.map((d: { id: string }) => d.id)).toEqual([done.deviceId]);
    // Pairing messages go to the phone's socket only, never to local peers.
    await expect(pc.next('pair.challenge', 100)).rejects.toThrow(/timeout/);
    await expect(pc.next('pair.done', 100)).rejects.toThrow(/timeout/);

    const again = phone(remote.port, { origin });
    await again.send({ type: 'auth', token: done.token });
    expect(await again.next('auth.ok')).toEqual({ type: 'auth.ok', deviceId: done.deviceId, deviceName: 'iPhone de Joffrey', pcName: 'pc' });
    const snap = await again.next('snapshot');
    expect(Object.keys(snap).sort()).toEqual(['sessions', 'type']);
    expect(snap.sessions).toEqual([{ ...mk('a'), tmuxSession: null }]);
    expect(again.got.map(m => m.type).slice(0, 2)).toEqual(['auth.ok', 'snapshot']);
    expect(devices.get(done.deviceId)?.lastSeenAt).toBeDefined();
    await pc.close(); again.ws.close();
  });

  it('three pairing errors on one connection close it', async () => {
    pairing.begin();
    const p = phone(remote.port, { origin });
    for (let i = 0; i < 3; i++) {
      await p.send({ type: 'pair.options', code: '000000' });
      expect(await p.next('pair.error')).toEqual({ type: 'pair.error', reason: 'invalid_code' });
    }
    expect(await p.closed).toBe(4401);
  });

  it('pair.begin without a mobile configuration answers not_configured', async () => {
    const off = createPairing({ config: () => null, devices });
    const mobile: MobileControl = { devices, pairing: off, state: () => ({ origin: null, listening: false }), configure: async () => {} };
    const s2 = await startServer({ store, tmux, port: 0, agentEnv: async () => process.env, mobile });
    try {
      const pc = await connect({ port: s2.port }); await pc.next('snapshot');
      pc.send({ type: 'pair.begin' });
      expect(await pc.next('pair.error')).toEqual({ type: 'pair.error', reason: 'not_configured' });
      await pc.close();
    } finally { await s2.close(); }
  });

  it('a revoked token closes the open socket with 4403 and cannot come back', async () => {
    const { p, device, token } = await authed();
    const pc = await connect({ port: srv.port }); await pc.next('snapshot');
    pc.send({ type: 'device.revoke', id: device.id });
    expect(await p.closed).toBe(4403);
    const back = phone(remote.port, { origin });
    await back.send({ type: 'auth', token });
    expect(await back.closed).toBe(4401);
    expect(back.got).toEqual([]);
    await pc.close();
  });

  it('over the real listener a phone may decide but not interrupt: decide reaches the checks, interrupt is forbidden', async () => {
    store.upsert(mk('a', { state: 'waiting_permission', pending: { id: 'pA', version: 1, kind: 'permission', text: 'git push --force', tool: 'Bash', source: 'hook' } }));
    const { p } = await authed();
    await p.next('snapshot');
    await p.send({ type: 'session.interrupt', id: 'a' });
    expect(await p.next('error')).toMatchObject({ message: 'forbidden' });
    await p.send({ type: 'session.decide', id: 'a', decision: 'accept', pendingId: 'pA', pendingVersion: 1, operationId: '7b1e0c1e-8d2f-4c4a-9a51-0d6f3c1b2a90' });
    expect(await p.next('operation.result')).toMatchObject({ status: 'rejected', reason: 'assertion_required' });
    expect(tmux.sent).toEqual([]);
    p.ws.close();
  });

  it('closing the listener closes its sockets, authenticated or not, and drops the remote peers', async () => {
    const { p } = await authed();
    const silent = phone(remote.port, { origin }); await silent.opened;
    await remote.close();
    expect(await p.closed).toBe(1001);
    expect(await silent.closed).toBe(1001);
    expect(srv.peers.all().filter(x => x.ctx.kind === 'remote')).toEqual([]);
  });
});

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address() as { port: number }; s.close(() => res(port)); });
  });
}

describe('daemon wiring', () => {
  it('mobile.configure starts and stops the remote entry without touching the local port', async () => {
    process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-remote-'));
    const remotePort = await freePort();
    const d = await startDaemon({ port: 0, remotePort, tmux: fakeTmux() });
    try {
      const pc = await connect({ port: d.port }); await pc.next('snapshot');
      pc.send({ type: 'devices' });
      expect(await pc.next('devices')).toMatchObject({ origin: null, listening: false });
      await expect(fetch(`http://127.0.0.1:${remotePort}/m/`)).rejects.toThrow();

      pc.send({ type: 'mobile.configure', origin });
      expect(await pc.next('devices')).toMatchObject({ origin, listening: true });
      expect((await fetch(`http://127.0.0.1:${remotePort}/`, { redirect: 'manual' })).status).toBe(302);
      expect(JSON.parse(readFileSync(join(process.env.LEDGE_HOME!, 'mobile.json'), 'utf8'))).toEqual({ origin, rpID: 'pc.t.ts.net' });
      pc.send({ type: 'pair.begin' });
      expect(await pc.next('pair.code')).toMatchObject({ url: `${origin}/m/#/pair` });

      pc.send({ type: 'mobile.configure', origin: null });
      expect(await pc.next('devices')).toMatchObject({ origin: null, listening: false });
      await expect(fetch(`http://127.0.0.1:${remotePort}/m/`)).rejects.toThrow();
      expect(existsSync(join(process.env.LEDGE_HOME!, 'mobile.json'))).toBe(false);

      pc.send({ type: 'snapshot.request' });
      await pc.next('snapshot');
      await pc.close();
    } finally { await d.stop(); }
  });

  it('starts the remote entry at startup when mobile.json is present', async () => {
    process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-remote-'));
    writeFileSync(join(process.env.LEDGE_HOME, 'mobile.json'), JSON.stringify({ origin, rpID: 'pc.t.ts.net' }));
    const remotePort = await freePort();
    const d = await startDaemon({ port: 0, remotePort, tmux: fakeTmux() });
    try {
      expect((await fetch(`http://127.0.0.1:${remotePort}/`, { redirect: 'manual' })).status).toBe(302);
    } finally { await d.stop(); }
    await expect(fetch(`http://127.0.0.1:${remotePort}/m/`)).rejects.toThrow();
  });
});
