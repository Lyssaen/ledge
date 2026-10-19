import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fingerprint, generateIdentity, startHandshake, type Identity } from '@ledge/seal';
import { SealedFrameSchema, type SealedFrame } from '@ledge/protocol';
import { createRelayLink } from '../src/mobile/link.js';
import type { ApprovedDevice } from '../src/mobile/files.js';
import { createChannels, REKEY_INTERVAL_MS } from '../src/mobile/channels.js';
import { paths } from '../src/paths.js';
import { startTestRelay, type TestRelay } from './mobile-relay-harness.js';
import { fakeDevice, type FakeDevice } from './mobile-fake-device.js';

// Most tests go through the real relay with fake devices. Two drive `channels.receive` directly:
// the rekey rate limit (deterministic clock, no relay timing) and the replay of a captured hello + ready.

const READY = '{"t":"ready"}';

async function until(cond: () => boolean, what = 'condition'): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Lets in-flight relay frames land before asserting that nothing happened. */
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });

const peerId = (i: number) => `d_${String(i).repeat(16)}`;

async function approvedEntry(d: { publicKey: string }, label = 'Pixel'): Promise<ApprovedDevice> {
  return { id: await fingerprint(d.publicKey), publicKey: d.publicKey, label, approvedAt: '2026-10-19T08:00:00.000Z' };
}

/** The relay, a PC linked to it whose `hello`/`msg` frames go to `channels`, and a way to add phones. */
async function setup() {
  const relay: TestRelay = await startTestRelay();
  cleanups.push(() => relay.relay.close());
  const pc = await generateIdentity();
  const devices: ApprovedDevice[] = [];
  const confirmed: Array<[string, string]> = [];
  const messages: Array<[string, string]> = [];
  const closed: string[] = [];
  /** Every frame the PC sent, by peer. */
  const sent: Array<[string, SealedFrame]> = [];
  let t = Date.parse('2026-10-19T08:00:00.000Z');

  let channels: ReturnType<typeof createChannels> | null = null;
  let online = false;
  const link = createRelayLink({
    relayUrl: relay.url,
    token: relay.pcToken,
    onState: (s) => { online = s.state === 'online'; },
    onMessage(m) {
      if (m.type !== 'deliver' || !channels) return;
      const r = SealedFrameSchema.safeParse(JSON.parse(m.body));
      if (r.success && (r.data.k === 'hello' || r.data.k === 'msg')) void channels.receive(m.from, r.data);
    }
  });
  cleanups.push(() => link.close());
  channels = createChannels({
    pc,
    devices: () => devices,
    send: (peer, frame) => { sent.push([peer, frame]); link.send({ type: 'send', to: peer, body: JSON.stringify(frame) }); },
    onConfirmed: (id, peer) => confirmed.push([id, peer]),
    onMessage: (id, text) => messages.push([id, text]),
    onClosed: (id) => closed.push(id),
    now: () => t
  });
  await until(() => online, 'PC online');

  const device = async (i: number, opts: { identity?: Identity } = {}): Promise<FakeDevice> => {
    const peer = peerId(i);
    const d = await fakeDevice({ relayUrl: relay.url, token: relay.deviceToken(peer), peer, pcPublicKey: pc.publicKey, ...opts });
    cleanups.push(() => d.close());
    return d;
  };
  /** A phone that is approved and has a confirmed channel. */
  const linkedDevice = async (i: number) => {
    const d = await device(i);
    devices.push(await approvedEntry(d));
    await d.hello();
    return d;
  };
  const sentKinds = (peer: string, k: SealedFrame['k']) => sent.filter(([p, f]) => p === peer && f.k === k).length;
  return {
    relay, pc, devices, confirmed, messages, closed, sent, sentKinds, channels, device, linkedDevice,
    advance: (ms: number) => { t += ms; }
  };
}

