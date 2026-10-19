// A fake phone on the real relay: it plays, with @ledge/seal, the device role the PWA will carry in lot 5.
import { SealedFrameSchema, type SealedFrame } from '@ledge/protocol';
import {
  commit, fingerprint, generateIdentity, pairingCode, randomNonce, startHandshake,
  type Channel, type Identity
} from '@ledge/seal';
import { createRelayLink, type LinkState } from '../src/mobile/link.js';

const READY = '{"t":"ready"}';
const ONLINE_WITHIN_MS = 3000;
/** Every wait for the PC (a frame, a ready) fails after this, rather than hanging until vitest's timeout. */
const REPLY_WITHIN_MS = 4000;

export interface FakeDevice {
  /** The device's static key pair; `publicKey` is its approved identity once paired. */
  identity: Identity;
  publicKey: string;
  /** The relay peer id (`d_…`) this device connects as. */
  peer: string;
  /** Commit, wait for the PC's offer, reveal; resolves once the code is computed. Rejects on `pair_no` before the offer. */
  pair(): Promise<{ code: string; result: Promise<'ok' | 'no'> }>;
  /**
   * Handshake with the PC whose key came from `pair_offer` (or `opts.pcPublicKey`), then both sides exchange a sealed ready.
   * Rejects on `denied`, or when the PC's hello or ready does not come within 4 s.
   */
  hello(): Promise<void>;
  /** Seals `text` in a `msg` on the channel opened by `hello()`. */
  send(text: string): Promise<void>;
  /** Application texts opened from the PC's sealed messages, in order (never the handshake's ready). */
  received: string[];
  /** Every sealed frame received from the PC, parsed. */
  frames: SealedFrame[];
  /** Resolves with the next frame of kind `k` received after this call; rejects after `ms` (default 4 s). */
  waitFor<K extends SealedFrame['k']>(k: K, ms?: number): Promise<Extract<SealedFrame, { k: K }>>;
  /** Seals `text` on the current channel and returns the `msg` frame without sending it (lost-frame and replay tests). */
  seal(text: string): Promise<SealedFrame>;
  /** How many of the PC's sealed messages failed to open on this device. */
  readonly openFailures: number;
  /** Every state of the device's own relay link, in order (`signed_out` `other_pc` is a 4001 close). */
  linkStates: LinkState[];
  /** Raw escape hatch: sends any frame to the PC, for spoofing and replay tests. */
  sendFrame(frame: SealedFrame): void;
  close(): void;
}

