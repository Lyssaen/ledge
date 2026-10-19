import { describe, it, expect, afterEach } from 'vitest';
import net, { type AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { parseRelayServerMessage, type RelayServerMessage } from '@ledge/protocol';
import { devTokens, RELAY_PROTOCOL_PREFIX } from '../src/auth.js';
import { createRelay, type RelayOptions } from '../src/server.js';
import type { RelayLogEvent } from '../src/log.js';

const D1 = 'd_aaaaaaaaaaaaaaaa';
const TOKENS = devTokens({
  'tok-pc': { accountId: 'A', peer: 'pc' },
  'tok-d1': { accountId: 'A', peer: D1 }
});

let relay: ReturnType<typeof createRelay> | undefined;
afterEach(async () => { await relay?.close(); relay = undefined; });

async function start(extra: Partial<RelayOptions> = {}) {
  const events: RelayLogEvent[] = [];
  relay = createRelay({ authenticator: TOKENS, log: (e) => events.push(e), ...extra });
  await new Promise<void>((res) => relay!.server.listen(0, '127.0.0.1', res));
  const port = (relay.server.address() as AddressInfo).port;
  return { port, events };
}

function inbox(ws: WebSocket) {
  const msgs: RelayServerMessage[] = [];
  const waiters: Array<() => void> = [];
  ws.on('message', (d) => { msgs.push(parseRelayServerMessage(JSON.parse(d.toString('utf8')))); waiters.splice(0).forEach((w) => w()); });
  return {
    msgs,
    async next(n: number) {
      while (msgs.length < n) await new Promise<void>((r) => waiters.push(r));
      return msgs[n - 1]!;
    }
  };
}
const opened = (ws: WebSocket) => new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
const refused = (ws: WebSocket) => new Promise<number>((res) => {
  ws.once('unexpected-response', (_req, r) => { r.resume(); res(r.statusCode ?? 0); });
  ws.once('error', () => {});
});

describe('relay server', () => {
  it('answers /healthz and 404s everything else', async () => {
    const { port } = await start();
    const ok = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('ok');
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(404);
  });

  it('refuses an upgrade without a token with 401', async () => {
    const { port, events } = await start();
    expect(await refused(new WebSocket(`ws://127.0.0.1:${port}/ws`))).toBe(401);
    expect(await refused(new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { authorization: 'Bearer nope' } }))).toBe(401);
    expect(events.filter((e) => e.ev === 'refused')).toEqual([
      { ev: 'refused', reason: 'no_auth' }, { ev: 'refused', reason: 'no_auth' }
    ]);
  });

  it('accepts a bearer token', async () => {
    const { port } = await start();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { authorization: 'Bearer tok-pc' } });
    const box = inbox(ws);
    expect(await box.next(1)).toEqual({ type: 'welcome', accountId: 'A', self: 'pc', online: [] });
    ws.close();
  });

  it('accepts a token offered as a subprotocol and echoes it', async () => {
    const { port } = await start();
    const offered = `${RELAY_PROTOCOL_PREFIX}tok-d1`;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, [offered]);
    const box = inbox(ws);
    expect(await box.next(1)).toMatchObject({ type: 'welcome', self: D1 });
    expect(ws.protocol).toBe(offered);
    ws.close();
  });

  it('404s an upgrade on another path even with a good token', async () => {
    const { port, events } = await start();
    expect(await refused(new WebSocket(`ws://127.0.0.1:${port}/autre`, { headers: { authorization: 'Bearer tok-pc' } }))).toBe(404);
    expect(events).toContainEqual({ ev: 'refused', reason: 'bad_path' });
  });

  it('answers bad_frame and keeps the connection usable', async () => {
    const { port } = await start();
    const pc = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { authorization: 'Bearer tok-pc' } });
    const box = inbox(pc);
    await box.next(1);
    pc.send('not json');
    expect(await box.next(2)).toEqual({ type: 'error', code: 'bad_frame' });
    const d1 = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { authorization: 'Bearer tok-d1' } });
    const dbox = inbox(d1);
    await dbox.next(1);
    pc.send(JSON.stringify({ type: 'send', to: D1, body: 'x' }));
    expect(await dbox.next(2)).toEqual({ type: 'deliver', from: 'pc', body: 'x' });
    pc.close(); d1.close();
  });

  it('survives a malformed request target and keeps serving', async () => {
    const { port, events } = await start();
    const raw = await new Promise<string>((res) => {
      const sock = net.connect(port, '127.0.0.1', () => sock.write('GET http://[ HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'));
      let out = '';
      sock.on('data', (d) => { out += d.toString(); });
      sock.on('close', () => res(out));
      sock.on('error', () => res(out));
    });
    expect(raw).toMatch(/^HTTP\/1\.1 404/);
    expect(events).toContainEqual({ ev: 'refused', reason: 'bad_path' });
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
  });

  it('refuses an unknown token offered as a subprotocol', async () => {
    const { port } = await start();
    expect(await refused(new WebSocket(`ws://127.0.0.1:${port}/ws`, [`${RELAY_PROTOCOL_PREFIX}nope`]))).toBe(401);
  });

  it('accepts a query string on /ws', async () => {
    const { port } = await start();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?x=1`, { headers: { authorization: 'Bearer tok-pc' } });
    expect(await inbox(ws).next(1)).toMatchObject({ type: 'welcome' });
    ws.close();
  });

  it('closes a socket over maxPayload with 1009 and tells the peer it left', async () => {
    const { port } = await start();
    const pc = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { authorization: 'Bearer tok-pc' } });
    const pbox = inbox(pc);
    await pbox.next(1);
    const d1 = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { authorization: 'Bearer tok-d1' } });
    const dbox = inbox(d1);
    await dbox.next(1);
    await pbox.next(2); // presence: d1 online
    const closed = new Promise<number>((res) => d1.once('close', (code) => res(code)));
    d1.send('x'.repeat(1_048_576 + 4096 + 1));
    expect(await closed).toBe(1009);
    expect(await pbox.next(3)).toEqual({ type: 'presence', peer: D1, online: false });
    pc.close();
  });

  it('answers 401 and logs auth_error when the authenticator throws', async () => {
    const events: RelayLogEvent[] = [];
    relay = createRelay({ authenticator: { authenticate: async () => { throw new Error('secret-detail'); } }, log: (e) => events.push(e) });
    await new Promise<void>((res) => relay!.server.listen(0, '127.0.0.1', res));
    const port = (relay.server.address() as AddressInfo).port;
    expect(await refused(new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { authorization: 'Bearer x' } }))).toBe(401);
    expect(events).toEqual([{ ev: 'refused', reason: 'auth_error' }]);
  });

  it('answers 401 when the authenticator throws synchronously, and keeps serving', async () => {
    const { port, events } = await start({ authenticator: { authenticate() { throw new Error('x'); } } });
    expect(await refused(new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { authorization: 'Bearer x' } }))).toBe(401);
    expect(events).toEqual([{ ev: 'refused', reason: 'auth_error' }]);
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
  });

  it('survives an authenticator that returns a non-thenable', async () => {
    const { port, events } = await start({ authenticator: { authenticate: () => null as unknown as Promise<null> } });
    expect(await refused(new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { authorization: 'Bearer x' } }))).toBe(401);
    expect(events).toEqual([{ ev: 'refused', reason: 'no_auth' }]);
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
  });

  it('drops an upgraded socket whose attach fails, without writing a 401 onto it', async () => {
    const events: RelayLogEvent[] = [];
    const { port } = await start({ log: (e) => { if (e.ev === 'connect') throw new Error('boom'); events.push(e); } });
    const raw = await new Promise<string>((res) => {
      const sock = net.connect(port, '127.0.0.1', () => sock.write(
        'GET /ws HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\n' +
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nAuthorization: Bearer tok-pc\r\n\r\n'));
      let out = '';
      sock.on('data', (d) => { out += d.toString('latin1'); });
      sock.on('close', () => res(out));
      sock.on('error', () => res(out));
    });
    expect(raw).toMatch(/^HTTP\/1\.1 101/);
    expect(raw).not.toContain('401');
    expect(events.some((e) => e.ev === 'refused')).toBe(false);
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
  });

  it('terminates a peer that stops answering pings and tells the others it left', async () => {
    const { port } = await start({ heartbeatMs: 40 });
    const pc = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { authorization: 'Bearer tok-pc' } });
    const pbox = inbox(pc);
    await pbox.next(1);
    const d1 = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { authorization: 'Bearer tok-d1' }, autoPong: false });
    const closed = new Promise<number>((res) => d1.once('close', (code) => res(code)));
    expect(await pbox.next(2)).toEqual({ type: 'presence', peer: D1, online: true });
    expect(await pbox.next(3)).toEqual({ type: 'presence', peer: D1, online: false });
    expect(await closed).toBe(1006);
    await new Promise((r) => setTimeout(r, 120)); // several more beats: the answering PC stays
    expect(pc.readyState).toBe(WebSocket.OPEN);
    pc.close();
  });

  it('terminates a receiver whose send buffer passes maxBufferedBytes', async () => {
    const { port } = await start({ maxBufferedBytes: 1_048_576, limits: { framesPerWindow: 1000, bytesPerWindow: Infinity } });
    const pc = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { authorization: 'Bearer tok-pc' } });
    const pbox = inbox(pc);
    await pbox.next(1);
    // A device that never reads: the relay's buffer towards it can only grow.
    const sock = net.connect(port, '127.0.0.1', () => sock.write(
      'GET /ws HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\n' +
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nAuthorization: Bearer tok-d1\r\n\r\n'));
    sock.on('error', () => {});
    sock.pause();
    expect(await pbox.next(2)).toEqual({ type: 'presence', peer: D1, online: true });
    const frame = JSON.stringify({ type: 'send', to: D1, body: 'x'.repeat(1_048_576) });
    for (let i = 0; i < 64 && pbox.msgs.length < 3; i++) {
      pc.send(frame);
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(await pbox.next(3)).toEqual({ type: 'presence', peer: D1, online: false });
    sock.destroy();
    pc.close();
  });
});
