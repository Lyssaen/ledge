// PhoneLink: the one object the UI talks to the PC through. It holds the relay socket, the pairing while there is one,
// and the sealed channel to the pinned PC, and it reduces them to one LinkState.
import { SealedFrameSchema, type PhoneClientMessage, type PhoneServerMessage, type SealedFrame } from '@ledge/protocol';
import type { Identity } from '@ledge/seal';
import { openChannel, type ChannelEvent, type PhoneChannel } from './channel';
import { ensureIdentity, type KeyStore, type PinnedPc } from './keys';
import { deviceLabel } from './label';
import { startPairing, type Pairing, type PairingState } from './pairing';
import { openRelaySocket, type SocketState } from './socket';

/**
 * `signed_out`: the relay no longer knows this session. `replaced`: another tab of this phone took the socket.
 * `unpaired` / `pairing`: no PC pinned, without or with a pairing (its outcome included: refused, expired, cancelled).
 * `pc_offline`: the PC is not on the relay, or the relay is out of reach. `handshaking`: the hello is under way, or the
 * keys are still loading. `ready`: messages flow. `key_changed`: the PC answered with another key; nothing is sent.
 */
export type LinkState = 'signed_out' | 'unpaired' | 'pairing' | 'pc_offline' | 'handshaking' | 'ready' | 'key_changed' | 'replaced';

export interface PhoneLink {
  state(): LinkState;
  /** `fn` runs on every change of `state()`, and of the pairing's state. */
  subscribe(fn: () => void): () => void;
  /** Every valid message of the PC; an invalid one never reaches it. */
  onMessage(fn: (m: PhoneServerMessage) => void): () => void;
  /** False unless `ready`. A `session.watch` is remembered even then, and sent again after every ready. */
  send(m: PhoneClientMessage): Promise<boolean>;
  /** The pairing under way, or the last one (its outcome); null before the first. */
  pairing(): Pairing | null;
  /** Starts a new pairing, once the socket is open, unless a PC is pinned. A pairing under way is dropped silently. */
  startPairing(): void;
  /** Forgets the keys (the pinned PC, the identity, the cache) and pairs again. */
  relink(): Promise<void>;
  /** Closes the socket, `POST /auth/logout`, forgets the keys: `signed_out`, for good. */
  signOut(): Promise<void>;
  /**
   * Tries again now, for a screen's « Réessayer »: a hello when the PC is known online on an open socket, else a new
   * socket (its welcome says where the PC is) unless one is already being tried or a 4008 asked to wait.
   */
  retry(): void;
  /** The PC this phone trusts, named from its snapshots; null when unpaired. */
  pinned(): PinnedPc | null;
  /** The fingerprint the PC answered with once its key changed; null otherwise. */
  receivedKey(): string | null;
  /** Closes the socket and stops every timer, keys untouched. Final. */
  close(): void;
}

/** While a pairing waits, its state is read this often, so its expiry reaches the listeners without a frame. */
export const PAIRING_POLL_MS = 1_000;

