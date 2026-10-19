import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { parseRelayServerMessage, type RelayServerMessage } from '@ledge/protocol';
import { devTokens, RELAY_PROTOCOL_PREFIX } from '../src/auth.js';
import { createRelay } from '../src/server.js';
import type { RelayLogEvent } from '../src/log.js';

const D1 = 'd_aaaaaaaaaaaaaaaa';
const TOKENS = devTokens({
  'tok-pc': { accountId: 'A', peer: 'pc' },
  'tok-d1': { accountId: 'A', peer: D1 }
});

let relay: ReturnType<typeof createRelay> | undefined;
afterEach(async () => { await relay?.close(); relay = undefined; });

async function start() {
  const events: RelayLogEvent[] = [];
  relay = createRelay({ authenticator: TOKENS, log: (e) => events.push(e) });
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
    pc.send(JSON.stringify({ type: 'send', to: D1, body: 'x' }));
    expect(await box.next(3)).toEqual({ type: 'error', code: 'offline', to: D1 });
    pc.close();
  });
});
