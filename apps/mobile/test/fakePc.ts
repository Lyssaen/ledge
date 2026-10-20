// A fake PC on the real relay (dev tokens): with @ledge/seal it plays the `pc` side of the lot 3 fake device
// (packages/ledge/test/mobile-fake-device.ts). Node only: it authenticates with an Authorization header (ruling R1).
import {
  RelayServerMessageSchema, SealedFrameSchema,
  type PhoneServerMessage, type RelayServerMessage, type SealedFrame
} from '@ledge/protocol';
import {
  checkCommitment, fingerprint, generateIdentity, pairingCode, randomNonce, startHandshake,
  type Channel, type Identity
} from '@ledge/seal';
import { startTestRelay, type TestRelay } from '../../../packages/ledge/test/mobile-relay-harness';
import { pad } from '../../../packages/ledge/src/mobile/pad';

const READY = '{"t":"ready"}';
const ONLINE_WITHIN_MS = 3000;
/** Every wait for the phone fails after this, rather than hanging until vitest's timeout. */
const REPLY_WITHIN_MS = 4000;

/** A WebSocket class that offers `token` as `Authorization: Bearer` (Node's WebSocket takes headers; a browser's does not). */
export function bearerWebSocket(token: string): typeof WebSocket {
  return class extends WebSocket {
    constructor(url: string | URL) {
      super(url, { headers: { authorization: `Bearer ${token}` } } as unknown as string[]);
    }
  };
}

export interface FakePc {
  relay: TestRelay;
  /** The relay origin the phone's socket opens. */
  url: string;
  identity: Identity;
  /** The relay peer the phone connects as, and the WebSocket class that authenticates it. */
  phonePeer: string;
  PhoneWebSocket: typeof WebSocket;
  /** The phone's key: from its reveal, or `opts.devicePublicKey`. A hello from another key gets `denied`. */
  readonly devicePublicKey: string | null;
  /** Resolves with the code the PC computes once a reveal matches its commitment. */
  code(): Promise<string>;
  /** Sends `pair_offer` for the last `pair_commit` (done at once unless `autoOffer: false`). */
  offer(): void;
  ok(): void;
  no(): void;
  /** Pads, seals and sends a phone message on the confirmed channel. */
  send(m: PhoneServerMessage): Promise<void>;
  /** True once the phone's sealed ready opened and the PC answered its own. */
  readonly ready: boolean;
  /** Texts opened from the phone after its ready, padding trimmed. */
  received: string[];
  /** Every sealed frame received from the phone, parsed. */
  frames: SealedFrame[];
  /** Resolves with the next frame of kind `k` from the phone, once handled; rejects after `ms` (default 4 s). */
  waitFor<K extends SealedFrame['k']>(k: K, ms?: number): Promise<Extract<SealedFrame, { k: K }>>;
  /** Raw escape hatch: sends any frame to the phone. */
  sendFrame(frame: SealedFrame): void;
  close(): Promise<void>;
}

