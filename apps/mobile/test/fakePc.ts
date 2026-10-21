// A fake PC on the real relay (dev tokens): with @ledge/seal it plays the `pc` side of the lot 3 fake device
// (packages/ledge/test/mobile-fake-device.ts). Node only: it authenticates with an Authorization header (ruling R1).
import {
  RelayServerMessageSchema, SealedFrameSchema, padPlain,
  type PhoneClientMessage, type PhoneServerMessage, type RelayServerMessage, type SealedFrame
} from '@ledge/protocol';
import {
  checkCommitment, fingerprint, generateIdentity, pairingCode, randomNonce, SealError, startHandshake,
  type Channel, type Identity
} from '@ledge/seal';
import { startTestRelay, type TestRelay } from '../../../packages/ledge/test/mobile-relay-harness';
// The daemon's own verification, not a copy: both modules import only node:crypto.
import { createChallengeStore, CHALLENGE_TTL_MS } from '../../../packages/ledge/src/mobile/challenges';
import {
  challengeOf, rpOf, verifyAssertion, verifyRegistration, type DeviceCredential
} from '../../../packages/ledge/src/mobile/webauthn';

const READY = '{"t":"ready"}';
const ONLINE_WITHIN_MS = 3000;
/** Every wait for the phone fails after this, rather than hanging until vitest's timeout. */
const REPLY_WITHIN_MS = 4000;
/** A P-256 point off the curve (packages/seal/test/vectors.json): it passes the frame schema, never `finish`. */
const OFF_CURVE = 'BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE';

/**
 * A WebSocket class that offers `token` as `Authorization: Bearer` (Node's WebSocket takes headers; a browser's does not).
 * Every socket it opens is pushed to `opened`, if given.
 */
export function bearerWebSocket(token: string, opened?: WebSocket[]): typeof WebSocket {
  return class extends WebSocket {
    constructor(url: string | URL) {
      super(url, { headers: { authorization: `Bearer ${token}` } } as unknown as string[]);
      opened?.push(this);
    }
  };
}

export interface FakePc {
  relay: TestRelay;
  /** The relay origin the phone's socket opens. */
  url: string;
  identity: Identity;
  /** The relay peer the phone connects as, and the WebSocket class that authenticates it (dev tokens only). */
  readonly phonePeer: string;
  readonly PhoneWebSocket: typeof WebSocket;
  /** The phone's key: from its reveal, or `opts.devicePublicKey`. A hello from another key gets `denied`. */
  readonly devicePublicKey: string | null;
  /** Resolves with the code the PC computes once a reveal matches its commitment, the next one if none matched yet. */
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
  /** Every text opened from the phone, its ready included, exactly as sealed (padding kept). */
  plains: string[];
  /** Every sealed frame received from the phone, parsed. */
  frames: SealedFrame[];
  /** Every sealed frame sent to the phone, in order (replay tests). */
  sent: SealedFrame[];
  /** Errors thrown while handling a phone frame; a waiter for that frame's kind rejects with it. */
  errors: unknown[];
  /** Resolves with the next frame of kind `k` from the phone, once handled; rejects after `ms` (default 4 s). */
  waitFor<K extends SealedFrame['k']>(k: K, ms?: number): Promise<Extract<SealedFrame, { k: K }>>;
  /** Raw escape hatch: sends any frame to the phone. */
  sendFrame(frame: SealedFrame): void;
  /** Answers the phone's next hellos as `identity` (a reinstalled PC, or a relay in the middle). */
  answerAs(identity: Identity): void;
  /** Forgets the phone's key: its next hello gets `denied` (a revoked device). */
  forgetDevice(): void;
  /** Answers the phone's next `n` hellos with a key that is not one (an off-curve point), the right fingerprint kept. */
  badHellos(n: number): void;
  /** Seals a message on the confirmed channel and drops it, so the next one reaches the phone with a gap. */
  skip(): Promise<void>;
  /** Closes the PC's socket (the phone sees `presence` offline) and forgets its channel; `reconnect()` opens a new one. */
  disconnect(): Promise<void>;
  reconnect(): Promise<void>;
  /** The sockets opened by `PhoneWebSocket`, in order. */
  phoneSockets: WebSocket[];
  /** Hands `m` to the phone's latest socket as if the relay had sent it. */
  injectToPhone(m: RelayServerMessage): void;
  close(): Promise<void>;
}

