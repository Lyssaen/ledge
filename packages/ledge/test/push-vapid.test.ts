import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { Store } from '../src/daemon/store.js';
import { startServer } from '../src/daemon/server.js';
import { DeviceStore, type MobileControl } from '../src/daemon/devices.js';
import { createPairing, type Pairing } from '../src/daemon/pairing.js';
import { startRemoteListener } from '../src/daemon/remote/listener.js';
import { startDaemon } from '../src/daemon/index.js';
import { ensureVapid, loadVapid, pushEndpointAllowed } from '../src/daemon/push/vapid.js';
import type { MobileConfig } from '../src/mobile/config.js';
import type { Tmux } from '../src/tmux.js';
import { createSoftAuthenticator } from './soft-authenticator.js';

const origin = 'https://pc.t.ts.net';
const cfg: MobileConfig = { origin, rpID: 'pc.t.ts.net' };
const CODE = '482913';
const cred = { id: 'c', publicKey: 'pk', counter: 0 };
const sub = { endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: 'p', auth: 'a' } };

const tmux: Tmux = {
  async newSession() {}, async sendText() {}, async sendKeys() {}, async capture() { return ''; }, async hasSession() { return true; },
  async listSessions() { return []; }, async setOption() {}, async killSession() {}, attachArgs: n => ['attach', n]
};