export async function startFakePc(opts: {
  autoOffer?: boolean;
  /** For tests that skip pairing. */
  devicePublicKey?: string;
  identity?: Identity;
  phonePeer?: string;
} = {}): Promise<FakePc> {
  const relay = await startTestRelay();
  const identity = opts.identity ?? (await generateIdentity());
  const phonePeer = opts.phonePeer ?? 'd_phonephonephone01';
  const autoOffer = opts.autoOffer ?? true;

  let devicePublicKey = opts.devicePublicKey ?? null;
  let commitment: { c: string; pcNonce: string } | null = null;
  let channel: Channel | null = null;
  let ready = false;
  let resolveCode!: (code: string) => void;
  let codeP = new Promise<string>((r) => { resolveCode = r; });
  const received: string[] = [];
  const frames: SealedFrame[] = [];
  type Waiter = { k: SealedFrame['k']; resolve(f: SealedFrame): void; timer: ReturnType<typeof setTimeout> };
  const waiters: Waiter[] = [];

  const ws = new (bearerWebSocket(relay.pcToken))(`${relay.url.replace(/^http/, 'ws')}/ws`);
  const sendFrame = (frame: SealedFrame) => {
    ws.send(JSON.stringify({ type: 'send', to: phonePeer, body: JSON.stringify(frame) }));
  };

  const onHello = async (frame: Extract<SealedFrame, { k: 'hello' }>) => {
    if (!devicePublicKey || frame.f !== (await fingerprint(devicePublicKey))) { sendFrame({ k: 'denied' }); return; }
    channel = null;
    ready = false;
    const hs = await startHandshake(identity, 'pc', devicePublicKey);
    const ch = await hs.finish(frame.e);
    channel = ch;
    sendFrame({ k: 'hello', e: hs.hello, f: await fingerprint(identity.publicKey) });
  };

  const onMsg = async (frame: Extract<SealedFrame, { k: 'msg' }>) => {
    const ch = channel;
    if (!ch) return;
    const text = await ch.open(frame.s);
    if (!ready) {
      if (text !== READY) return;
      ready = true;
      sendFrame({ k: 'msg', s: await ch.seal(READY) });
      return;
    }
    received.push(text.trimEnd());
  };

  const onFrame = async (frame: SealedFrame) => {
    if (frame.k === 'pair_commit') {
      commitment = { c: frame.c, pcNonce: randomNonce() };
      codeP = new Promise<string>((r) => { resolveCode = r; });
      if (autoOffer) sendFrame({ k: 'pair_offer', pc: identity.publicKey, n: commitment.pcNonce });
    } else if (frame.k === 'pair_reveal') {
      const cm = commitment;
      if (!cm || !(await checkCommitment(cm.c, frame.d, frame.n))) { sendFrame({ k: 'pair_no' }); return; }
      devicePublicKey = frame.d;
      resolveCode(await pairingCode({ pcPublicKey: identity.publicKey, devicePublicKey: frame.d, deviceNonce: frame.n, pcNonce: cm.pcNonce }));
    } else if (frame.k === 'hello') {
      await onHello(frame);
    } else if (frame.k === 'msg') {
      await onMsg(frame);
    }
  };

  // Frames are handled one at a time, in arrival order, as the daemon does.
  let queue = Promise.resolve();
  ws.onmessage = (ev: MessageEvent) => {
    let raw: unknown;
    try { raw = JSON.parse(String(ev.data)); } catch { return; }
    const m = RelayServerMessageSchema.safeParse(raw);
    if (!m.success || m.data.type !== 'deliver' || m.data.from !== phonePeer) return;
    let body: unknown;
    try { body = JSON.parse(m.data.body); } catch { return; }
    const f = SealedFrameSchema.safeParse(body);
    if (!f.success) return;
    const frame = f.data;
    frames.push(frame);
    // Waiters hear of a frame once it is handled, so `offer()` after `waitFor('pair_commit')` finds the commitment.
    queue = queue.then(() => onFrame(frame)).catch(() => {}).then(() => {
      for (const w of waiters.filter((x) => x.k === frame.k)) {
        waiters.splice(waiters.indexOf(w), 1);
        clearTimeout(w.timer);
        w.resolve(frame);
      }
    });
  };

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('fake PC: no welcome from the relay')), ONLINE_WITHIN_MS);
    ws.addEventListener('message', function onWelcome(ev: MessageEvent) {
      let parsed: RelayServerMessage | null = null;
      try { parsed = RelayServerMessageSchema.parse(JSON.parse(String(ev.data))); } catch { return; }
      if (parsed.type !== 'welcome') return;
      clearTimeout(timer);
      ws.removeEventListener('message', onWelcome);
      resolve();
    });
    ws.addEventListener('close', () => { clearTimeout(timer); reject(new Error('fake PC: relay refused the PC')); }, { once: true });
  });

  const offer = () => {
    if (!commitment) throw new Error('fake PC: no pair_commit to answer');
    sendFrame({ k: 'pair_offer', pc: identity.publicKey, n: commitment.pcNonce });
  };

  return {
    relay,
    url: relay.url,
    identity,
    phonePeer,
    PhoneWebSocket: bearerWebSocket(relay.deviceToken(phonePeer)),
    get devicePublicKey() { return devicePublicKey; },
    get ready() { return ready; },
    code: () => codeP,
    offer,
    ok: () => sendFrame({ k: 'pair_ok' }),
    no: () => sendFrame({ k: 'pair_no' }),
    async send(m) {
      if (!channel || !ready) throw new Error('fake PC: no confirmed channel');
      const plain = pad(JSON.stringify(m));
      if (plain === null) throw new Error('fake PC: message past PLAIN_MAX');
      sendFrame({ k: 'msg', s: await channel.seal(plain) });
    },
    received,
    frames,
    waitFor<K extends SealedFrame['k']>(k: K, ms = REPLY_WITHIN_MS) {
      return new Promise<Extract<SealedFrame, { k: K }>>((resolve, reject) => {
        const w: Waiter = {
          k,
          resolve: resolve as (f: SealedFrame) => void,
          timer: setTimeout(() => {
            waiters.splice(waiters.indexOf(w), 1);
            reject(new Error(`fake PC: no ${k} within ${ms} ms`));
          }, ms)
        };
        waiters.push(w);
      });
    },
    sendFrame,
    async close() {
      ws.close();
      await relay.relay.close();
    }
  };
}