export async function startFakePc(opts: {
  autoOffer?: boolean;
  /** For tests that skip pairing. */
  devicePublicKey?: string;
  identity?: Identity;
  phonePeer?: string;
  /** A relay already running, the PC signed in on it (the e2e harness's accounts relay); otherwise one is started. */
  relay?: TestRelay;
  /** The phone signs in on its own: its peer is the first device's that sends the PC a frame. */
  learnPeer?: boolean;
} = {}): Promise<FakePc> {
  const relay = opts.relay ?? (await startTestRelay());
  const identity = opts.identity ?? (await generateIdentity());
  let phonePeer = opts.phonePeer ?? 'd_phonephonephone01';
  let peerKnown = !opts.learnPeer;
  const autoOffer = opts.autoOffer ?? true;

  let devicePublicKey = opts.devicePublicKey ?? null;
  let helloIdentity = identity;
  let badHellosLeft = 0;
  let commitment: { c: string; pcNonce: string } | null = null;
  let channel: Channel | null = null;
  let ready = false;
  let resolveCode!: (code: string) => void;
  /** `codeP` has resolved: the next commitment gets a new one, so a `code()` made before a commitment still waits for it. */
  let codeSettled = false;
  let codeP = new Promise<string>((r) => { resolveCode = r; });
  const received: string[] = [];
  const plains: string[] = [];
  const frames: SealedFrame[] = [];
  const sent: SealedFrame[] = [];
  const errors: unknown[] = [];
  const phoneSockets: WebSocket[] = [];
  type Waiter = { k: SealedFrame['k']; resolve(f: SealedFrame): void; reject(e: unknown): void; timer: ReturnType<typeof setTimeout> };
  const waiters: Waiter[] = [];

  let ws!: WebSocket;
  const sendFrame = (frame: SealedFrame) => {
    sent.push(frame);
    ws.send(JSON.stringify({ type: 'send', to: phonePeer, body: JSON.stringify(frame) }));
  };

  const onHello = async (frame: Extract<SealedFrame, { k: 'hello' }>) => {
    if (!devicePublicKey || frame.f !== (await fingerprint(devicePublicKey))) { sendFrame({ k: 'denied' }); return; }
    channel = null;
    ready = false;
    if (badHellosLeft > 0) {
      badHellosLeft--;
      sendFrame({ k: 'hello', e: OFF_CURVE, f: await fingerprint(helloIdentity.publicKey) });
      return;
    }
    const as = helloIdentity;
    const hs = await startHandshake(as, 'pc', devicePublicKey);
    const ch = await hs.finish(frame.e);
    channel = ch;
    sendFrame({ k: 'hello', e: hs.hello, f: await fingerprint(as.publicKey) });
  };

  const onMsg = async (frame: Extract<SealedFrame, { k: 'msg' }>) => {
    const ch = channel;
    if (!ch) return;
    let text: string;
    try {
      text = await ch.open(frame.s);
    } catch (e) {
      // As the daemon: a replay is dropped, any other failure closes the channel and asks for a new hello.
      if (e instanceof SealError && e.code === 'replay') return;
      if (channel === ch) { channel = null; ready = false; }
      sendFrame({ k: 'rekey' });
      return;
    }
    plains.push(text);
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
      if (codeSettled) {
        codeSettled = false;
        codeP = new Promise<string>((r) => { resolveCode = r; });
      }
      if (autoOffer) sendFrame({ k: 'pair_offer', pc: identity.publicKey, n: commitment.pcNonce });
    } else if (frame.k === 'pair_reveal') {
      const cm = commitment;
      if (!cm || !(await checkCommitment(cm.c, frame.d, frame.n))) { sendFrame({ k: 'pair_no' }); return; }
      devicePublicKey = frame.d;
      codeSettled = true;
      resolveCode(await pairingCode({ pcPublicKey: identity.publicKey, devicePublicKey: frame.d, deviceNonce: frame.n, pcNonce: cm.pcNonce }));
    } else if (frame.k === 'hello') {
      await onHello(frame);
    } else if (frame.k === 'msg') {
      await onMsg(frame);
    }
  };

  // Frames are handled one at a time, in arrival order, as the daemon does.
  let queue = Promise.resolve();
  const onMessage = (ev: MessageEvent) => {
    let raw: unknown;
    try { raw = JSON.parse(String(ev.data)); } catch { return; }
    const m = RelayServerMessageSchema.safeParse(raw);
    if (!m.success || m.data.type !== 'deliver') return;
    if (!peerKnown && m.data.from !== 'pc') { phonePeer = m.data.from; peerKnown = true; }
    if (m.data.from !== phonePeer) return;
    let body: unknown;
    try { body = JSON.parse(m.data.body); } catch { return; }
    const f = SealedFrameSchema.safeParse(body);
    if (!f.success) return;
    const frame = f.data;
    frames.push(frame);
    // Waiters hear of a frame once it is handled, so `offer()` after `waitFor('pair_commit')` finds the commitment.
    const settle = (error: unknown) => {
      for (const w of waiters.filter((x) => x.k === frame.k)) {
        waiters.splice(waiters.indexOf(w), 1);
        clearTimeout(w.timer);
        if (error === undefined) w.resolve(frame);
        else w.reject(error);
      }
    };
    queue = queue.then(() => onFrame(frame)).then(() => settle(undefined), (e: unknown) => { errors.push(e); settle(e); });
  };

  /** Opens the PC's socket and resolves on the relay's welcome. */
  const connect = async () => {
    const sock = new (bearerWebSocket(relay.pcToken))(`${relay.url.replace(/^http/, 'ws')}/ws`);
    ws = sock;
    sock.onmessage = onMessage;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('fake PC: no welcome from the relay')), ONLINE_WITHIN_MS);
      sock.addEventListener('message', function onWelcome(ev: MessageEvent) {
        let parsed: RelayServerMessage | null = null;
        try { parsed = RelayServerMessageSchema.parse(JSON.parse(String(ev.data))); } catch { return; }
        if (parsed.type !== 'welcome') return;
        clearTimeout(timer);
        sock.removeEventListener('message', onWelcome);
        resolve();
      });
      sock.addEventListener('close', () => { clearTimeout(timer); reject(new Error('fake PC: relay refused the PC')); }, { once: true });
    });
  };
  await connect();

  const offer = () => {
    if (!commitment) throw new Error('fake PC: no pair_commit to answer');
    sendFrame({ k: 'pair_offer', pc: identity.publicKey, n: commitment.pcNonce });
  };

  return {
    relay,
    url: relay.url,
    identity,
    get phonePeer() { return phonePeer; },
    get PhoneWebSocket() { return bearerWebSocket(relay.deviceToken(phonePeer), phoneSockets); },
    get devicePublicKey() { return devicePublicKey; },
    get ready() { return ready; },
    code: () => codeP,
    offer,
    ok: () => sendFrame({ k: 'pair_ok' }),
    no: () => sendFrame({ k: 'pair_no' }),
    async send(m) {
      if (!channel || !ready) throw new Error('fake PC: no confirmed channel');
      const plain = padPlain(JSON.stringify(m));
      if (plain === null) throw new Error('fake PC: message past PLAIN_MAX');
      sendFrame({ k: 'msg', s: await channel.seal(plain) });
    },
    received,
    plains,
    frames,
    sent,
    errors,
    waitFor<K extends SealedFrame['k']>(k: K, ms = REPLY_WITHIN_MS) {
      return new Promise<Extract<SealedFrame, { k: K }>>((resolve, reject) => {
        const w: Waiter = {
          k,
          resolve: resolve as (f: SealedFrame) => void,
          reject,
          timer: setTimeout(() => {
            waiters.splice(waiters.indexOf(w), 1);
            reject(new Error(`fake PC: no ${k} within ${ms} ms`));
          }, ms)
        };
        waiters.push(w);
      });
    },
    sendFrame,
    answerAs(id) { helloIdentity = id; },
    forgetDevice() { devicePublicKey = null; },
    badHellos(n) { badHellosLeft = n; },
    async skip() {
      if (!channel || !ready) throw new Error('fake PC: no confirmed channel');
      await channel.seal(padPlain('{}')!);
    },
    async disconnect() {
      const sock = ws;
      channel = null;
      ready = false;
      await new Promise<void>((resolve) => {
        sock.addEventListener('close', () => resolve(), { once: true });
        sock.close();
      });
    },
    reconnect: connect,
    phoneSockets,
    injectToPhone(m) {
      const sock = phoneSockets[phoneSockets.length - 1];
      if (!sock) throw new Error('fake PC: the phone opened no socket');
      sock.onmessage?.(new MessageEvent('message', { data: JSON.stringify(m) }));
    },
    async close() {
      ws.close();
      await relay.relay.close();
    }
  };
}

