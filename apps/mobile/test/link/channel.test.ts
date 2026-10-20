// @vitest-environment node
// Node's own WebSocket reaches the real relay; jsdom's would replace it.
import { afterEach, describe, expect, it } from 'vitest';
import { SealedFrameSchema, type PhoneClientMessage, type PhoneServerMessage } from '@ledge/protocol';
import { b64u, fingerprint, generateIdentity } from '@ledge/seal';
import { openRelaySocket, type SocketState } from '../../src/link/socket';
import { openChannel, type ChannelEvent } from '../../src/link/channel';
import type { PinnedPc } from '../../src/link/keys';
import { startFakePc } from '../fakePc';

async function until(cond: () => boolean, what = 'condition'): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}
const settle = () => new Promise((r) => setTimeout(r, 150));
const bytes = (t: string) => new TextEncoder().encode(t).length;

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });

/** A fake PC that knows the phone's key, the phone's socket on the same relay, and its channel to the pinned PC. */
async function setup() {
  const identity = await generateIdentity();
  const pc = await startFakePc({ devicePublicKey: identity.publicKey });
  cleanups.push(() => pc.close());
  const pinned: PinnedPc = { publicKey: pc.identity.publicKey, fingerprint: await fingerprint(pc.identity.publicKey), name: null, pinnedAt: '2026-10-20T08:00:00.000Z' };
  const events: ChannelEvent[] = [];
  const messages: PhoneServerMessage[] = [];
  const states: SocketState[] = [];
  let channel: ReturnType<typeof openChannel> | null = null;
  const sock = openRelaySocket({
    url: pc.url,
    WebSocketImpl: pc.PhoneWebSocket,
    onState: (s) => states.push(s),
    onFrame(m) {
      if (m.type !== 'deliver' || m.from !== 'pc' || !channel) return;
      const f = SealedFrameSchema.safeParse(JSON.parse(m.body));
      if (f.success) void channel.receive(f.data);
    }
  });
  cleanups.push(() => sock.close());
  await until(() => states.includes('open'), 'the phone socket');
  const ch = openChannel({
    identity,
    pc: pinned,
    send: (f) => { sock.send('pc', f); },
    onMessage: (m) => messages.push(m),
    onEvent: (e) => events.push(e)
  });
  channel = ch;
  const hellos = () => pc.frames.filter((f) => f.k === 'hello').length;
  return { pc, ch, events, messages, hellos };
}

/** Hello, then both readies. */
async function ready() {
  const s = await setup();
  await s.ch.hello();
  await until(() => s.ch.ready() && s.pc.ready, 'the channel');
  return s;
}

const removed = (id: string): PhoneServerMessage => ({ type: 'session.removed', id });
const snapshotRequest: PhoneClientMessage = { type: 'snapshot.request' };

describe('the sealed channel to the pinned PC', () => {
  it('after hello, the first sealed message is exactly {"t":"ready"}, unpadded', async () => {
    const { pc, ch, events } = await ready();
    expect(pc.plains[0]).toBe('{"t":"ready"}');
    expect(events).toEqual(['ready']);
    expect(ch.ready()).toBe(true);
  });

  it('sends nothing before ready', async () => {
    const { pc, ch } = await setup();
    expect(await ch.send(snapshotRequest)).toBe(false);
    await settle();
    expect(pc.frames).toEqual([]);
  });

  it('pads a 10-byte message to 1 024 bytes', async () => {
    const { pc, ch } = await ready();
    const tiny = { t: 'ab' } as unknown as PhoneClientMessage;
    expect(bytes(JSON.stringify(tiny))).toBe(10);
    expect(await ch.send(tiny)).toBe(true);
    await until(() => pc.plains.length === 2, 'the message');
    expect(bytes(pc.plains[1]!)).toBe(1024);
    expect(pc.plains[1]!.trimEnd()).toBe('{"t":"ab"}');
  });

  it('does not send a message past PLAIN_MAX, and says so', async () => {
    const { pc, ch, events } = await ready();
    const huge: PhoneClientMessage = { type: 'session.reply', op: '123e4567-e89b-42d3-a456-426614174000', id: 's1', text: 'x'.repeat(700_000), expect: null };
    const before = pc.frames.length;
    expect(await ch.send(huge)).toBe(false);
    expect(events).toContain('too_large');
    expect(await ch.send(snapshotRequest)).toBe(true);
    await until(() => pc.received.length === 1, 'the next message');
    expect(pc.frames.length).toBe(before + 1);
    expect(pc.received).toEqual([JSON.stringify(snapshotRequest)]);
  });

  it('opens the PC messages, padding and all', async () => {
    const { pc, messages } = await ready();
    await pc.send(removed('s1'));
    await until(() => messages.length === 1, 'the message');
    expect(messages).toEqual([removed('s1')]);
  });

  it('a hello from another key → key_changed, and nothing more leaves', async () => {
    const { pc, ch, events } = await setup();
    pc.answerAs(await generateIdentity());
    await ch.hello();
    await until(() => events.includes('key_changed'), 'key_changed');
    await settle();
    // The phone's ready never left: it would be sealed to a key the user never confirmed.
    expect(pc.frames.map((f) => f.k)).toEqual(['hello']);
    expect(ch.ready()).toBe(false);
    await ch.hello();
    expect(await ch.send(snapshotRequest)).toBe(false);
    await settle();
    expect(pc.frames.map((f) => f.k)).toEqual(['hello']);
  });

  it('denied → the denied event, and no channel', async () => {
    const { pc, ch, events } = await setup();
    pc.forgetDevice();
    await ch.hello();
    await until(() => events.includes('denied'), 'denied');
    expect(ch.ready()).toBe(false);
    expect(await ch.send(snapshotRequest)).toBe(false);
  });

  it('rekey → a new hello, then ready again', async () => {
    const { pc, ch, events, hellos } = await ready();
    pc.sendFrame({ k: 'rekey' });
    await until(() => hellos() === 2 && pc.ready && ch.ready(), 'the second ready');
    expect(events).toEqual(['ready', 'ready']);
    expect(pc.plains.filter((t) => t === '{"t":"ready"}')).toHaveLength(2);
  });

  it('a gap on opening → a new hello; the message after the gap is not delivered', async () => {
    const { pc, ch, messages, hellos } = await ready();
    await pc.skip();
    await pc.send(removed('lost-after-gap'));
    await until(() => hellos() === 2 && pc.ready && ch.ready(), 'the second ready');
    expect(messages).toEqual([]);
  });

  it('a bad seal on opening → a new hello', async () => {
    const { pc, ch, hellos } = await ready();
    // Sequence 1, the next the phone expects, with a tag that does not authenticate.
    const seq = new Uint8Array(8);
    seq[7] = 1;
    const forged = new Uint8Array(40);
    forged.set(seq);
    pc.sendFrame({ k: 'msg', s: b64u(forged) });
    await until(() => hellos() === 2 && pc.ready && ch.ready(), 'the second ready');
  });

  it('a replayed message is ignored, and the channel stays', async () => {
    const { pc, messages, hellos } = await ready();
    await pc.send(removed('a'));
    await until(() => messages.length === 1, 'a');
    pc.sendFrame(pc.sent[pc.sent.length - 1]!);
    await pc.send(removed('b'));
    await until(() => messages.length === 2, 'b');
    await settle();
    expect(messages).toEqual([removed('a'), removed('b')]);
    expect(hellos()).toBe(1);
  });
});
