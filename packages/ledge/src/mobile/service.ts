// Mobile access: files, relay link, sign-in, pairing and channels put together, as one state and a set of commands
// for the local fronts. Nothing secret (relay token, device code, keys, nonces, message texts) reaches the state or the log.
import type WebSocket from 'ws';
import { SealedFrameSchema, type MobileClientMessage, type MobileConfig, type MobileState, type RelayServerMessage, type SealedFrame } from '@ledge/protocol';
import {
  clearRelaySession, loadPcIdentity, readDevices, readMobileConfig, readRelaySession, writeDevices, writeMobileConfig, writeRelaySession,
  type ApprovedDevice, type RelaySession
} from './files.js';
import { createRelayLink, type LinkState, type RelayLink, type Schedule } from './link.js';
import { signOut, startSignIn } from './signin.js';
import { createPairing } from './pairing.js';
import { createChannels } from './channels.js';
import { log } from '../log.js';

export interface MobileService {
  state(): MobileState;
  /** Called after every change of `state()`; returns the unsubscribe. */
  onChange(fn: () => void): () => void;
  /** Runs a front's command. A command that makes no sense in the current state throws an Error with a short message. */
  handle(msg: MobileClientMessage): Promise<void>;
  /** Seals `text` to the device's confirmed channel; false if it has none. */
  send(deviceId: string, text: string): Promise<boolean>;
  /** Texts opened from approved devices' sealed messages; returns the unsubscribe. */
  onMessage(fn: (deviceId: string, text: string) => void): () => void;
  stop(): Promise<void>;
}

const REVOKE_TIMEOUT_MS = 15_000;

/**
 * Reads the files once, then keeps them in step with the commands. `fetchImpl` serves the /auth calls,
 * `WebSocketImpl` the relay link. For tests: `now` is the clock, `schedule` the link's and the pairings' timers,
 * `sleep` the wait between sign-in polls; all default to the real ones.
 */