function phone(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/m/ws`, { origin });
  const got: any[] = []; let read = 0;
  ws.on('message', d => got.push(JSON.parse(String(d))));
  ws.on('error', () => {});
  const opened = new Promise<void>(res => ws.once('open', () => res()));
  return {
    ws,
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
const settle = () => new Promise(r => setTimeout(r, 50));
const freePort = () => new Promise<number>(res => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address() as { port: number }; s.close(() => res(port)); }); });

describe('VAPID keys', () => {
  let home: string;
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'ledge-vapid-')); process.env.LEDGE_HOME = home; });

  it('are made once, kept for good, readable by the owner only', async () => {
    const path = join(home, 'vapid.json');
    expect(await loadVapid(path)).toBeNull();
    const [a, b] = await Promise.all([ensureVapid(origin, path), ensureVapid(origin, path)]);
    expect(b).toEqual(a);
    expect(a.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(a.subject).toBe(origin);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(await ensureVapid(origin, path)).toEqual(a);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(a);
  });
  it('keep their pair when the origin changes, only the subject follows', async () => {
    const path = join(home, 'vapid.json');
    const a = await ensureVapid(origin, path);
    const b = await ensureVapid('https://other.t.ts.net', path);
    expect(b).toEqual({ ...a, subject: 'https://other.t.ts.net' });
  });
  it('are made again over an unreadable file', async () => {
    const path = join(home, 'vapid.json');
    writeFileSync(path, 'not json');
    expect(await loadVapid(path)).toBeNull();
    expect((await ensureVapid(origin, path)).publicKey).toBeTruthy();
  });
  it('are created at the first pairing', async () => {
    const devices = new DeviceStore({ path: join(home, 'devices.json') });
    const pairing = createPairing({ config: () => cfg, devices, randomCode: () => CODE });
    expect(await loadVapid()).toBeNull();
    pairing.begin();
    const a = createSoftAuthenticator(cfg);
    const { options } = await pairing.options(CODE);
    expect(await loadVapid()).toBeNull();
    await pairing.complete(CODE, 'iPhone', a.register(options));
    const v = await loadVapid();
    expect(v?.subject).toBe(origin);
    expect(statSync(join(home, 'vapid.json')).mode & 0o777).toBe(0o600);
  });
});

describe('push endpoints', () => {
  it('only the known push services are allowed', () => {
    for (const e of ['https://web.push.apple.com/x', 'https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://db5p.notify.windows.com/x']) expect(pushEndpointAllowed(e)).toBe(true);
    for (const e of ['https://attacker.example/x', 'http://web.push.apple.com/x', 'https://push.apple.com.evil.example/x', 'https://evilfcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://web.push.apple.com:8443/x', 'nope']) expect(pushEndpointAllowed(e)).toBe(false);
  });
});

describe('push over the remote entry', () => {
  let home: string; let devices: DeviceStore; let pairing: Pairing;
  let srv: Awaited<ReturnType<typeof startServer>>; let remote: Awaited<ReturnType<typeof startRemoteListener>>;

  async function up() {
    const mobile: MobileControl = { devices, pairing, state: () => ({ origin, listening: true }), configure: async () => {} };
    srv = await startServer({ store: new Store(), tmux, port: 0, launcher: ['node', 'x'], agentEnv: async () => process.env, mobile });
    remote = await startRemoteListener({ server: srv, config: cfg, devices, pairing, port: 0, staticDir: join(home, 'pwa'), pcName: 'pc' });
  }
  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'ledge-push-'));
    process.env.LEDGE_HOME = home;
    mkdirSync(join(home, 'pwa'));
    devices = new DeviceStore({ path: join(home, 'devices.json') });
    pairing = createPairing({ config: () => cfg, devices, randomCode: () => CODE });
  });
  afterEach(async () => { await remote?.close(); await srv?.close(); });

  const login = async () => {
    const { device, token } = await devices.create('iPhone', cred);
    const p = phone(remote.port);
    await p.send({ type: 'auth', token });
    return { p, device, hello: await p.next('auth.ok') };
  };

  it('auth.ok carries no key before keys exist, and the public key once they do', async () => {
    await up();
    expect((await login()).hello.vapidPublicKey).toBeUndefined();
    const v = await ensureVapid(origin);
    await remote.close(); await srv.close(); await up();
    expect((await login()).hello.vapidPublicKey).toBe(v.publicKey);
  });

  it('stores the subscription on the device and removes it on unsubscribe', async () => {
    await up();
    const { p, device } = await login();
    await p.send({ type: 'push.subscribe', subscription: sub });
    await settle();
    expect(devices.get(device.id)?.push).toEqual(sub);
    expect(JSON.parse(readFileSync(join(home, 'devices.json'), 'utf8')).devices[0].push).toEqual(sub);
    const next = { ...sub, endpoint: 'https://fcm.googleapis.com/fcm/send/new' };
    await p.send({ type: 'push.subscribe', subscription: next });
    await settle();
    expect(devices.get(device.id)?.push).toEqual(next);
    await p.send({ type: 'push.unsubscribe' });
    await settle();
    expect(devices.get(device.id)?.push).toBeUndefined();
  });

  it('refuses a subscription outside the known push services and stores nothing', async () => {
    await up();
    const { p, device } = await login();
    await p.send({ type: 'push.subscribe', subscription: { ...sub, endpoint: 'https://attacker.example/x' } });
    expect(await p.next('error')).toMatchObject({ message: 'unsupported push service' });
    expect(devices.get(device.id)?.push).toBeUndefined();
  });

  it('the subscription of a revoked device goes with it', async () => {
    await up();
    const { device } = await login();
    await devices.setPush(device.id, sub);
    await devices.revoke(device.id);
    expect(devices.get(device.id)).toBeUndefined();
  });
});

describe('daemon wiring', () => {
  it('makes the keys at startup when a phone is already paired, so its next auth.ok carries the public key', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ledge-push-'));
    process.env.LEDGE_HOME = home;
    writeFileSync(join(home, 'mobile.json'), JSON.stringify(cfg));
    const seed = new DeviceStore({ path: join(home, 'devices.json') });
    const { token } = await seed.create('iPhone', cred);
    expect(await loadVapid()).toBeNull();
    const remotePort = await freePort();
    const d = await startDaemon({ port: 0, remotePort, tmux });
    try {
      const v = await loadVapid();
      expect(v?.subject).toBe(origin);
      const p = phone(remotePort);
      await p.send({ type: 'auth', token });
      expect((await p.next('auth.ok')).vapidPublicKey).toBe(v!.publicKey);
    } finally { await d.stop(); }
  });
  it('makes no keys at startup while no phone is paired', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ledge-push-'));
    process.env.LEDGE_HOME = home;
    writeFileSync(join(home, 'mobile.json'), JSON.stringify(cfg));
    const d = await startDaemon({ port: 0, remotePort: await freePort(), tmux });
    try { expect(await loadVapid()).toBeNull(); } finally { await d.stop(); }
  });
});
