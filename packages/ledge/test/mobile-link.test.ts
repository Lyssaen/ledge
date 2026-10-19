import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import WebSocket, { WebSocketServer } from 'ws';
import { RELAY_CLOSE_SIGNED_OUT, type RelayServerMessage } from '@ledge/protocol';
import { createRelayLink, type LinkState } from '../src/mobile/link.js';
import { paths } from '../src/paths.js';
import { startTestRelay, TEST_ACCOUNT, type HttpHandler, type RelayControl, type TestRelay } from './mobile-relay-harness.js';

const DEVICE = 'd_aaaaaaaaaaaaaaaa';

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
    pending: () => timers.length,
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

async function until(cond: () => boolean, what = 'condition'): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}
const settle = () => new Promise((r) => setTimeout(r, 50));

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });

/** Every state any link emitted in this file: none may carry a token. */
const allStates: LinkState[] = [];
const allTokens: string[] = [];

async function relay(opts: { auth?: HttpHandler } = {}): Promise<TestRelay> {
  const r = await startTestRelay(opts);
  allTokens.push(r.pcToken);
  cleanups.push(() => r.relay.close());
  return r;
}

function link(relayUrl: string, token: string) {
  const clock = fakeClock();
  const states: LinkState[] = [];
  const msgs: RelayServerMessage[] = [];
  const l = createRelayLink({
    relayUrl, token, now: clock.now, random: () => 0.5, schedule: clock.schedule,
    onState: (s) => { states.push(s); allStates.push(s); },
    onMessage: (m) => msgs.push(m)
  });
  cleanups.push(() => l.close());
  const last = () => states[states.length - 1];
  return { l, clock, states, msgs, last, count: (state: LinkState['state']) => states.filter((s) => s.state === state).length };
}

/** The delay announced by the last `offline` state, in ms. */
const delayOf = (s: LinkState | undefined, now: number) => {
  if (s?.state !== 'offline') throw new Error(`expected offline, got ${JSON.stringify(s)}`);
  return Date.parse(s.retryAt) - now;
};