export async function createMobileService(opts: {
  fetchImpl?: typeof fetch;
  WebSocketImpl?: typeof WebSocket;
  now?: () => number;
  schedule?: Schedule;
  sleep?: (ms: number) => Promise<void>;
} = {}): Promise<MobileService> {
  const now = opts.now ?? Date.now;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const pc = await loadPcIdentity();

  let config: MobileConfig = readMobileConfig();
  let session: RelaySession | null = readRelaySession();
  let devices: ApprovedDevice[] = readDevices();
  let link: RelayLink | null = null;
  let linkState: LinkState = { state: 'off' };
  let signin: MobileState['signin'] = null;
  let signinError: MobileState['signinError'] = null;
  let signinRun: { cancel(): void } | null = null;
  let stopped = false;

  const changeListeners = new Set<() => void>();
  const messageListeners = new Set<(deviceId: string, text: string) => void>();
  const changed = () => {
    if (stopped) return;
    for (const fn of changeListeners) {
      try { fn(); } catch (e) { log(`mobile: change listener failed (${(e as Error).message})`); }
    }
  };

  const sendFrame = (peer: string, frame: SealedFrame) => {
    link?.send({ type: 'send', to: peer, body: JSON.stringify(frame) });
  };

  const saveDevices = (next: ApprovedDevice[]) => {
    writeDevices(next); // first: a failing write leaves memory unchanged
    devices = next;
  };

  const pairing = createPairing({
    pc,
    send: sendFrame,
    approve(d) {
      const old = devices.find((x) => x.id === d.id);
      saveDevices(old ? devices.map((x) => (x.id === d.id ? { ...x, label: d.label } : x)) : [...devices, d]);
    },
    onChange: changed,
    now,
    ...(opts.schedule ? { schedule: opts.schedule } : {})
  });

  const channels = createChannels({
    pc,
    devices: () => devices,
    send: sendFrame,
    onConfirmed(deviceId, peer) {
      if (devices.some((d) => d.id === deviceId)) {
        const at = new Date(now()).toISOString();
        try { saveDevices(devices.map((d) => (d.id === deviceId ? { ...d, lastPeer: peer, lastSeenAt: at } : d))); }
        catch (e) { log(`mobile: devices.json not written (${(e as Error).message})`); }
      }
      pairing.linked(deviceId);
      changed();
    },
    onMessage(deviceId, text) {
      for (const fn of messageListeners) {
        try { fn(deviceId, text); } catch (e) { log(`mobile: message listener failed (${(e as Error).message})`); }
      }
    },
    onClosed: () => changed(),
    now
  });

  const onRelayMessage = (m: RelayServerMessage) => {
    switch (m.type) {
      case 'welcome':
        channels.reset();
        pairing.reset();
        changed();
        return;
      case 'deliver': {
        if (m.from === 'pc') return;
        let raw: unknown;
        try { raw = JSON.parse(m.body); } catch { return; }
        const r = SealedFrameSchema.safeParse(raw);
        if (!r.success) return;
        // Dispatched synchronously, so the frames of one peer reach their handler in arrival order.
        if (r.data.k.startsWith('pair_')) {
          pairing.receive(m.from, r.data).catch((e: unknown) => log(`mobile pairing: error on peer ${m.from} (${(e as Error).name})`));
        } else {
          void channels.receive(m.from, r.data);
        }
        return;
      }
      case 'presence':
        if (!m.online) channels.drop(m.peer);
        return;
      case 'error':
        if (m.to) channels.drop(m.to);
        return;
    }
  };

  /** Forgets the link first, so its final `off` is the service's own and a closed link never speaks again. */
  const closeLink = () => {
    const old = link;
    link = null;
    old?.close();
    // Pairings still to decide cannot be answered without a link; channels are reset by the next welcome.
    if (old) pairing.reset();
    linkState = { state: 'off' };
  };

  const openLink = () => {
    if (stopped || link || !config.enabled || !session) return;
    const self: { link: RelayLink | null } = { link: null };
    const created = createRelayLink({
      relayUrl: session.relayUrl,
      token: session.token,
      onState(s) {
        // The first `connecting` is emitted while createRelayLink runs, before `link` is set.
        if (self.link !== null && link !== self.link) return;
        linkState = s;
        changed();
      },
      onMessage(m) {
        if (link !== self.link) return;
        onRelayMessage(m);
      },
      now,
      ...(opts.WebSocketImpl ? { WebSocketImpl: opts.WebSocketImpl } : {}),
      ...(opts.schedule ? { schedule: opts.schedule } : {})
    });
    self.link = created;
    link = created;
  };

  const cancelSignin = () => {
    signinRun?.cancel();
    signinRun = null;
    signin = null;
  };

  const startSignin = () => {
    if (!config.enabled) throw new Error('mobile access is disabled');
    cancelSignin();
    signinError = null;
    const relayUrl = config.relayUrl;
    const run = startSignIn({
      relayUrl,
      onCode(c) {
        if (signinRun !== run) return;
        signin = c;
        changed();
      },
      fetchImpl,
      ...(opts.sleep ? { sleep: opts.sleep } : {})
    });
    signinRun = run;
    void run.result.then((r) => {
      if (signinRun !== run) return;
      signinRun = null;
      signin = null;
      if (r.status === 'ok') {
        writeRelaySession(r.session);
        session = r.session;
        log(`mobile: signed in as ${r.session.login}`);
        closeLink();
        openLink();
      } else if (r.status !== 'cancelled') {
        signinError = r.status;
        log(`mobile: sign-in ended (${r.status === 'failed' ? r.error : r.status})`);
      }
      changed();
    }).catch((e: unknown) => {
      log(`mobile: sign-in not saved (${(e as Error).message})`);
      if (signinRun === null) { signinError = 'failed'; changed(); }
    });
  };

  /** Asks the relay to close the revoked device's sessions and sockets. Logged on failure, never retried. */
  const revokeOnRelay = async (peer: string) => {
    if (!session || linkState.state !== 'online') return;
    try {
      const res = await fetchImpl(new URL('/auth/devices/revoke', session.relayUrl).toString(), {
        method: 'POST',
        headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ peer }),
        signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS)
      });
      await res.body?.cancel();
      if (!res.ok) log(`mobile: relay did not revoke peer ${peer} (status ${res.status})`);
      else log(`mobile: relay revoked peer ${peer}`);
    } catch (e) {
      log(`mobile: relay did not revoke peer ${peer} (${(e as Error).name})`);
    }
  };

  const revoke = async (id: string) => {
    const d = devices.find((x) => x.id === id);
    if (!d) return; // already revoked: nothing to do
    saveDevices(devices.filter((x) => x.id !== id));
    log(`mobile: revoked device ${id}`);
    // Removed from the list first: dropDevice then answers the device's next msg with `denied`.
    channels.dropDevice(id);
    if (d.lastPeer) sendFrame(d.lastPeer, { k: 'denied' });
    changed();
    if (d.lastPeer) await revokeOnRelay(d.lastPeer);
  };

  const pairingIn = (id: string, states: string[]) => {
    const p = pairing.views().find((v) => v.id === id);
    if (!p || !states.includes(p.state)) throw new Error('no such pairing waiting for a decision');
  };

  openLink();

  return {
    state() {
      const online = linkState.state === 'online' ? channels.online() : new Set<string>();
      return {
        enabled: config.enabled,
        relayUrl: config.relayUrl,
        account: session ? { login: session.login, accountId: session.accountId } : null,
        signin,
        signinError,
        link: linkState,
        devices: devices.map((d) => ({
          id: d.id, label: d.label, approvedAt: d.approvedAt, online: online.has(d.id), ...(d.lastSeenAt ? { lastSeenAt: d.lastSeenAt } : {})
        })),
        pairings: pairing.views()
      };
    },

    onChange(fn) {
      changeListeners.add(fn);
      return () => { changeListeners.delete(fn); };
    },

    async handle(msg) {
      if (stopped) throw new Error('mobile access is stopped');
      switch (msg.type) {
        case 'mobile.set': {
          const next: MobileConfig = { enabled: msg.enabled, relayUrl: msg.relayUrl };
          const moved = next.relayUrl !== config.relayUrl;
          writeMobileConfig(next); // first: a failing write leaves the state unchanged and reaches the sender
          config = next;
          if (moved) {
            cancelSignin();
            clearRelaySession();
            session = null;
            closeLink();
          }
          if (!config.enabled) {
            cancelSignin();
            closeLink();
          } else {
            openLink();
          }
          changed();
          return;
        }
        case 'mobile.signin':
          startSignin();
          changed();
          return;
        case 'mobile.signin.cancel':
          cancelSignin();
          changed();
          return;
        case 'mobile.signout': {
          cancelSignin();
          const old = session;
          session = null;
          clearRelaySession();
          closeLink();
          changed();
          // The link is closed first, so the relay's kick of this very socket shows no `signed_out` on the way.
          if (old) await signOut(old, fetchImpl);
          log('mobile: signed out');
          return;
        }
        case 'mobile.retry':
          link?.retryNow();
          return;
        case 'mobile.pairing.approve':
          pairingIn(msg.id, ['confirm']);
          pairing.approve(msg.id);
          return;
        case 'mobile.pairing.deny':
          pairingIn(msg.id, ['confirm', 'waiting']);
          pairing.deny(msg.id);
          return;
        case 'mobile.device.revoke':
          return revoke(msg.id);
      }
    },

    send: (deviceId, text) => channels.send(deviceId, text),

    onMessage(fn) {
      messageListeners.add(fn);
      return () => { messageListeners.delete(fn); };
    },

    async stop() {
      if (stopped) return;
      cancelSignin();
      closeLink();
      pairing.stop();
      stopped = true;
      changeListeners.clear();
      messageListeners.clear();
    }
  };
}