describe('sealed channels with approved devices', () => {
  it('an approved device says hello then ready: confirmed, and texts flow both ways', async () => {
    const s = await setup();
    const phone = await s.device(1);
    s.devices.push(await approvedEntry(phone));
    const id = await fingerprint(phone.publicKey);
    const hello = phone.waitFor('hello');
    await phone.hello();
    expect((await hello).f).toBe(await fingerprint(s.pc.publicKey));
    expect(s.confirmed).toEqual([[id, phone.peer]]);
    expect(s.channels.online()).toEqual(new Set([id]));

    await phone.send('x');
    await until(() => s.messages.length === 1, 'onMessage');
    expect(s.messages).toEqual([[id, 'x']]);

    expect(await s.channels.send(id, 'y')).toBe(true);
    await until(() => phone.received.length === 1, 'device received');
    expect(phone.received).toEqual(['y']);
    expect(phone.openFailures).toBe(0);
  });

  it('a device that is not approved gets denied and is never confirmed', async () => {
    const s = await setup();
    const stranger = await s.device(1);
    const denied = stranger.waitFor('denied');
    await expect(stranger.hello()).rejects.toThrow(/denied/);
    await denied;
    await settle();
    expect(s.confirmed).toEqual([]);
    expect(s.sentKinds(stranger.peer, 'hello')).toBe(0);
    expect(s.channels.online().size).toBe(0);
  });

  it('spoofing: another key claims the approved fingerprint; its ready does not open, nothing is confirmed, rekey is sent', async () => {
    const s = await setup();
    const real = await s.device(1);
    s.devices.push(await approvedEntry(real));
    const spoofer = await s.device(2);

    const hs = await startHandshake(spoofer.identity, 'device', s.pc.publicKey);
    const reply = spoofer.waitFor('hello');
    spoofer.sendFrame({ k: 'hello', e: hs.hello, f: await fingerprint(real.publicKey) });
    // The PC answers with a handshake bound to the approved key, which the spoofer cannot complete.
    const ch = await hs.finish((await reply).e);
    const rekey = spoofer.waitFor('rekey');
    spoofer.sendFrame({ k: 'msg', s: await ch.seal(READY) });
    await rekey;
    spoofer.sendFrame({ k: 'msg', s: await ch.seal('rm -rf /') });
    await settle();

    expect(s.confirmed).toEqual([]);
    expect(s.messages).toEqual([]);
    expect(s.channels.online().size).toBe(0);
    expect(s.sentKinds(spoofer.peer, 'msg')).toBe(0);
  });

  it('a frame the relay delivers twice is ignored and the channel goes on', async () => {
    const s = await setup();
    const phone = await s.linkedDevice(1);
    const id = await fingerprint(phone.publicKey);
    const a = await phone.seal('a');
    phone.sendFrame(a);
    phone.sendFrame(a);
    await phone.send('b');
    await until(() => s.messages.length === 2, 'two messages');
    await settle();
    expect(s.messages).toEqual([[id, 'a'], [id, 'b']]);
    expect(s.sentKinds(phone.peer, 'rekey')).toBe(0);
    expect(s.channels.online()).toEqual(new Set([id]));
  });

  it('a lost frame (a skipped sequence) gets rekey; a new hello brings the channel back', async () => {
    const s = await setup();
    const phone = await s.linkedDevice(1);
    const id = await fingerprint(phone.publicKey);
    await phone.seal('lost'); // never sent
    const rekey = phone.waitFor('rekey');
    await phone.send('after the gap');
    await rekey;
    await until(() => s.closed.length === 1, 'onClosed');
    expect(s.closed).toEqual([id]);
    expect(s.channels.online().size).toBe(0);
    expect(await s.channels.send(id, 'nobody')).toBe(false);
    expect(s.messages).toEqual([]);

    await phone.hello();
    expect(s.confirmed).toEqual([[id, phone.peer], [id, phone.peer]]);
    await phone.send('back');
    await until(() => s.messages.length === 1, 'onMessage');
    expect(s.messages).toEqual([[id, 'back']]);
    expect(await s.channels.send(id, 'pong')).toBe(true);
    await until(() => phone.received.length === 1, 'device received');
    expect(phone.received).toEqual(['pong']);
  });

  it('a first message other than ready closes the channel and gets rekey', async () => {
    const s = await setup();
    const phone = await s.device(1);
    s.devices.push(await approvedEntry(phone));
    const hs = await startHandshake(phone.identity, 'device', s.pc.publicKey);
    const reply = phone.waitFor('hello');
    phone.sendFrame({ k: 'hello', e: hs.hello, f: await fingerprint(phone.publicKey) });
    const ch = await hs.finish((await reply).e);
    const rekey = phone.waitFor('rekey');
    phone.sendFrame({ k: 'msg', s: await ch.seal('not ready') });
    await rekey;
    // The channel is gone: a ready on it now goes nowhere.
    phone.sendFrame({ k: 'msg', s: await ch.seal(READY) });
    await settle();
    expect(s.confirmed).toEqual([]);
    expect(s.messages).toEqual([]);
  });

  it('reset() empties online(), and a msg that arrives after it gets rekey', async () => {
    const s = await setup();
    const phone = await s.linkedDevice(1);
    const id = await fingerprint(phone.publicKey);
    s.channels.reset();
    expect(s.channels.online().size).toBe(0);
    expect(s.closed).toEqual([id]);
    const rekey = phone.waitFor('rekey');
    await phone.send('late');
    await rekey;
    await settle();
    expect(s.messages).toEqual([]);
  });

  it('drop(peer) closes that peer\'s channel only', async () => {
    const s = await setup();
    const one = await s.linkedDevice(1);
    const two = await s.linkedDevice(2);
    const [id1, id2] = [await fingerprint(one.publicKey), await fingerprint(two.publicKey)];
    s.channels.drop(one.peer);
    expect(s.closed).toEqual([id1]);
    expect(s.channels.online()).toEqual(new Set([id2]));
    expect(await s.channels.send(id1, 'x')).toBe(false);
    expect(await s.channels.send(id2, 'y')).toBe(true);
  });

  it('dropDevice then a msg from that device gets denied, and nothing is opened', async () => {
    const s = await setup();
    const phone = await s.linkedDevice(1);
    const id = await fingerprint(phone.publicKey);
    s.devices.splice(0, 1);
    s.channels.dropDevice(id);
    expect(s.closed).toEqual([id]);
    expect(s.channels.online().size).toBe(0);
    const denied = phone.waitFor('denied');
    await phone.send('after revocation');
    await denied;
    await settle();
    expect(s.messages).toEqual([]);
    expect(s.sentKinds(phone.peer, 'rekey')).toBe(0);
    // A new hello from the revoked device is denied too.
    await expect(phone.hello()).rejects.toThrow(/denied/);
    expect(s.confirmed).toHaveLength(1);
  });

  it('revoked from the list while its channel is open: the next msg gets denied and the channel closes at once', async () => {
    const s = await setup();
    const phone = await s.linkedDevice(1);
    const id = await fingerprint(phone.publicKey);
    s.devices.splice(0, 1);
    const denied = phone.waitFor('denied');
    await phone.send('still there?');
    await denied;
    await until(() => s.closed.length === 1, 'onClosed');
    expect(s.closed).toEqual([id]);
    expect(s.messages).toEqual([]);
    expect(s.channels.online().size).toBe(0);
  });

  it('logs name fingerprints and peers, never message content or keys', async () => {
    const s = await setup();
    const phone = await s.linkedDevice(1);
    await phone.seal('secret-skipped');
    const rekey = phone.waitFor('rekey');
    await phone.send('secret-text');
    await rekey;
    const logText = readFileSync(paths().log, 'utf8');
    expect(logText).toContain(await fingerprint(phone.publicKey));
    expect(logText).not.toContain('secret');
    expect(logText).not.toContain(phone.publicKey);
    expect(logText).not.toContain(s.pc.publicKey);
  });
});

