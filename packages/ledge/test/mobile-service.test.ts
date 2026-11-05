import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import WebSocket from 'ws';
import { fingerprint } from '@ledge/seal';
import { DEFAULT_DEVICE_PREFS, type MobileState } from '@ledge/protocol';
import { createMobileService, type MobileService } from '../src/mobile/service.js';
import { readDevices, readRevocations, writeDevices, writeMobileConfig, writeRelaySession, writeRevocations } from '../src/mobile/files.js';
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
async function signedIn(serviceOpts: Parameters<typeof createMobileService>[0] = {}) {
  const r = await relayWithAuth();
  const s = await service(serviceOpts);
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
  await until(() => ctx.s.state().pairings[0]?.state === 'linked' && ctx.s.state().devices.some((d) => d.online), 'device linked');
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

  it('revoke: every peer the device ever confirmed on is revoked, an older one included', async () => {
    const OLD = 'd_oldoldoldoldoldo';
    // A device that signed in again under PEER: OLD is still in its list, lastPeer names PEER only.
    writeDevices([{ id: 'x', publicKey: 'k', label: 'iPad', approvedAt: '2026-10-19T00:00:00Z', peers: [OLD], lastPeer: PEER }]);
    const ctx = await signedIn();
    await ctx.s.handle({ type: 'mobile.device.revoke', id: 'x' });
    expect(ctx.calls.revoked.map((c) => c.peer).sort()).toEqual([OLD, PEER].sort());
  });

  it('revoke: a peer another approved device now uses is neither denied nor revoked on the relay', async () => {
    // The old iPad lost its keys and paired again from the same browser: same cookie, same peer, new device.
    const OLD = 'd_oldoldoldoldoldo';
    writeDevices([{ id: 'old', publicKey: 'k1', label: 'iPad', approvedAt: '2026-10-19T00:00:00Z', peers: [OLD, PEER], lastPeer: PEER }]);
    const ctx = await signedIn();
    const phone = await linkedPhone(ctx);
    const id = await fingerprint(phone.publicKey);
    // Confirming on PEER moved it to the new device.
    const stored = readDevices();
    expect(stored.find((d) => d.id === 'old')).toMatchObject({ peers: [OLD] });
    expect(stored.find((d) => d.id === 'old')).not.toHaveProperty('lastPeer');
    expect(stored.find((d) => d.id === id)!.peers).toEqual([PEER]);
    const deniedBefore = phone.frames.filter((f) => f.k === 'denied').length;
    await ctx.s.handle({ type: 'mobile.device.revoke', id: 'old' });
    expect(ctx.calls.revoked.map((c) => c.peer)).toEqual([OLD]);
    await new Promise((r) => setTimeout(r, 100));
    expect(phone.frames.filter((f) => f.k === 'denied').length).toBe(deniedBefore);
    expect(ctx.s.state().devices.map((d) => d.id)).toEqual([id]);
    expect(ctx.s.state().devices[0]!.online).toBe(true);
    expect(await ctx.s.send(id, 'still here')).toBe(true);
  });

  it('revoke: a peer still listed by another device (a file written before ownership moved) is left alone', async () => {
    writeDevices([
      { id: 'old', publicKey: 'k1', label: 'iPad', approvedAt: '2026-10-19T00:00:00Z', lastPeer: PEER },
      { id: 'new', publicKey: 'k2', label: 'iPad', approvedAt: '2026-11-03T00:00:00Z', lastPeer: PEER }
    ]);
    const ctx = await signedIn();
    await ctx.s.handle({ type: 'mobile.device.revoke', id: 'old' });
    expect(ctx.calls.revoked).toEqual([]);
    expect(ctx.s.state().devices.map((d) => d.id)).toEqual(['new']);
  });

  it('approve with replaces: the new device is stored, then the old one revoked, a peer they share kept', async () => {
    const OLD = 'd_oldoldoldoldoldo';
    writeDevices([{ id: 'old', publicKey: 'k1', label: 'Pixel 8', approvedAt: '2026-10-19T00:00:00Z', peers: [OLD, PEER], lastPeer: PEER }]);
    const ctx = await signedIn();
    const phone = await fakeDevice({ relayUrl: ctx.relay.url, token: ctx.relay.deviceToken(PEER), peer: PEER, label: 'Pixel 8' });
    cleanups.push(() => phone.close());
    const { result } = await phone.pair();
    await until(() => ctx.s.state().pairings[0]?.state === 'confirm', 'pairing to confirm');
    await ctx.s.handle({ type: 'mobile.pairing.approve', id: ctx.s.state().pairings[0]!.id, replaces: 'old' });
    expect(await result).toBe('ok');
    const id = await fingerprint(phone.publicKey);
    expect(ctx.s.state().devices.map((d) => d.id)).toEqual([id]);
    // PEER is the new device's (its pairing came in on it): only the old device's other peer goes on the relay.
    expect(ctx.calls.revoked.map((c) => c.peer)).toEqual([OLD]);
  });

  it('approve with replaces naming the very device approved again changes nothing but its label', async () => {
    const ctx = await signedIn();
    const phone = await linkedPhone(ctx);
    const id = await fingerprint(phone.publicKey);
    const { result } = await phone.pair();
    await until(() => ctx.s.state().pairings.some((p) => p.state === 'confirm'), 'second pairing to confirm');
    await ctx.s.handle({ type: 'mobile.pairing.approve', id: ctx.s.state().pairings.find((p) => p.state === 'confirm')!.id, replaces: id });
    expect(await result).toBe('ok');
    expect(ctx.s.state().devices.map((d) => d.id)).toEqual([id]);
    expect(ctx.calls.revoked).toEqual([]);
  });

  it('a confirmed channel adds its peer to the device, once', async () => {
    const ctx = await signedIn();
    const phone = await linkedPhone(ctx);
    await phone.hello();
    await until(() => ctx.s.state().devices[0]?.online === true, 'online again');
    expect(JSON.parse(readFileSync(paths().devices, 'utf8'))[0].peers).toEqual([PEER]);
  });

  it('kind from the label, and a rename persisted and shown in the state', async () => {
    const ctx = await signedIn();
    const phone = await linkedPhone(ctx);
    const id = await fingerprint(phone.publicKey);
    expect(ctx.s.state().devices[0]).toMatchObject({ id, kind: 'phone' });
    expect(ctx.s.state().devices[0]!.name).toBeUndefined();
    await ctx.s.handle({ type: 'mobile.device.rename', id, name: '  Pixel de Guillaume ' });
    expect(ctx.s.state().devices[0]!.name).toBe('Pixel de Guillaume');
    expect(ctx.s.deviceInfo(id)).toEqual({ label: 'Pixel 8', kind: 'phone', name: 'Pixel de Guillaume' });
    expect(readDevices()[0]!.name).toBe('Pixel de Guillaume');
    await expect(ctx.s.handle({ type: 'mobile.device.rename', id: 'nobody', name: 'x' })).rejects.toThrow(/device/);
    expect(() => ctx.s.rename(id, '   ')).toThrow();
  });

  it('a device file without kind reads its kind from its label', async () => {
    writeMobileConfig({ enabled: false, relayUrl: 'http://localhost:5173' });
    writeDevices([{ id: 'x', publicKey: 'k', label: 'iPad', approvedAt: '2026-10-19T00:00:00Z' }]);
    const s = await service();
    expect(s.state().devices[0]).toMatchObject({ kind: 'tablet' });
    expect(s.deviceInfo('x')).toEqual({ label: 'iPad', kind: 'tablet' });
    expect(s.deviceInfo('nobody')).toBeNull();
  });

  it('a device\'s own settings: the defaults until set, then persisted with it; an unknown device or a bad value throws', async () => {
    writeMobileConfig({ enabled: false, relayUrl: 'http://localhost:5173' });
    writeDevices([{ id: 'x', publicKey: 'k', label: 'iPad', approvedAt: '2026-10-19T00:00:00Z' }]);
    const s = await service();
    expect(s.prefsOf('x')).toEqual(DEFAULT_DEVICE_PREFS);
    const prefs = { notify: { finished: false, chat: true, decision: false }, quietUntil: '2026-11-06T07:00:00.000Z', chatTool: 'omp' as const };
    s.setPrefs('x', prefs);
    expect(s.prefsOf('x')).toEqual(prefs);
    expect(readDevices()[0]!.prefs).toEqual(prefs);
    expect(() => s.setPrefs('nobody', prefs)).toThrow(/device/);
    expect(() => s.setPrefs('x', { ...prefs, chatTool: 'bash' } as never)).toThrow();
    expect(s.prefsOf('nobody')).toEqual(DEFAULT_DEVICE_PREFS);
  });

  it('a device whose settings this daemon cannot read keeps its place, with the defaults', async () => {
    writeMobileConfig({ enabled: false, relayUrl: 'http://localhost:5173' });
    writeFileSync(paths().devices, JSON.stringify([{ id: 'x', publicKey: 'k', label: 'iPad', approvedAt: '2026-10-19T00:00:00Z', prefs: { notify: 'later' } }]));
    const s = await service();
    expect(s.state().devices.map(d => d.id)).toEqual(['x']);
    expect(s.prefsOf('x')).toEqual(DEFAULT_DEVICE_PREFS);
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

  it('keeps « Taper dans les terminaux » in mobile.json, off by default, through a mobile.set', async () => {
    const ctx = await signedIn();
    expect(ctx.s.state().terminalInput).toBe(false);
    let changes = 0;
    ctx.s.onChange(() => { changes++; });
    await ctx.s.handle({ type: 'mobile.terminal', input: true });
    expect(ctx.s.state().terminalInput).toBe(true);
    expect(changes).toBeGreaterThan(0);
    expect(JSON.parse(readFileSync(paths().mobile, 'utf8'))).toMatchObject({ terminalInput: true });
    await ctx.s.handle({ type: 'mobile.set', enabled: true, relayUrl: ctx.s.state().relayUrl });
    expect(ctx.s.state().terminalInput).toBe(true);
    await ctx.s.handle({ type: 'mobile.terminal', input: false });
    expect(JSON.parse(readFileSync(paths().mobile, 'utf8'))).not.toHaveProperty('terminalInput');
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

describe('relay revocations', () => {
  const DAY = 86_400_000;
  /** The real fetch, except that the revoke call answers `mode.status` (200 lets it through). */
  const revokeAnswering = (mode: { status: number | 'network' }): typeof fetch => async (input, init) => {
    if (String(input).endsWith('/auth/devices/revoke') && mode.status !== 200) {
      if (mode.status === 'network') throw new TypeError('fetch failed');
      return new Response(null, { status: mode.status });
    }
    return fetch(input, init);
  };

  it('a relay that answers 503 keeps the entry (0600); the link online again retries, a 200 removes it', async () => {
    const mode = { status: 503 as number | 'network' };
    const ctx = await signedIn({ fetchImpl: revokeAnswering(mode) });
    const phone = await linkedPhone(ctx);
    const id = await fingerprint(phone.publicKey);
    await ctx.s.handle({ type: 'mobile.device.revoke', id });
    expect(readRevocations().map((r) => r.peer)).toEqual([PEER]);
    expect(statSync(paths().revocations).mode & 0o777).toBe(0o600);
    expect(ctx.calls.revoked).toHaveLength(0);
    mode.status = 200;
    await ctx.s.handle({ type: 'mobile.set', enabled: false, relayUrl: ctx.relay.url });
    await ctx.s.handle({ type: 'mobile.set', enabled: true, relayUrl: ctx.relay.url });
    await until(() => readRevocations().length === 0, 'entry removed after the retry');
    expect(ctx.calls.revoked.map((c) => c.peer)).toEqual([PEER]);
  });

  it('a daemon restarted reads the file and retries', async () => {
    const mode = { status: 503 as number | 'network' };
    const ctx = await signedIn({ fetchImpl: revokeAnswering(mode) });
    const phone = await linkedPhone(ctx);
    await ctx.s.handle({ type: 'mobile.device.revoke', id: await fingerprint(phone.publicKey) });
    expect(readRevocations()).toHaveLength(1);
    await ctx.s.stop();
    await service({ fetchImpl: revokeAnswering({ status: 200 }) });
    await until(() => readRevocations().length === 0, 'entry removed after the restart');
    expect(ctx.calls.revoked.map((c) => c.peer)).toEqual([PEER]);
  });

  it('an entry older than 30 days is dropped and logged, not sent; a younger one is', async () => {
    writeRevocations([
      { peer: 'd_oldoldoldoldold', at: new Date(Date.now() - 31 * DAY).toISOString() },
      { peer: 'd_newnewnewnewnew', at: new Date(Date.now() - 29 * DAY).toISOString() }
    ]);
    const ctx = await signedIn();
    await until(() => readRevocations().length === 0, 'entries settled');
    expect(ctx.calls.revoked.map((c) => c.peer)).toEqual(['d_newnewnewnewnew']);
  });

  it('an entry whose date cannot be read is dropped, not retried forever', async () => {
    writeRevocations([{ peer: 'd_baddatebaddate0', at: 'not a date' }]);
    const ctx = await signedIn();
    await until(() => readRevocations().length === 0, 'entry dropped');
    expect(ctx.calls.revoked).toEqual([]);
  });

  it.each([[200, true], [204, true], [404, true], [401, false], [429, false], [500, false], [503, false], ['network', false]] as const)(
    'relay answer %s: entry removed is %s', async (status, removed) => {
      const mode = { status: status as number | 'network' };
      writeRevocations([{ peer: PEER, at: new Date().toISOString() }]);
      let tried = 0;
      const inner = revokeAnswering(mode);
      await signedIn({ fetchImpl: async (i, init) => { if (String(i).endsWith('/auth/devices/revoke')) tried++; return inner(i, init); } });
      await until(() => tried > 0, 'a revoke attempt');
      await settle();
      expect(readRevocations().length).toBe(removed ? 0 : 1);
    });
});

describe('push through the relay', () => {
  const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', p256dh: 'B'.repeat(87), auth: 'A'.repeat(22), key: 'K'.repeat(87) };
  const MSG = { endpoint: SUB.endpoint, body: 'AAAA', ttl: 3600, urgency: 'high' as const, topic: 'api' };

  /** A fetch that answers the two push routes and leaves the rest to the real one. */
  function pushFetch(o: { key?: () => Response; send?: (body: unknown, auth: string) => Response } = {}) {
    const calls: Array<{ path: string; auth: string; body?: unknown }> = [];
    const impl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const auth = String((init?.headers as Record<string, string> | undefined)?.authorization ?? '');
      if (url.pathname === '/push/key') {
        calls.push({ path: url.pathname, auth });
        return o.key ? o.key() : Response.json({ publicKey: SUB.key });
      }
      if (url.pathname === '/push/send') {
        const body = JSON.parse(String(init?.body));
        calls.push({ path: url.pathname, auth, body });
        return o.send ? o.send(body, auth) : Response.json({ result: 'sent', status: 201 });
      }
      return fetch(input, init);
    }) as typeof fetch;
    return { impl, calls };
  }

  it('reads the relay key each time the link comes online; 404 means unavailable', async () => {
    const f = pushFetch();
    const ctx = await signedIn({ fetchImpl: f.impl });
    await until(() => ctx.s.relayPushKey() === SUB.key, 'relay key');
    expect(f.calls[0]).toEqual({ path: '/push/key', auth: `Bearer ${ctx.relay.pcToken}` });
  });

  it('a relay without push answers 404: the key is null', async () => {
    const f = pushFetch({ key: () => new Response('{}', { status: 404 }) });
    const ctx = await signedIn({ fetchImpl: f.impl });
    await until(() => ctx.s.relayPushKey() === null, 'null key');
  });

  it('sendPush posts to the relay with the PC bearer and returns its answer; a refusal is failed', async () => {
    let status = 200;
    const f = pushFetch({ send: () => status === 200 ? Response.json({ result: 'gone', status: 410 }) : new Response('{}', { status }) });
    const ctx = await signedIn({ fetchImpl: f.impl });
    expect(await ctx.s.sendPush(MSG)).toEqual({ result: 'gone', status: 410 });
    expect(f.calls.find(c => c.path === '/push/send')).toEqual({ path: '/push/send', auth: `Bearer ${ctx.relay.pcToken}`, body: MSG });
    status = 429;
    expect(await ctx.s.sendPush(MSG)).toEqual({ result: 'failed', status: 429 });
  });

  it('sendPush without a session fails without throwing', async () => {
    const s = await service();
    expect(await s.sendPush(MSG)).toEqual({ result: 'failed' });
  });

  it('setPush stores the subscription with the device (0600), removes it with null, and refuses an unknown device', async () => {
    const ctx = await signedIn();
    const phone = await linkedPhone(ctx);
    const id = await fingerprint(phone.publicKey);
    let changes = 0;
    ctx.s.onChange(() => { changes++; });
    ctx.s.setPush(id, SUB);
    expect(ctx.s.pushOf(id)).toEqual(SUB);
    expect(JSON.parse(readFileSync(paths().devices, 'utf8'))[0].push).toEqual(SUB);
    expect(statSync(paths().devices).mode & 0o777).toBe(0o600);
    expect(changes).toBe(1);
    ctx.s.setPush(id, null);
    expect(ctx.s.pushOf(id)).toBeNull();
    expect(JSON.parse(readFileSync(paths().devices, 'utf8'))[0]).not.toHaveProperty('push');
    expect(() => ctx.s.setPush('nope', SUB)).toThrow(/no such device/);
    expect(JSON.stringify(ctx.s.state())).not.toContain('fcm.googleapis');
  });
});
