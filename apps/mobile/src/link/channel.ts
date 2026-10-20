// The phone's sealed channel to the PC it pinned: the phone says hello, the PC answers, both send a sealed ready.
// Ported from the device role of packages/ledge/test/mobile-fake-device.ts; the PC side is packages/ledge/src/mobile/channels.ts.
import { PhoneServerMessageSchema, padPlain, type PhoneClientMessage, type PhoneServerMessage, type SealedFrame } from '@ledge/protocol';
import { fingerprint, SealError, startHandshake, type Channel, type Handshake, type Identity } from '@ledge/seal';
import type { PinnedPc } from './keys';

/** Key confirmation: the first sealed message each way, never padded (as on the PC). */
const READY = '{"t":"ready"}';

/**
 * `ready`: both readies crossed, messages flow. `key_changed`: the PC answered with another key; the channel is dead.
 * `denied`: the PC no longer knows this phone. `too_large`: a message past `PLAIN_MAX` was not sent.
 */
export type ChannelEvent = 'ready' | 'key_changed' | 'denied' | 'too_large';

export interface PhoneChannel {
  /** Drops the current channel and sends a new hello. Does nothing once the key changed. */
  hello(): Promise<void>;
  /** A frame from the PC (the caller checked the source peer); frames are handled in arrival order. */
  receive(f: SealedFrame): Promise<void>;
  /** Pads, seals and sends; false before `ready`, past `PLAIN_MAX`, or when the channel changed while sealing. */
  send(m: PhoneClientMessage): Promise<boolean>;
  ready(): boolean;
}

/**
 * The PC's hello must carry `fingerprint(pc.publicKey)`, or the channel ends in `key_changed` and nothing more leaves.
 * Any failure to open a PC message but a replay (a gap, a bad seal) drops the channel and says hello again; a replay is
 * ignored. A `rekey` from the PC says hello again. Only messages that pass `PhoneServerMessageSchema` reach `onMessage`,
 * and nothing of a message is ever logged.
 */
export function openChannel(opts: {
  identity: Identity;
  pc: PinnedPc;
  send(f: SealedFrame): void;
  onMessage(m: PhoneServerMessage): void;
  onEvent(e: ChannelEvent): void;
}): PhoneChannel {
  let dead = false;
  /** The handshake whose answer is awaited; consumed by the PC's hello. */
  let pending: Handshake | null = null;
  let channel: Channel | null = null;
  let confirmed = false;
  // Computed on first use, so a rejection surfaces in the call that needs it.
  let pcFp: Promise<string> | null = null;
  let ownFp: Promise<string> | null = null;
  const pcFingerprint = () => (pcFp ??= fingerprint(opts.pc.publicKey));
  const ownFingerprint = () => (ownFp ??= fingerprint(opts.identity.publicKey));

  // hello() and receive() run one at a time, in call order: the PC's ready lands after its hello is handled.
  let queue: Promise<void> = Promise.resolve();
  const serial = (task: () => Promise<void>): Promise<void> => {
    const run = queue.then(task);
    queue = run.catch(() => undefined);
    return run;
  };

  const drop = () => {
    pending = null;
    channel = null;
    confirmed = false;
  };

  const sayHello = async () => {
    if (dead) return;
    drop();
    const hs = await startHandshake(opts.identity, 'device', opts.pc.publicKey);
    const f = await ownFingerprint();
    if (dead) return;
    pending = hs;
    opts.send({ k: 'hello', e: hs.hello, f });
  };

  const onHello = async (frame: Extract<SealedFrame, { k: 'hello' }>) => {
    const hs = pending;
    // Not an answer to a hello of ours.
    if (!hs) return;
    pending = null;
    if (frame.f !== (await pcFingerprint())) {
      dead = true;
      drop();
      opts.onEvent('key_changed');
      return;
    }
    let ch: Channel;
    try {
      ch = await hs.finish(frame.e);
    } catch {
      // Not a key: ignored, as a frame that fails its schema; the next welcome, presence or rekey says hello again.
      return;
    }
    channel = ch;
    // Sealed before the channel counts as confirmed, so the phone's ready is its first sealed message.
    opts.send({ k: 'msg', s: await ch.seal(READY) });
  };

  const onMsg = async (frame: Extract<SealedFrame, { k: 'msg' }>) => {
    const ch = channel;
    if (!ch) return;
    let text: string;
    try {
      text = await ch.open(frame.s);
    } catch (err) {
      if (err instanceof SealError && err.code === 'replay') return;
      // A lost frame (gap) or a frame that does not authenticate: this channel cannot resume.
      return sayHello();
    }
    if (!confirmed) {
      if (text !== READY) return sayHello();
      confirmed = true;
      opts.onEvent('ready');
      return;
    }
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { return; }
    const m = PhoneServerMessageSchema.safeParse(raw);
    if (m.success) opts.onMessage(m.data);
  };

  const handle = async (f: SealedFrame) => {
    if (dead) return;
    if (f.k === 'hello') return onHello(f);
    if (f.k === 'msg') return onMsg(f);
    if (f.k === 'rekey') return sayHello();
    if (f.k === 'denied') {
      drop();
      opts.onEvent('denied');
    }
    // pair_* belong to pairing.
  };

  return {
    hello() {
      // Not ready from this call on: nothing is sealed to the old channel while the hello waits its turn.
      if (!dead) drop();
      return serial(sayHello);
    },
    receive: (f) => serial(() => handle(f)),
    async send(m) {
      const ch = channel;
      if (dead || !confirmed || !ch) return false;
      const plain = padPlain(JSON.stringify(m));
      if (plain === null) {
        opts.onEvent('too_large');
        return false;
      }
      const s = await ch.seal(plain);
      // Dropped while sealing: this sequence number belongs to a channel the PC no longer has.
      if (channel !== ch || dead) return false;
      opts.send({ k: 'msg', s });
      return true;
    },
    ready: () => !dead && confirmed && channel !== null
  };
}