describe('sealed channels, driven directly', () => {
  function direct() {
    let t = Date.parse('2026-10-19T08:00:00.000Z');
    const sent: Array<[string, SealedFrame]> = [];
    const confirmed: string[] = [];
    const messages: string[] = [];
    const devices: ApprovedDevice[] = [];
    return {
      sent, confirmed, messages, devices,
      advance: (ms: number) => { t += ms; },
      make: (pc: Identity) => createChannels({
        pc,
        devices: () => devices,
        send: (peer, frame) => sent.push([peer, frame]),
        onConfirmed: (id) => confirmed.push(id),
        onMessage: (_id, text) => messages.push(text),
        onClosed: () => {},
        now: () => t
      })
    };
  }

  it('two rekeys provoked 1 s apart: only one is sent; 2 s later another may go; peers are counted apart', async () => {
    expect(REKEY_INTERVAL_MS).toBe(2000);
    const d = direct();
    const ch = d.make(await generateIdentity());
    const stray: SealedFrame = { k: 'msg', s: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' };
    await ch.receive(peerId(1), stray);
    d.advance(1000);
    await ch.receive(peerId(1), stray);
    expect(d.sent).toEqual([[peerId(1), { k: 'rekey' }]]);
    await ch.receive(peerId(2), stray);
    expect(d.sent).toHaveLength(2);
    d.advance(1000);
    await ch.receive(peerId(1), stray);
    expect(d.sent).toEqual([[peerId(1), { k: 'rekey' }], [peerId(2), { k: 'rekey' }], [peerId(1), { k: 'rekey' }]]);
  });

  it('a replayed hello and ready from an earlier channel: fresh keys, the old ready fails, nothing confirmed', async () => {
    const d = direct();
    const pc = await generateIdentity();
    const phone = await generateIdentity();
    d.devices.push(await approvedEntry(phone));
    const ch = d.make(pc);
    const peer = peerId(1);

    // A genuine session, captured by the relay.
    const hs = await startHandshake(phone, 'device', pc.publicKey);
    const hello: SealedFrame = { k: 'hello', e: hs.hello, f: await fingerprint(phone.publicKey) };
    await ch.receive(peer, hello);
    const answer = d.sent.at(-1)![1];
    if (answer.k !== 'hello') throw new Error('expected hello');
    const devCh = await hs.finish(answer.e);
    const ready: SealedFrame = { k: 'msg', s: await devCh.seal(READY) };
    const text: SealedFrame = { k: 'msg', s: await devCh.seal('ls') };
    await ch.receive(peer, ready);
    await ch.receive(peer, text);
    expect(d.confirmed).toHaveLength(1);
    expect(d.messages).toEqual(['ls']);

    // The relay replays it later, even from the same peer id.
    d.advance(5000);
    await ch.receive(peer, hello);
    await ch.receive(peer, ready);
    await ch.receive(peer, text);
    expect(d.confirmed).toHaveLength(1);
    expect(d.messages).toEqual(['ls']);
    expect(ch.online().size).toBe(0);
    expect(d.sent.at(-1)).toEqual([peer, { k: 'rekey' }]);
  });

  it('frames handed in without awaiting are processed in order per peer', async () => {
    const d = direct();
    const pc = await generateIdentity();
    const phone = await generateIdentity();
    d.devices.push(await approvedEntry(phone));
    const ch = d.make(pc);
    const peer = peerId(1);
    const hs = await startHandshake(phone, 'device', pc.publicKey);
    await ch.receive(peer, { k: 'hello', e: hs.hello, f: await fingerprint(phone.publicKey) });
    const answer = d.sent.at(-1)![1];
    if (answer.k !== 'hello') throw new Error('expected hello');
    const devCh = await hs.finish(answer.e);
    const frames = await Promise.all([READY, 'a', 'b', 'c'].map(async (x) => ({ k: 'msg' as const, s: await devCh.seal(x) })));
    await Promise.all(frames.map((f) => ch.receive(peer, f)));
    expect(d.confirmed).toHaveLength(1);
    expect(d.messages).toEqual(['a', 'b', 'c']);
  });
});
