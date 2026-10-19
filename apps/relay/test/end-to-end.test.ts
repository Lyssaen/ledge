import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { parseRelayServerMessage, type RelayServerMessage, type SealedFrame } from '@ledge/protocol';
import { generateIdentity, startHandshake } from '@ledge/seal';
import { devTokens } from '../src/auth.js';
import { createRelay } from '../src/server.js';
import { Hub, type Conn } from '../src/hub.js';
import type { RelayLogEvent } from '../src/log.js';

const D1 = 'd_aaaaaaaaaaaaaaaa', D2 = 'd_bbbbbbbbbbbbbbbb';
let relay: ReturnType<typeof createRelay> | undefined;
afterEach(async () => { await relay?.close(); relay = undefined; });

function client(port: number, token: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { authorization: `Bearer ${token}` } });
  const msgs: RelayServerMessage[] = [];
  const waiters: Array<() => void> = [];
  ws.on('message', (d) => { msgs.push(parseRelayServerMessage(JSON.parse(d.toString('utf8')))); waiters.splice(0).forEach((w) => w()); });
  return {
    ws, msgs,
    async deliver(): Promise<{ from: string; frame: SealedFrame }> {
      for (;;) {
        const i = msgs.findIndex((m) => m.type === 'deliver');
        if (i >= 0) {
          const m = msgs.splice(i, 1)[0]!;
          if (m.type !== 'deliver') throw new Error('unreachable');
          return { from: m.from, frame: JSON.parse(m.body) as SealedFrame };
        }
        await new Promise<void>((r) => waiters.push(r));
      }
    },
    async welcomed() { while (!msgs.some((m) => m.type === 'welcome')) await new Promise<void>((r) => waiters.push(r)); },
    sendFrame(to: string, frame: SealedFrame) { ws.send(JSON.stringify({ type: 'send', to, body: JSON.stringify(frame) })); }
  };
}

describe('end to end', () => {
  it('carries a sealed exchange the relay cannot read', async () => {
    const events: RelayLogEvent[] = [];
    relay = createRelay({
      authenticator: devTokens({
        'tok-pc': { accountId: 'acct-1', peer: 'pc' },
        'tok-d1': { accountId: 'acct-1', peer: D1 },
        'tok-d2': { accountId: 'acct-2', peer: D2 }
      }),
      log: (e) => events.push(e)
    });
    await new Promise<void>((res) => relay!.server.listen(0, '127.0.0.1', res));
    const port = (relay.server.address() as AddressInfo).port;

    const pcId = await generateIdentity(), phoneId = await generateIdentity();
    const pc = client(port, 'tok-pc'), phone = client(port, 'tok-d1'), other = client(port, 'tok-d2');
    await Promise.all([pc.welcomed(), phone.welcomed(), other.welcomed()]);

    const hsPc = await startHandshake(pcId, 'pc', phoneId.publicKey);
    const hsPhone = await startHandshake(phoneId, 'device', pcId.publicKey);
    pc.sendFrame(D1, { k: 'hello', e: hsPc.hello });
    phone.sendFrame('pc', { k: 'hello', e: hsPhone.hello });
    const fromPc = await phone.deliver(), fromPhone = await pc.deliver();
    if (fromPc.frame.k !== 'hello' || fromPhone.frame.k !== 'hello') throw new Error('expected hello frames');
    const chPhone = await hsPhone.finish(fromPc.frame.e);
    const chPc = await hsPc.finish(fromPhone.frame.e);

    phone.sendFrame('pc', { k: 'msg', s: await chPhone.seal('session.reply hi SECRET-789') });
    const got = await pc.deliver();
    expect(got.from).toBe(D1);
    if (got.frame.k !== 'msg') throw new Error('expected msg frame');
    expect(await chPc.open(got.frame.s)).toBe('session.reply hi SECRET-789');

    expect(JSON.stringify(events)).not.toContain('SECRET');
    expect(JSON.stringify([...pc.msgs, ...phone.msgs])).not.toContain('SECRET');
    expect(other.msgs.map((m) => m.type)).toEqual(['welcome']);
    for (const c of [pc, phone, other]) c.ws.close();
  });

  it('a body changed by the relay does not open', async () => {
    const pcId = await generateIdentity(), phoneId = await generateIdentity();
    const hub = new Hub(() => {});
    let tamper = false;
    const delivered: string[] = [];
    const pcConn: Conn = {
      send(m) {
        if (m.type !== 'deliver') return;
        const f = JSON.parse(m.body) as SealedFrame;
        if (f.k === 'msg' && tamper) f.s = f.s.slice(0, -1) + (f.s.endsWith('A') ? 'B' : 'A');
        delivered.push(JSON.stringify(f));
      },
      close() {}
    };
    const phoneConn: Conn = { send() {}, close() {} };
    hub.attach(pcConn, { accountId: 'A', peer: 'pc' });
    hub.attach(phoneConn, { accountId: 'A', peer: D1 });
    const hsPc = await startHandshake(pcId, 'pc', phoneId.publicKey);
    const hsPhone = await startHandshake(phoneId, 'device', pcId.publicKey);
    const chPc = await hsPc.finish(hsPhone.hello);
    const chPhone = await hsPhone.finish(hsPc.hello);

    tamper = true;
    const frame: SealedFrame = { k: 'msg', s: await chPhone.seal('SECRET') };
    hub.receive(phoneConn, JSON.stringify({ type: 'send', to: 'pc', body: JSON.stringify(frame) }));
    const rewritten = JSON.parse(delivered.at(-1)!) as { s: string };
    expect(rewritten.s).not.toBe(frame.k === 'msg' ? frame.s : '');
    await expect(chPc.open(rewritten.s)).rejects.toMatchObject({ code: 'bad_seal' });
  });
});