export async function fakeDevice(opts: {
  relayUrl: string;
  token: string;
  peer: string;
  label?: string;
  /** For tests that skip pairing. */
  pcPublicKey?: string;
  identity?: Identity;
}): Promise<FakeDevice> {
  const identity = opts.identity ?? (await generateIdentity());
  let pcPublicKey = opts.pcPublicKey ?? null;
  let channel: Channel | null = null;
  let ready = false;
  let onReady: (() => void) | null = null;
  const received: string[] = [];
  const frames: SealedFrame[] = [];
  let openFailures = 0;
  type Waiter = { k: SealedFrame['k']; resolve(f: SealedFrame): void; timer: ReturnType<typeof setTimeout> | undefined };
  const waiters: Waiter[] = [];

  let onOnline: ((s: LinkState) => void) | null = null;
  const linkStates: LinkState[] = [];
  const link = createRelayLink({
    relayUrl: opts.relayUrl,
    token: opts.token,
    onState: (s) => { linkStates.push(s); onOnline?.(s); },
    onMessage(m) {
      if (m.type !== 'deliver' || m.from !== 'pc') return;
      let raw: unknown;
      try { raw = JSON.parse(m.body); } catch { return; }
      const r = SealedFrameSchema.safeParse(raw);
      if (!r.success) return;
      const frame = r.data;
      frames.push(frame);
      for (const w of waiters.filter((x) => x.k === frame.k)) {
        waiters.splice(waiters.indexOf(w), 1);
        clearTimeout(w.timer);
        w.resolve(frame);
      }
      if (frame.k === 'msg' && channel) {
        const ch = channel;
        // Channel.open is serialised, so texts land in arrival order.
        ch.open(frame.s).then((text) => {
          if (ch !== channel) return;
          if (!ready && text === READY) { ready = true; onReady?.(); return; }
          received.push(text);
        }, () => { if (ch === channel) openFailures++; });
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('fake device: relay not online')), ONLINE_WITHIN_MS);
    onOnline = (s) => {
      if (s.state === 'online') { clearTimeout(timer); onOnline = null; resolve(); }
      if (s.state === 'signed_out') { clearTimeout(timer); onOnline = null; reject(new Error(`fake device: ${s.reason}`)); }
    };
  });

  /** A wait that can be withdrawn, so a frame that lost a race leaves no stale waiter behind. `ms = Infinity`: no timeout. */
  const wait = <K extends SealedFrame['k']>(k: K, ms = REPLY_WITHIN_MS) => {
    let w!: Waiter;
    const promise = new Promise<Extract<SealedFrame, { k: K }>>((resolve, reject) => {
      w = {
        k,
        resolve: resolve as (f: SealedFrame) => void,
        timer: Number.isFinite(ms)
          ? setTimeout(() => { cancel(); reject(new Error(`fake device: no ${k} within ${ms} ms`)); }, ms)
          : undefined
      };
      waiters.push(w);
    });
    const cancel = () => {
      clearTimeout(w.timer);
      const i = waiters.indexOf(w);
      if (i >= 0) waiters.splice(i, 1);
    };
    return { promise, cancel };
  };
  const waitFor = <K extends SealedFrame['k']>(k: K, ms?: number) => wait(k, ms).promise;

  const sendFrame = (frame: SealedFrame) => {
    if (!link.send({ type: 'send', to: 'pc', body: JSON.stringify(frame) })) throw new Error('fake device: link not online');
  };

  return {
    identity,
    publicKey: identity.publicKey,
    peer: opts.peer,
    received,
    frames,
    linkStates,
    waitFor,
    sendFrame,
    get openFailures() { return openFailures; },

    async pair() {
      const nonce = randomNonce();
      const offer = wait('pair_offer');
      const refused = wait('pair_no');
      sendFrame({ k: 'pair_commit', c: await commit(identity.publicKey, nonce), label: opts.label ?? 'Pixel · Chrome' });
      const first = await Promise.race([offer.promise, refused.promise]).finally(() => { offer.cancel(); refused.cancel(); });
      if (first.k === 'pair_no') throw new Error('fake device: pair_no before the offer');
      pcPublicKey = first.pc;
      // No timeout here: the answer waits on the user's decision, which the test drives.
      const ok = wait('pair_ok', Infinity);
      const no = wait('pair_no', Infinity);
      const result = Promise.race([ok.promise, no.promise])
        .finally(() => { ok.cancel(); no.cancel(); })
        .then((f) => (f.k === 'pair_ok' ? 'ok' as const : 'no' as const));
      sendFrame({ k: 'pair_reveal', d: identity.publicKey, n: nonce });
      const code = await pairingCode({ pcPublicKey: first.pc, devicePublicKey: identity.publicKey, deviceNonce: nonce, pcNonce: first.n });
      return { code, result };
    },

    async hello() {
      if (!pcPublicKey) throw new Error('fake device: no PC key (pair first or pass pcPublicKey)');
      const pcKey = pcPublicKey;
      channel = null;
      ready = false;
      const hs = await startHandshake(identity, 'device', pcKey);
      const reply = wait('hello');
      const denied = wait('denied');
      sendFrame({ k: 'hello', e: hs.hello, f: await fingerprint(identity.publicKey) });
      const answer = await Promise.race([reply.promise, denied.promise]).finally(() => { reply.cancel(); denied.cancel(); });
      if (answer.k === 'denied') throw new Error('fake device: denied');
      if (answer.f !== (await fingerprint(pcKey))) throw new Error('fake device: hello from another key');
      const ch = await hs.finish(answer.e);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const isReady = new Promise<void>((resolve, reject) => {
        onReady = resolve;
        timer = setTimeout(() => reject(new Error(`fake device: no ready within ${REPLY_WITHIN_MS} ms`)), REPLY_WITHIN_MS);
      });
      channel = ch;
      sendFrame({ k: 'msg', s: await ch.seal(READY) });
      await isReady.finally(() => { clearTimeout(timer); onReady = null; });
    },

    async seal(text) {
      if (!channel || !ready) throw new Error('fake device: no confirmed channel (call hello first)');
      return { k: 'msg', s: await channel.seal(text) };
    },

    async send(text) {
      if (!channel || !ready) throw new Error('fake device: no confirmed channel (call hello first)');
      sendFrame({ k: 'msg', s: await channel.seal(text) });
    },

    close() {
      link.close();
    }
  };
}
