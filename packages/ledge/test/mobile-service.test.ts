import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import WebSocket from 'ws';
import { fingerprint } from '@ledge/seal';
import type { MobileState } from '@ledge/protocol';
import { createMobileService, type MobileService } from '../src/mobile/service.js';
import { writeDevices, writeMobileConfig, writeRelaySession } from '../src/mobile/files.js';
import { paths } from '../src/paths.js';
import { startTestRelay, TEST_ACCOUNT, type TestRelay } from './mobile-relay-harness.js';
import { fakeDevice, type FakeDevice } from './mobile-fake-device.js';

const DEVICE_CODE = 'dc-secret-0123456789';
const USER_CODE = 'WDJB-MJHT';
const PEER = 'd_aaaaaaaaaaaaaaaa';

async function until(cond: () => boolean, what = 'condition'): Promise<void> {
  const deadline = Date.now() + 4000;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

/** A simulated clock: `schedule` only fires on `advance`. */
function fakeClock() {
  let t = Date.parse('2026-10-19T08:00:00.000Z');
  let timers: Array<{ at: number; fn: () => void }> = [];
  return {
    now: () => t,
    schedule(fn: () => void, ms: number) {
      const e = { at: t + ms, fn };
      timers.push(e);
      return () => { timers = timers.filter((x) => x !== e); };
    },
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const due = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((x) => x !== due);
        t = due.at;
        due.fn();
      }
      t = end;
    }
  };
}

const json = (res: ServerResponse, body: unknown) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const readBody = async (req: IncomingMessage): Promise<unknown> => {
  let s = '';
  for await (const c of req) s += String(c);
  return s ? JSON.parse(s) : undefined;
};

const cleanups: Array<() => Promise<void> | void> = [];
beforeEach(() => { process.env.LEDGE_HOME = mkdtempSync(join(tmpdir(), 'ledge-mobile-service-')); });
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });

/** The real relay, with /auth/device/* and /auth/devices/revoke simulated through its `auth` extension point. */
async function relayWithAuth() {
  const calls = { revoked: [] as Array<{ peer: string; bearer: string }>, polls: 0 };
  /** The poll answers `pending` until the test lets it through. */
  const gate = { allow: false, kick: true };
  let relay!: TestRelay;
  relay = await startTestRelay({
    auth: async (req, res, control) => {
      const path = new URL(req.url ?? '/', 'http://relay').pathname;
      if (req.method !== 'POST') return false;
      if (path === '/auth/device/start') {
        json(res, { deviceCode: DEVICE_CODE, userCode: USER_CODE, verificationUri: 'https://github.com/login/device', expiresIn: 900, interval: 1 });
        return true;
      }
      if (path === '/auth/device/poll') {
        calls.polls++;
        const body = (await readBody(req)) as { deviceCode?: string };
        if (body.deviceCode !== DEVICE_CODE) { res.writeHead(400).end(); return true; }
        json(res, gate.allow ? { status: 'ok', token: relay.pcToken, accountId: TEST_ACCOUNT, login: 'octocat' } : { status: 'pending' });
        return true;
      }
      if (path === '/auth/devices/revoke') {
        const { peer } = (await readBody(req)) as { peer: string };
        calls.revoked.push({ peer, bearer: String(req.headers.authorization ?? '') });
        if (gate.kick) control.kick(TEST_ACCOUNT, peer as `d_${string}`, 4001, 'signed_out');
        json(res, { revoked: 1 });
        return true;
      }
      return false;
    }
  });
  cleanups.push(() => relay.relay.close());
  return { relay, calls, gate };
}

async function service(opts: Parameters<typeof createMobileService>[0] = {}): Promise<MobileService> {
  const s = await createMobileService({ sleep: () => new Promise((r) => setTimeout(r, 10)), ...opts });
  cleanups.push(() => s.stop());
  return s;
}

/** Enabled and signed in through the simulated device flow, link online. */
async function signedIn() {
  const r = await relayWithAuth();
  const s = await service();
  await s.handle({ type: 'mobile.set', enabled: true, relayUrl: r.relay.url });
  await s.handle({ type: 'mobile.signin' });
  await until(() => s.state().signin !== null, 'sign-in code');
  const during = JSON.stringify(s.state());
  r.gate.allow = true;
  await until(() => s.state().link.state === 'online', 'link online');
  return { ...r, s, during };
}