describe('relay link', () => {
  it('goes connecting then online with a valid token, and hands the welcome to onMessage', async () => {
    const r = await relay();
    const t = link(r.url, r.pcToken);
    await until(() => t.last()?.state === 'online', 'online');
    expect(t.states).toEqual([{ state: 'connecting' }, { state: 'online' }]);
    expect(t.msgs[0]).toEqual({ type: 'welcome', accountId: TEST_ACCOUNT, self: 'pc', online: [] });
    expect(t.l.send({ type: 'send', to: DEVICE, body: 'x' })).toBe(true);
  });

  it('is signed out with session_invalid on an unknown token, and does not retry', async () => {
    const r = await relay();
    const t = link(r.url, 'unknown-token');
    await until(() => t.last()?.state === 'signed_out', 'signed_out');
    expect(t.last()).toEqual({ state: 'signed_out', reason: 'session_invalid' });
    t.clock.advance(5000);
    await settle();
    expect(t.count('connecting')).toBe(1);
    expect(t.clock.pending()).toBe(0);
    expect(t.l.send({ type: 'send', to: DEVICE, body: 'x' })).toBe(false);
  });

  it('hands a device frame to onMessage as deliver', async () => {
    const r = await relay();
    const t = link(r.url, r.pcToken);
    await until(() => t.last()?.state === 'online', 'online');
    const ws = new WebSocket(`ws://127.0.0.1:${r.port}/ws`, { headers: { authorization: `Bearer ${r.deviceToken(DEVICE)}` } });
    cleanups.push(() => ws.terminate());
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
    ws.send(JSON.stringify({ type: 'send', to: 'pc', body: 'sealed-body' }));
    await until(() => t.msgs.some((m) => m.type === 'deliver'), 'deliver');
    expect(t.msgs.find((m) => m.type === 'deliver')).toEqual({ type: 'deliver', from: DEVICE, body: 'sealed-body' });
  });

  it('is signed out with other_pc on a 4001 kick, and does not retry', async () => {
    let control: RelayControl | undefined;
    const r = await relay({ auth: async (_req, _res, c) => { control = c; return false; } });
    const t = link(r.url, r.pcToken);
    await until(() => t.last()?.state === 'online', 'online');
    await fetch(`${r.url}/healthz`); // hands the relay control to the test
    control!.kick(TEST_ACCOUNT, 'pc', RELAY_CLOSE_SIGNED_OUT, 'signed_out');
    await until(() => t.last()?.state === 'signed_out', 'signed_out');
    expect(t.last()).toEqual({ state: 'signed_out', reason: 'other_pc' });
    t.clock.advance(5000);
    await settle();
    expect(t.count('connecting')).toBe(1);
  });

  it('retries a stopped relay at 1, 2, 4… s, capped at 60 s', async () => {
    const r = await relay();
    await r.relay.close();
    const t = link(r.url, r.pcToken);
    const delays: number[] = [];
    for (let i = 0; i < 8; i++) {
      await until(() => t.count('offline') === i + 1, `offline #${i + 1}`);
      const s = t.last();
      expect(s).toMatchObject({ state: 'offline', error: expect.stringContaining('ECONNREFUSED') });
      delays.push(delayOf(s, t.clock.now()));
      t.clock.advance(delays[i]!);
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]);
  });

  it('comes back online when the relay restarts on the same port, and the delay returns to 1 s', async () => {
    const r = await relay();
    const t = link(r.url, r.pcToken);
    await until(() => t.last()?.state === 'online', 'online');
    await r.relay.close();
    await until(() => t.count('offline') === 1, 'offline #1');
    expect(delayOf(t.last(), t.clock.now())).toBe(1000);
    t.clock.advance(1000);
    await until(() => t.count('offline') === 2, 'offline #2');
    expect(delayOf(t.last(), t.clock.now())).toBe(2000);

    await r.restart();
    t.clock.advance(2000);
    await until(() => t.count('online') === 2, 'online again');

    await r.relay.close();
    await until(() => t.count('offline') === 3, 'offline #3');
    expect(delayOf(t.last(), t.clock.now())).toBe(1000);
  });

  it('retryNow connects at once instead of waiting', async () => {
    const r = await relay();
    await r.relay.close();
    const t = link(r.url, r.pcToken);
    await until(() => t.count('offline') === 1, 'offline');
    await r.restart();
    t.l.retryNow();
    await until(() => t.last()?.state === 'online', 'online');
    expect(t.clock.pending()).toBe(1); // only the next ping
  });

  it('goes offline and retries on a 503 upgrade', async () => {
    const server = http.createServer();
    server.on('upgrade', (_req, socket) => socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
    cleanups.push(() => new Promise<void>((res) => { server.closeAllConnections(); server.close(() => res()); }));
    const t = link(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'tok');
    await until(() => t.count('offline') === 1, 'offline');
    expect(t.last()).toMatchObject({ state: 'offline', error: expect.stringContaining('503') });
    t.clock.advance(1000);
    await until(() => t.count('offline') === 2, 'offline #2');
    expect(delayOf(t.last(), t.clock.now())).toBe(2000);
  });

  it('terminates and reconnects when a ping gets no pong within 10 s, and ignores an invalid frame', async () => {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1', autoPong: false });
    await new Promise<void>((res) => wss.once('listening', () => res()));
    cleanups.push(() => new Promise<void>((res) => { for (const c of wss.clients) c.terminate(); wss.close(() => res()); }));
    wss.on('connection', (ws) => {
      ws.send('{"type":"nope","secret":"frame-content"}');
      ws.send(JSON.stringify({ type: 'welcome', accountId: 'A', self: 'pc', online: [] }));
    });
    const t = link(`http://127.0.0.1:${(wss.address() as AddressInfo).port}`, 'tok');
    await until(() => t.last()?.state === 'online', 'online');
    expect(t.msgs).toEqual([{ type: 'welcome', accountId: 'A', self: 'pc', online: [] }]);
    const logged = readFileSync(paths().log, 'utf8');
    expect(logged).toContain('invalid relay frame');
    expect(logged).not.toContain('frame-content');

    t.clock.advance(25_000 + 9_999);
    await settle();
    expect(t.last()?.state).toBe('online');
    t.clock.advance(1);
    await until(() => t.last()?.state === 'offline', 'offline');
    expect(delayOf(t.last(), t.clock.now())).toBe(1000);
  });

  it('close() goes off and stops retrying', async () => {
    const r = await relay();
    await r.relay.close();
    const t = link(r.url, r.pcToken);
    await until(() => t.count('offline') === 1, 'offline');
    t.l.close();
    expect(t.last()).toEqual({ state: 'off' });
    expect(t.clock.pending()).toBe(0);
  });

  it('never puts the token in a serialized state, nor in the log', () => {
    expect(allStates.length).toBeGreaterThan(10);
    const serialized = JSON.stringify(allStates);
    for (const tok of allTokens) expect(serialized).not.toContain(tok);
    let logged = '';
    try { logged = readFileSync(paths().log, 'utf8'); } catch { /* no log */ }
    for (const tok of allTokens) expect(logged).not.toContain(tok);
  });
});