export function createPhoneLink(opts: {
  keys: KeyStore;
  /** The relay origin, `https:` (or `http:` for a local relay). */
  url: string;
  WebSocketImpl?: typeof WebSocket;
  fetchImpl?: typeof fetch;
}): PhoneLink {
  const { keys } = opts;
  const fetchImpl = opts.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

  let loaded = false;
  /** Bumped when the keys are forgotten, so a load still under way does not bring them back. */
  let keysGen = 0;
  let identity: Identity | null = null;
  let pinned: PinnedPc | null = null;
  let socketState: SocketState = 'connecting';
  /** The PC's presence on the relay: null before the first welcome, false once the socket dropped. */
  let pcOnline: boolean | null = null;
  let keyChanged = false;
  /** The fingerprint of the key the PC answered with, once it changed. */
  let receivedKey: string | null = null;
  let signedOut = false;
  let finished = false;
  let channel: PhoneChannel | null = null;
  /** The last session asked for with `session.watch`. */
  let watched: string | null = null;

  let pairingWanted = false;
  let pairingGen = 0;
  let pairing: Pairing | null = null;
  let pairingView: Pairing | null = null;
  let pairingSeen: PairingState | null = null;
  let pairingTimer: ReturnType<typeof setInterval> | undefined;

  const listeners = new Set<() => void>();
  const messageListeners = new Set<(m: PhoneServerMessage) => void>();

  const compute = (): LinkState => {
    if (signedOut || socketState === 'signed_out') return 'signed_out';
    if (socketState === 'replaced') return 'replaced';
    if (!loaded) return 'handshaking';
    if (keyChanged) return 'key_changed';
    if (!pinned || !identity) return pairingWanted ? 'pairing' : 'unpaired';
    if (pcOnline !== true) return pcOnline === false ? 'pc_offline' : 'handshaking';
    return channel?.ready() ? 'ready' : 'handshaking';
  };

  let emitted: LinkState = 'handshaking';
  /** Tells the listeners when the state changed, or always with `force` (the pairing moved). */
  const check = (force = false) => {
    const s = compute();
    if (!force && s === emitted) return;
    emitted = s;
    for (const fn of [...listeners]) fn();
  };

  // ---- the channel ----

  const onChannelEvent = (ch: PhoneChannel, e: ChannelEvent, received?: string) => {
    if (channel !== ch) return;
    if (e === 'ready') {
      check();
      void afterReady(ch);
    } else if (e === 'key_changed') {
      keyChanged = true;
      receivedKey = received ?? null;
      check();
    } else if (e === 'denied') {
      // The PC no longer knows this phone: its keys are worth nothing, a new pairing starts from scratch.
      void forgetKeys();
    }
  };

  /** The PC starts every channel blank: it gets the snapshot request, then the session the phone shows. */
  const afterReady = async (ch: PhoneChannel) => {
    if (!(await ch.send({ type: 'snapshot.request' }))) return;
    await ch.send({ type: 'session.watch', id: watched });
  };

  const helloIfDue = () => {
    if (!loaded || finished || keyChanged || !identity || !pinned || socketState !== 'open' || pcOnline !== true) return;
    if (!channel) {
      const ch: PhoneChannel = openChannel({
        identity,
        pc: pinned,
        send: (f) => { sock.send('pc', f); },
        onMessage: (m) => {
          if (channel !== ch) return;
          if (m.type === 'snapshot') nameFrom(m.daemon.name);
          for (const fn of [...messageListeners]) fn(m);
        },
        onEvent: (e, received) => onChannelEvent(ch, e, received)
      });
      channel = ch;
    }
    void channel.hello().then(() => check(), () => check());
  };

  /** The PC's name is learned from its snapshot (pairing does not carry it), and kept with the pinned key. */
  const nameFrom = (name: string) => {
    const pc = pinned;
    if (!pc || pc.name === name) return;
    pinned = { ...pc, name };
    // Not kept: the next snapshot names it again.
    keys.pin(pinned).catch(() => {});
    check(true);
  };

  // ---- the pairing ----

  const stopPairingTimer = () => {
    clearInterval(pairingTimer);
    pairingTimer = undefined;
  };

  /** Pairing has no change notification: its state is read after each frame, each confirmation, and on a timer. */
  const watchPairing = () => {
    const p = pairing;
    if (!p) return;
    const s = p.state();
    if (s === pairingSeen) return;
    pairingSeen = s;
    if (s.step !== 'committing' && s.step !== 'compare') stopPairingTimer();
    if (s.step === 'linked') void onLinked(p, s.pc);
    check(true);
  };

  const onLinked = async (p: Pairing, pc: PinnedPc) => {
    const gen = keysGen;
    try {
      await keys.pin(pc);
    } catch {
      // Not pinned, so not paired: back to unpaired, from where a new pairing can start.
      if (pairing !== p || finished || gen !== keysGen) return;
      pairingWanted = false;
      dropPairing();
      check();
      return;
    }
    if (pairing !== p || finished || gen !== keysGen) return;
    pinned = pc;
    pairingWanted = false;
    channel = null;
    helloIfDue();
    check();
  };

  const dropPairing = () => {
    stopPairingTimer();
    pairing?.cancel();
    pairing = null;
    pairingView = null;
    pairingSeen = null;
  };

  /** Starts the pairing asked for, once there is an identity and the socket is open: a commit sent earlier is lost. */
  const launchPairing = () => {
    if (!pairingWanted || pairing || !identity || pinned || socketState !== 'open' || finished) return;
    const id = identity;
    const p: Pairing = startPairing({
      identity: id,
      label: deviceLabel(globalThis.navigator?.userAgent ?? ''),
      send: (f: SealedFrame) => {
        // A frame the relay never got would leave both sides waiting until expiry: give up at once instead.
        if (!sock.send('pc', f)) {
          p.cancel();
          watchPairing();
        }
      }
    });
    pairing = p;
    pairingView = {
      receive: async (f) => { await p.receive(f); watchPairing(); },
      confirmOnPhone: () => { p.confirmOnPhone(); watchPairing(); },
      cancel: () => { p.cancel(); watchPairing(); },
      state: () => p.state()
    };
    pairingTimer = setInterval(watchPairing, PAIRING_POLL_MS);
    watchPairing();
  };

  const beginPairing = () => {
    if (finished || keyChanged || (loaded && pinned && identity)) return;
    dropPairing();
    pairingWanted = true;
    const gen = ++pairingGen;
    check(true);
    void (async () => {
      await loading;
      if (gen !== pairingGen || finished) return;
      if (pinned && identity) {
        pairingWanted = false;
        check();
        return;
      }
      const id = await ensureIdentity(keys);
      if (gen !== pairingGen || finished) return;
      identity = id;
      launchPairing();
    })().catch(() => {
      // No identity could be made or stored: nothing to pair with.
      if (gen !== pairingGen) return;
      pairingWanted = false;
      check();
    });
  };

  // ---- keys ----

  /**
   * Forgets the keys: nothing is sealed to the old PC from here on, even before the store answers. `pairAfter`: a
   * pairing follows, so the state goes straight to `pairing` instead of passing by `unpaired` (which starts one too).
   */
  const forgetKeys = async (pairAfter = false) => {
    keysGen++;
    channel = null;
    keyChanged = false;
    receivedKey = null;
    pinned = null;
    identity = null;
    pairingWanted = pairAfter;
    dropPairing();
    check();
    try {
      await keys.forget();
    } catch {
      // Forgotten in memory all the same: nothing is sealed with them for as long as this page lives.
    }
  };

  // ---- the socket ----

  const onFrame = (frame: SealedFrame) => {
    if (frame.k.startsWith('pair_')) {
      const p = pairing;
      if (p) void p.receive(frame).then(watchPairing, watchPairing);
      return;
    }
    const ch = channel;
    if (ch) void ch.receive(frame).then(() => check(), () => check());
  };

  const sock = openRelaySocket({
    url: opts.url,
    ...(opts.WebSocketImpl ? { WebSocketImpl: opts.WebSocketImpl } : {}),
    fetchImpl,
    onState(s) {
      socketState = s;
      // Out of reach of the relay is out of reach of the PC; the next welcome says where it is.
      if (s !== 'open' && pcOnline !== null) pcOnline = false;
      check();
    },
    onAttemptFailed() {
      // Out of reach of the relay, from launch on too: the state stays `connecting` across retries, this says so.
      if (finished) return;
      pcOnline = false;
      check();
    },
    onFrame(m) {
      if (finished) return;
      switch (m.type) {
        case 'welcome':
          pcOnline = m.online.includes('pc');
          // A new socket: the PC's channel for the old one is gone.
          helloIfDue();
          launchPairing();
          check();
          return;
        case 'presence': {
          if (m.peer !== 'pc') return;
          // Only a PC coming back says hello: one already known online has the hello of the welcome (or of the error)
          // under way, and a second one would be finished with the wrong handshake. A replaced PC is no presence change;
          // it answers the phone's next message with a rekey.
          const back = m.online && pcOnline !== true;
          pcOnline = m.online;
          if (back) helloIfDue();
          check();
          return;
        }
        case 'error':
          // A sealed body that was not delivered: the channel lost a sequence number. Once only, from a ready channel,
          // so a hello the relay bounces (the PC just left) does not bounce forever; presence brings the PC back.
          if (m.to !== undefined && m.to !== 'pc') return;
          if ((m.code === 'offline' || m.code === 'too_large' || m.code === 'rate_limited') && channel?.ready()) helloIfDue();
          check();
          return;
        case 'deliver': {
          // Pairing and the channel trust their caller for the source: only the PC's frames reach them.
          if (m.from !== 'pc') return;
          let raw: unknown;
          try { raw = JSON.parse(m.body); } catch { return; }
          const f = SealedFrameSchema.safeParse(raw);
          if (f.success) onFrame(f.data);
          return;
        }
      }
    }
  });
  const logoutUrl = new URL('/auth/logout', opts.url).toString();

  const loading = (async () => {
    const gen = keysGen;
    try {
      const [id, pc] = await Promise.all([keys.identity(), keys.pinned()]);
      if (gen !== keysGen) return;
      identity = id;
      // A pinned PC without the identity it was paired with cannot be talked to: unpaired.
      pinned = id ? pc : null;
    } catch {
      // A store that cannot be read is an empty one: the phone offers to pair.
    } finally {
      loaded = true;
    }
  })().then(() => {
    helloIfDue();
    launchPairing();
    check();
  });

  const finish = () => {
    finished = true;
    stopPairingTimer();
    sock.close();
  };

  return {
    state: compute,
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    onMessage(fn) {
      messageListeners.add(fn);
      return () => { messageListeners.delete(fn); };
    },
    async send(m) {
      if (m.type === 'session.watch') watched = m.id;
      const ch = channel;
      if (!ch || compute() !== 'ready') return false;
      return ch.send(m);
    },
    pairing: () => pairingView,
    startPairing: beginPairing,
    async relink() {
      if (finished) return;
      await forgetKeys(true);
      beginPairing();
    },
    async signOut() {
      signedOut = true;
      finish();
      check();
      try {
        await fetchImpl(logoutUrl, { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
      } catch {
        // Out of reach: the keys are forgotten all the same; the relay's session expires on its own.
      }
      await forgetKeys();
    },
    retry() {
      if (finished || keyChanged) return;
      if (socketState === 'open' && pcOnline === true) helloIfDue();
      else sock.reconnect();
    },
    pinned: () => pinned,
    receivedKey: () => receivedKey,
    close() {
      if (finished) return;
      finish();
      check();
    }
  };
}