/** A phone paired, approved and linked to the service. */
async function linkedPhone(ctx: Awaited<ReturnType<typeof signedIn>>): Promise<FakeDevice> {
  const phone = await fakeDevice({ relayUrl: ctx.relay.url, token: ctx.relay.deviceToken(PEER), peer: PEER, label: 'Pixel 8' });
  cleanups.push(() => phone.close());
  const { code, result } = await phone.pair();
  await until(() => ctx.s.state().pairings[0]?.state === 'confirm', 'pairing to confirm');
  const p = ctx.s.state().pairings[0]!;
  expect(p.code).toBe(code);
  await ctx.s.handle({ type: 'mobile.pairing.approve', id: p.id });
  expect(await result).toBe('ok');
  await phone.hello();
  await until(() => ctx.s.state().pairings[0]?.state === 'linked' && ctx.s.state().devices[0]?.online === true, 'device linked');
  return phone;
}

describe('mobile access service', () => {
  it('set then signin: the code is shown, then the account, the link online and the session file in 0600', async () => {
    const ctx = await signedIn();
    expect(JSON.parse(ctx.during).signin.userCode).toBe(USER_CODE);
    const st = ctx.s.state();
    expect(st.account).toEqual({ login: 'octocat', accountId: TEST_ACCOUNT });
    expect(st.signin).toBeNull();
    expect(st.signinError).toBeNull();
    expect(st.link).toEqual({ state: 'online' });
    expect(statSync(paths().mobileSession).mode & 0o777).toBe(0o600);
  });

  it('signin is refused while mobile access is disabled', async () => {
    const s = await service();
    await expect(s.handle({ type: 'mobile.signin' })).rejects.toThrow(/disabled/);
  });

  it('pairs, approves and links a device; texts flow both ways', async () => {
    const ctx = await signedIn();
    const phone = await linkedPhone(ctx);
    const id = await fingerprint(phone.publicKey);
    const st = ctx.s.state();
    expect(st.devices).toHaveLength(1);
    expect(st.devices[0]).toMatchObject({ id, label: 'Pixel 8', online: true });
    expect(st.devices[0]!.lastSeenAt).toBeDefined();

    const got: Array<[string, string]> = [];
    ctx.s.onMessage((d, t) => got.push([d, t]));
    await phone.send('bonjour');
    await until(() => got.length === 1, 'message on the PC');
    expect(got).toEqual([[id, 'bonjour']]);
    expect(await ctx.s.send(id, 'salut')).toBe(true);
    await until(() => phone.received.length === 1, 'message on the phone');
    expect(phone.received).toEqual(['salut']);
  });

  it('approving an unknown pairing throws a short error', async () => {
    const s = await service();
    await expect(s.handle({ type: 'mobile.pairing.approve', id: 'nope' })).rejects.toThrow(/pairing/);
  });

  it('revoke: the device leaves the list, the relay route gets its last peer, and its socket closes in 4001', async () => {
    const ctx = await signedIn();
    const phone = await linkedPhone(ctx);
    const id = await fingerprint(phone.publicKey);
    await ctx.s.handle({ type: 'mobile.device.revoke', id });
    expect(ctx.s.state().devices).toEqual([]);
    expect(JSON.parse(readFileSync(paths().devices, 'utf8'))).toEqual([]);
    expect(ctx.calls.revoked).toEqual([{ peer: PEER, bearer: `Bearer ${ctx.relay.pcToken}` }]);
    await until(() => phone.frames.some((f) => f.k === 'denied'), 'denied right after the revoke');
    await until(() => phone.linkStates.some((x) => x.state === 'signed_out' && x.reason === 'other_pc'), 'device socket closed in 4001');
    // A second revoke does nothing.
    await ctx.s.handle({ type: 'mobile.device.revoke', id });
    expect(ctx.calls.revoked).toHaveLength(1);
  });

  it('revoke: a msg sent by the device afterwards is answered denied', async () => {
    const ctx = await signedIn();
    const phone = await linkedPhone(ctx);
    const id = await fingerprint(phone.publicKey);
    ctx.gate.kick = false; // the relay keeps the socket open, so only the PC's own refusal is under test
    const msg = await phone.seal('after revoke');
    await ctx.s.handle({ type: 'mobile.device.revoke', id });
    await until(() => phone.frames.filter((f) => f.k === 'denied').length === 1, 'denied right after the revoke');
    phone.sendFrame(msg);
    await until(() => phone.frames.filter((f) => f.k === 'denied').length === 2, 'denied answer to the next msg');
    expect(ctx.s.state().devices).toEqual([]);
  });

  it('approving while the relay link is offline throws and leaves the pairing in confirm, nothing stored', async () => {
    const ctx = await signedIn();
    const phone = await fakeDevice({ relayUrl: ctx.relay.url, token: ctx.relay.deviceToken(PEER), peer: PEER, label: 'Pixel 8' });
    cleanups.push(() => phone.close());
    void phone.pair().catch(() => undefined);
    await until(() => ctx.s.state().pairings[0]?.state === 'confirm', 'pairing to confirm');
    const p = ctx.s.state().pairings[0]!;
    await ctx.relay.relay.close();
    await until(() => ctx.s.state().link.state === 'offline', 'link offline');
    await expect(ctx.s.handle({ type: 'mobile.pairing.approve', id: p.id })).rejects.toThrow(/offline/);
    expect(ctx.s.state().pairings[0]?.state).toBe('confirm');
    expect(ctx.s.state().devices).toEqual([]);
    expect(existsSync(paths().devices) ? JSON.parse(readFileSync(paths().devices, 'utf8')) : []).toEqual([]);
  });

  it('disabled: the link goes off and no connection to the relay follows for 5 simulated seconds', async () => {
    const r = await relayWithAuth();
    writeMobileConfig({ enabled: true, relayUrl: r.relay.url });
    writeRelaySession({ token: r.relay.pcToken, accountId: TEST_ACCOUNT, login: 'octocat', relayUrl: r.relay.url });
    let opened = 0;
    class Counting extends WebSocket {
      constructor(...args: ConstructorParameters<typeof WebSocket>) { super(...args); opened++; }
    }
    const clock = fakeClock();
    const s = await service({ WebSocketImpl: Counting as unknown as typeof WebSocket, schedule: clock.schedule, now: clock.now });
    await until(() => s.state().link.state === 'online', 'link online');
    // The relay goes away: the link is offline with a retry pending.
    await r.relay.relay.close();
    await until(() => s.state().link.state === 'offline', 'link offline');
    await s.handle({ type: 'mobile.set', enabled: false, relayUrl: r.relay.url });
    expect(s.state().link).toEqual({ state: 'off' });
    await r.relay.restart();
    const before = opened;
    clock.advance(5000);
    await settle();
    expect(opened).toBe(before);
    expect(s.state().link).toEqual({ state: 'off' });
  });

  it('a changed relayUrl clears the session: account is null', async () => {
    const ctx = await signedIn();
    await ctx.s.handle({ type: 'mobile.set', enabled: true, relayUrl: 'http://localhost:1' });
    const st = ctx.s.state();
    expect(st.account).toBeNull();
    expect(st.relayUrl).toBe('http://localhost:1');
    expect(st.link).toEqual({ state: 'off' });
    expect(existsSync(paths().mobileSession)).toBe(false);
  });

  it('the state never carries the relay token, the device code or the PC private key', async () => {
    const ctx = await signedIn();
    await linkedPhone(ctx);
    const pkcs8 = readFileSync(paths().mobileKey, 'utf8').trim();
    for (const text of [ctx.during, JSON.stringify(ctx.s.state())]) {
      expect(text).not.toContain(ctx.relay.pcToken);
      expect(text).not.toContain(DEVICE_CODE);
      expect(text).not.toContain(pkcs8);
    }
    const state: MobileState = ctx.s.state();
    expect(state.enabled).toBe(true);
    const logText = readFileSync(paths().log, 'utf8');
    expect(logText).not.toContain(ctx.relay.pcToken);
    expect(logText).not.toContain(DEVICE_CODE);
    expect(logText).not.toContain(pkcs8);
  });
});

describe('device credential', () => {
  const cred = { id: 'cid', publicKey: 'spki', alg: -7 as const, counter: 0, rpId: 'localhost' };
  it('is the stored one for the current relay and none once the relay moves', async () => {
    writeMobileConfig({ enabled: false, relayUrl: 'http://localhost:5173' });
    writeDevices([{ id: 'x', publicKey: 'k', label: 'Phone', approvedAt: '2026-10-19T00:00:00Z' }]);
    const s = await service();
    expect(s.credential('x')).toBeNull();
    s.setCredential('x', cred);
    expect(s.credential('x')).toEqual(cred);
    expect(s.credential('nobody')).toBeNull();
    await s.handle({ type: 'mobile.set', enabled: false, relayUrl: 'https://ledge.paradow.dev' });
    expect(s.credential('x')).toBeNull();
  });
  it('is persisted with the device', async () => {
    writeMobileConfig({ enabled: false, relayUrl: 'http://localhost:5173' });
    writeDevices([{ id: 'x', publicKey: 'k', label: 'Phone', approvedAt: '2026-10-19T00:00:00Z' }]);
    (await service()).setCredential('x', cred);
    expect(readFileSync(paths().devices, 'utf8')).toContain('"cid"');
  });
});