type Reason = 'confirm_required' | 'assertion_invalid' | 'assertion_expired';

/**
 * The daemon's device check (packages/ledge/src/mobile/gateway.ts) around the real `verifyRegistration`,
 * `verifyAssertion` and challenge store, for one phone. A test double: no persistence, no revocation.
 */
export function createDeviceCheck(publicUrl: string) {
  const rp = rpOf(publicUrl);
  const challenges = createChallengeStore();
  const deviceId = 'phone';
  let credential: DeviceCredential | null = null;
  return {
    /** The phone has registered a passkey: what the snapshot's `device.confirm` says. */
    get registered() { return credential !== null; },
    /** `confirm.prepare`, answered as the gateway does. `live` says whether the session exists. */
    prepare(m: Extract<PhoneClientMessage, { type: 'confirm.prepare' }>, live: boolean): PhoneServerMessage | 'invalid' | 'unknown_session' {
      if (!rp) return 'invalid';
      if (m.purpose === 'register') {
        return { type: 'confirm.challenge', purpose: 'register', challenge: challenges.issue({ deviceId, purpose: 'register', subject: '' }), rpId: rp.rpId, expiresInMs: CHALLENGE_TTL_MS };
      }
      if (m.purpose === 'launch' || m.purpose === 'close') {
        if (!m.qid) return 'invalid';
        if (!live) return 'invalid';
        if (!credential || credential.rpId !== rp.rpId) return 'invalid';
        return { type: 'confirm.challenge', purpose: m.purpose, challenge: challenges.issue({ deviceId, purpose: m.purpose, subject: m.qid }), rpId: rp.rpId, credentialId: credential.id, expiresInMs: CHALLENGE_TTL_MS };
      }
      if (!m.id || !m.expect) return 'invalid';
      if (!live) return 'unknown_session';
      if (!credential || credential.rpId !== rp.rpId) return 'invalid';
      const challenge = challenges.issue({ deviceId, purpose: 'decide', subject: `${m.id}:${m.expect.key}` });
      return { type: 'confirm.challenge', purpose: 'decide', challenge, rpId: rp.rpId, credentialId: credential.id, expiresInMs: CHALLENGE_TTL_MS };
    },
    /** `credential.register`: the verdict, the passkey kept when it verifies. */
    register(m: Extract<PhoneClientMessage, { type: 'credential.register' }>): 'applied' | Reason {
      const challenge = challengeOf(m.credential.clientDataJSON);
      if (challenge === null || !rp) return 'assertion_invalid';
      const verdict = challenges.consume(challenge, { deviceId, purpose: 'register', subject: '' });
      if (verdict === 'expired') return 'assertion_expired';
      if (verdict !== 'ok') return 'assertion_invalid';
      const verified = verifyRegistration(m.credential, rp, challenge);
      if (!verified.ok) return 'assertion_invalid';
      credential = verified.credential;
      return 'applied';
    },
    /** The assertion of a launch of turn `qid`; undefined lets it through. The challenge is spent first. */
    assertLaunch(m: Extract<PhoneClientMessage, { type: 'chat.launch' }>): Reason | undefined {
      if (!credential || !rp || !m.assertion) return 'confirm_required';
      const challenge = challengeOf(m.assertion.clientDataJSON);
      if (challenge === null) return 'assertion_invalid';
      const verdict = challenges.consume(challenge, { deviceId, purpose: 'launch', subject: m.qid });
      if (verdict === 'expired') return 'assertion_expired';
      if (verdict !== 'ok') return 'assertion_invalid';
      const verified = verifyAssertion(m.assertion, credential, rp, challenge);
      if (!verified.ok) return 'assertion_invalid';
      credential = { ...credential, counter: verified.counter };
      return undefined;
    },
    /** The assertion of a close of turn `qid`; undefined lets it through. The challenge is spent first. */
    assertClose(m: Extract<PhoneClientMessage, { type: 'chat.close' }>): Reason | undefined {
      if (!credential || !rp || !m.assertion) return 'confirm_required';
      const challenge = challengeOf(m.assertion.clientDataJSON);
      if (challenge === null) return 'assertion_invalid';
      const verdict = challenges.consume(challenge, { deviceId, purpose: 'close', subject: m.qid });
      if (verdict === 'expired') return 'assertion_expired';
      if (verdict !== 'ok') return 'assertion_invalid';
      const verified = verifyAssertion(m.assertion, credential, rp, challenge);
      if (!verified.ok) return 'assertion_invalid';
      credential = { ...credential, counter: verified.counter };
      return undefined;
    },
    /** The assertion of an accept of request `key` of session `id`; undefined lets it through. The challenge is spent first. */
    assert(m: Extract<PhoneClientMessage, { type: 'session.decide' }>): Reason | undefined {
      if (!credential || !rp || !m.assertion) return 'confirm_required';
      const challenge = challengeOf(m.assertion.clientDataJSON);
      if (challenge === null) return 'assertion_invalid';
      const verdict = challenges.consume(challenge, { deviceId, purpose: 'decide', subject: `${m.id}:${m.expect.key}` });
      if (verdict === 'expired') return 'assertion_expired';
      if (verdict !== 'ok') return 'assertion_invalid';
      const verified = verifyAssertion(m.assertion, credential, rp, challenge);
      if (!verified.ok) return 'assertion_invalid';
      credential = { ...credential, counter: verified.counter };
      return undefined;
    }
  };
}
export type DeviceCheck = ReturnType<typeof createDeviceCheck>;
