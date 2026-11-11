// Mobile access: files, relay link, sign-in, pairing and channels put together, as one state and a set of commands
// for the local fronts. Nothing secret (relay token, device code, keys, nonces, message texts) reaches the state or the log.
import { existsSync, renameSync } from 'node:fs';
import { hostname } from 'node:os';
import type WebSocket from 'ws';
import { DEFAULT_DEVICE_PREFS, DeviceNameSchema, DevicePrefsSchema, PushSendResultSchema, SealedFrameSchema, deviceKindOfLabel, type DeviceKind, type DevicePrefs, type PushSend, type PushSendResult, type MobileClientMessage, type MobileConfig, type MobileRecoveryEvent, type MobileState, type RelayServerMessage, type SealedFrame } from '@ledge/protocol';
import {
  clearRelaySession, loadPcIdentity, readDevices, readMobileConfig, readRecovery, readRelaySession, readRevocations, writeDevices, writeMobileConfig, writeRecovery, writeRelaySession, writeRevocations,
  MAX_DEVICE_PEERS, type ApprovedDevice, type RelaySession, type Revocation
} from './files.js';
import { rpOf, type DeviceCredential } from './webauthn.js';
import { createRelayLink, type LinkState, type RelayLink, type Schedule } from './link.js';
import { signOut, startSignIn } from './signin.js';
import { createPairing } from './pairing.js';
import { createChannels } from './channels.js';
import { createRecovery } from './recover.js';
import { deviceChatDir } from '../chat/threads.js';
import { paths } from '../paths.js';
import { log } from '../log.js';

/** `resolved`: the device's service worker shows a `resolved` push (it replaces a request's notification). */
export interface PushSetting { endpoint: string; p256dh: string; auth: string; key: string; resolved?: true }

export interface MobileService {
  state(): MobileState;
  /** Called after every change of `state()`; returns the unsubscribe. */
  onChange(fn: () => void): () => void;
  /** Runs a front's command. A command that makes no sense in the current state throws an Error with a short message. */
  handle(msg: MobileClientMessage): Promise<void>;
  /** Seals `text` to the device's confirmed channel; false if it has none. */
  send(deviceId: string, text: string): Promise<boolean>;
  /** Removes the device from the PC (as the `mobile.device.revoke` command does); a device already gone is not an error. */
  revoke(deviceId: string): Promise<void>;
  /** Renames an approved device (persisted); throws for an unknown device. */
  rename(deviceId: string, name: string): void;
  /** What a device is called and what it is, for its own snapshot and for the decisions it takes; null if unknown. */
  deviceInfo(deviceId: string): { label: string; kind: DeviceKind; name?: string } | null;
  /** The device's passkey, unless it was registered for another relay host than the current one. */
  credential(deviceId: string): DeviceCredential | null;
  /** Stores the passkey of an approved device (persisted with it). */
  setCredential(deviceId: string, c: DeviceCredential): void;
  /** The device's push subscription, with the relay key it was made with; null if none. */
  pushOf(deviceId: string): PushSetting | null;
  /** Stores (or with null removes) the push subscription of an approved device. */
  setPush(deviceId: string, p: PushSetting | null): void;
  /** The device's own settings (Réglages on the phone): the defaults for one that never set them or is unknown. */
  prefsOf(deviceId: string): DevicePrefs;
  /** Stores an approved device's settings, whole (persisted with it); throws for an unknown device. */
  setPrefs(deviceId: string, prefs: DevicePrefs): void;
  /** The relay's VAPID public key: undefined until read, null when the relay has push off. Read at each `online`. */
  relayPushKey(): string | null | undefined;
  /** Asks the relay to forward an encrypted push (`POST /push/send`, Bearer PC). Never throws. */
  sendPush(msg: PushSend): Promise<PushSendResult>;
  /** The PC's mobile public key (base64url), as phones pin it. */
  pcKey(): string;
  /** Each passkey recovery event as it happens (for the local fronts' toast); returns the unsubscribe. */
  onRecovery(fn: (e: MobileRecoveryEvent) => void): () => void;
  /** Texts opened from approved devices' sealed messages; returns the unsubscribe. */
  onMessage(fn: (deviceId: string, text: string) => void): () => void;
  stop(): Promise<void>;
}

/** Every relay peer known for a device: its list, and `lastPeer` from a file written before the list was kept. */
function peersOf(d: ApprovedDevice): string[] {
  const list = d.peers ?? [];
  return d.lastPeer && !list.includes(d.lastPeer) ? [...list, d.lastPeer] : list;
}

const REVOKE_TIMEOUT_MS = 15_000;
const PUSH_TIMEOUT_MS = 10_000;
/** A revocation the relay never confirmed in this long is given up. */
const REVOCATION_MAX_AGE_MS = 30 * 86_400_000;

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
  let revocations: Revocation[] = readRevocations();
  let link: RelayLink | null = null;
  let linkState: LinkState = { state: 'off' };
  let signin: MobileState['signin'] = null;
  let signinError: MobileState['signinError'] = null;
  let signinRun: { cancel(): void } | null = null;
  let stopped = false;
  let pushKey: string | null | undefined;

  const changeListeners = new Set<() => void>();
  const messageListeners = new Set<(deviceId: string, text: string) => void>();
  const recoveryListeners = new Set<(e: MobileRecoveryEvent) => void>();
  const told = (e: MobileRecoveryEvent) => {
    for (const fn of recoveryListeners) {
      try { fn(e); } catch (err) { log(`mobile: recovery listener failed (${(err as Error).message})`); }
    }
  };
  const changed = () => {
    if (stopped) return;
    for (const fn of changeListeners) {
      try { fn(); } catch (e) { log(`mobile: change listener failed (${(e as Error).message})`); }
    }
  };

  const sendFrame = (peer: string, frame: SealedFrame) => {
    link?.send({ type: 'send', to: peer, body: JSON.stringify(frame) });
  };

  /** The device's peers with `peer` last, the oldest dropped past MAX_DEVICE_PEERS. */
  const withPeer = (d: ApprovedDevice, peer: string): string[] =>
    [...peersOf(d).filter((p) => p !== peer), peer].slice(-MAX_DEVICE_PEERS);

  /** The device without `peer` in its list or as its last peer. */
  const withoutPeer = (d: ApprovedDevice, peer: string): ApprovedDevice => {
    if (d.lastPeer !== peer && !d.peers?.includes(peer)) return d;
    const { lastPeer, peers, ...rest } = d;
    const left = (peers ?? []).filter((p) => p !== peer);
    return { ...rest, ...(lastPeer && lastPeer !== peer ? { lastPeer } : {}), ...(left.length > 0 ? { peers: left } : {}) };
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
      const kind = deviceKindOfLabel(d.label);
      saveDevices(old ? devices.map((x) => (x.id === d.id ? { ...x, label: d.label, kind } : x)) : [...devices, { ...d, kind }]);
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
      const d0 = devices.find((d) => d.id === deviceId);
      if (d0) {
        const at = new Date(now()).toISOString();
        // A device put back with its passkey is back for real once its new key says hello: then Desktop hears it.
        const back = d0.recovering;
        const confirmed = (d: ApprovedDevice): ApprovedDevice => {
          if (!d.recovering) return d;
          const { recovering, ...rest } = d;
          return { ...rest, recovered: { at: recovering.at, ...(recovering.model ? { model: recovering.model } : {}), pending: true } };
        };
        // A peer belongs to the device that confirmed on it last: a browser that lost its keys and paired again keeps its
        // cookie, so the same peer; the old device no longer owns it, and revoking that one must not revoke this peer.
        let saved = false;
        try { saveDevices(devices.map((d) => (d.id === deviceId ? confirmed({ ...d, lastPeer: peer, lastSeenAt: at, peers: withPeer(d, peer) }) : withoutPeer(d, peer)))); saved = true; }
        catch (e) { log(`mobile: devices.json not written (${(e as Error).message})`); }
        if (back && saved) told({ event: 'recovered', id: deviceId, at: back.at });
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

  /** What a device is called on the PC's screens and the phone's: its name, else its pairing label. */
  const shownName = (d: ApprovedDevice) => (d.name ?? d.label).slice(0, 40);
  const online = (id: string) => linkState.state === 'online' && channels.online().has(id);

  const recovery = createRecovery({
    pc,
    pcName: () => hostname().slice(0, 40) || undefined,
    send: sendFrame,
    rp: () => rpOf(config.relayUrl),
    byCredential(credentialId) {
      const rpId = rpOf(config.relayUrl)?.rpId;
      const d = devices.find((x) => x.credential?.id === credentialId && x.credential.rpId === rpId);
      return d?.credential ? { id: d.id, name: shownName(d), credential: d.credential } : null;
    },
    online,
    restore(old, next) {
      const d = devices.find((x) => x.id === old.id);
      if (!d || !d.credential) throw new Error('no such device');
      if (d.credential.id !== old.credential.id || d.credential.publicKey !== old.credential.publicKey) throw new Error('its passkey changed');
      if (devices.some((x) => x.id === next.id)) throw new Error('that key is already approved');
      const at = new Date(now()).toISOString();
      // Inherits what the user knows the device by; the push and the peers belonged to the deleted app.
      const { push: _push, peers: _peers, lastPeer: _last, lastSeenAt: _seen, refused: _refused, ...kept } = d;
      const entry: ApprovedDevice = {
        ...kept, id: next.id, publicKey: next.publicKey, lastPeer: next.peer, peers: [next.peer],
        credential: { ...d.credential, counter: next.counter }, recovering: { at, ...(next.model ? { model: next.model } : {}) }
      };
      // The thread's folder first: the old id leaving the list drops its thread, folder included. A folder that cannot be moved
      // stops the restore with nothing changed, and a list that cannot be written puts the folder back: the thread is never lost.
      const from = deviceChatDir(paths().dir, old.id);
      const to = deviceChatDir(paths().dir, next.id);
      if (existsSync(to)) throw new Error('the new key already has a chat folder');
      let moved = false;
      try { renameSync(from, to); moved = true; }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`its chat was not moved (${(e as NodeJS.ErrnoException).code ?? 'error'})`); }
      try { saveDevices([...devices.filter((x) => x.id !== old.id).map((x) => withoutPeer(x, next.peer)), entry]); }
      catch (e) {
        if (moved) {
          try { renameSync(to, from); }
          catch (back) { log(`mobile recovery: chat of ${old.id} left at ${next.id} (${(back as NodeJS.ErrnoException).code ?? 'error'})`); }
        }
        throw e;
      }
      channels.dropDevice(old.id);
      // The old app's relay sessions go, as in a revocation, but its passkey lives on in the new entry: no tombstone.
      const others = new Set(devices.flatMap(peersOf));
      const peers = peersOf(d).filter((p) => !others.has(p));
      for (const p of peers) sendFrame(p, { k: 'denied' });
      void Promise.all(peers.map((p) => revokeOnRelay(p)));
      // Desktop hears it at the new key's first hello (onConfirmed): a phone that failed to keep the PC's key never says it.
      changed();
      return shownName(entry);
    },
    refused(id, model) {
      const at = new Date(now()).toISOString();
      try { saveDevices(devices.map((x) => (x.id === id ? { ...x, refused: { at, ...(model ? { model } : {}) } } : x))); }
      catch (e) { log(`mobile: devices.json not written (${(e as Error).message})`); }
      told({ event: 'refused', id, at });
      changed();
    },
    onBlocked() {
      told({ event: 'blocked', at: new Date(now()).toISOString() });
      changed();
    },
    file: { read: readRecovery, write: writeRecovery },
    now,
    ...(opts.schedule ? { schedule: opts.schedule } : {})
  });

  const onRelayMessage = (m: RelayServerMessage) => {
    switch (m.type) {
      case 'welcome':
        channels.reset();
        pairing.reset();
        recovery.reset();
        changed();
        return;
      case 'deliver': {
        if (m.from === 'pc') return;
        let raw: unknown;
        try { raw = JSON.parse(m.body); } catch { return; }
        const r = SealedFrameSchema.safeParse(raw);
        if (!r.success) return;
        // Dispatched synchronously, so the frames of one peer reach their handler in arrival order.
        if (r.data.k.startsWith('recover_')) {
          recovery.receive(m.from, r.data).catch((e: unknown) => log(`mobile recovery: error on peer ${m.from} (${(e as Error).name})`));
        } else if (r.data.k.startsWith('pair_')) {
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
    if (old) { pairing.reset(); recovery.reset(); }
    linkState = { state: 'off' };
    pushKey = undefined; // belongs to the relay of the closed link
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
        if (s.state === 'online') { void retryRevocations(); void readPushKey(); }
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

  const saveRevocations = (next: Revocation[]) => {
    try { writeRevocations(next); }
    catch (e) { log(`mobile: revocations.json not written (${(e as Error).message})`); }
    revocations = next;
  };

  /** Peers with a call to the relay under way, so a retry never doubles one. */
  const revoking = new Set<string>();

  /** One call. The entry leaves the file on a 2xx or a 404 (the relay has no such peer); on 401, 429, 5xx or a network error it stays. */
  const tryRevoke = async (peer: string) => {
    if (!session || linkState.state !== 'online' || revoking.has(peer)) return;
    revoking.add(peer);
    try {
      const res = await fetchImpl(new URL('/auth/devices/revoke', session.relayUrl).toString(), {
        method: 'POST',
        headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ peer }),
        signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS)
      });
      await res.body?.cancel();
      if (res.ok || res.status === 404) {
        saveRevocations(revocations.filter((r) => r.peer !== peer));
        log(`mobile: relay revoked peer ${peer}`);
      } else log(`mobile: relay did not revoke peer ${peer} (status ${res.status}), kept for a retry`);
    } catch (e) {
      log(`mobile: relay did not revoke peer ${peer} (${(e as Error).name}), kept for a retry`);
    } finally {
      revoking.delete(peer);
    }
  };

  /** `GET /push/key`: the key, or null when the relay has push off (404). Any other answer leaves what was known. */
  const readPushKey = async () => {
    const at = session;
    if (!at) return;
    try {
      const res = await fetchImpl(new URL('/push/key', at.relayUrl).toString(), {
        headers: { authorization: `Bearer ${at.token}` },
        signal: AbortSignal.timeout(PUSH_TIMEOUT_MS)
      });
      let next: string | null | undefined;
      if (res.status === 404) { next = null; await res.body?.cancel(); }
      else if (res.ok) {
        const body = (await res.json()) as { publicKey?: unknown };
        next = typeof body.publicKey === 'string' && body.publicKey ? body.publicKey : undefined;
      } else await res.body?.cancel();
      if (next !== undefined && session === at && next !== pushKey) { pushKey = next; changed(); }
    } catch (e) {
      log(`mobile: relay push key not read (${(e as Error).name})`);
    }
  };

  /** The whole list, each time the link comes online; an entry too old is dropped first. */
  const retryRevocations = async () => {
    const limit = now() - REVOCATION_MAX_AGE_MS;
    const stale = revocations.filter((r) => !(Date.parse(r.at) >= limit));
    if (stale.length > 0) {
      for (const r of stale) log(`mobile: giving up the revocation of peer ${r.peer} (older than 30 days)`);
      saveRevocations(revocations.filter((r) => !stale.includes(r)));
    }
    await Promise.all(revocations.map((r) => tryRevoke(r.peer)));
  };

  /** Writes the peer down first, so a relay that cannot be reached (or a daemon that stops) does not lose it. */
  const revokeOnRelay = async (peer: string) => {
    if (!revocations.some((r) => r.peer === peer)) saveRevocations([...revocations, { peer, at: new Date(now()).toISOString() }]);
    await tryRevoke(peer);
  };

  const revoke = async (id: string) => {
    const d = devices.find((x) => x.id === id);
    if (!d) return; // already revoked: nothing to do
    saveDevices(devices.filter((x) => x.id !== id));
    log(`mobile: revoked device ${id}`);
    // Its passkey still opens nothing, but for 90 days a recovery with it hears « révoqué le … » rather than « inconnu ».
    if (d.credential) recovery.bury(d.credential.id, shownName(d), new Date(now()).toISOString());
    // Removed from the list first: dropDevice then answers the device's next msg with `denied`.
    channels.dropDevice(id);
    // Every peer the device ever confirmed a channel on: an older relay session of it must not stay valid. A peer another
    // approved device uses (the same browser paired again under a new key) is left alone: only this device's channel goes.
    const others = new Set(devices.flatMap(peersOf));
    const peers = peersOf(d).filter((p) => !others.has(p));
    for (const p of peers) sendFrame(p, { k: 'denied' });
    changed();
    await Promise.all(peers.map((p) => revokeOnRelay(p)));
  };

  const rename = (id: string, raw: string) => {
    const name = DeviceNameSchema.parse(raw);
    if (!devices.some((d) => d.id === id)) throw new Error('no such device');
    saveDevices(devices.map((d) => (d.id === id ? { ...d, name } : d)));
    changed();
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
          id: d.id, label: d.label, approvedAt: d.approvedAt, online: online.has(d.id), ...(d.lastSeenAt ? { lastSeenAt: d.lastSeenAt } : {}),
          kind: d.kind ?? deviceKindOfLabel(d.label), ...(d.name ? { name: d.name } : {}),
          ...(d.credential?.recover ? { recover: true as const } : {}), ...(d.recovered ? { recovered: d.recovered } : {}), ...(d.refused ? { refused: d.refused } : {})
        })),
        pairings: pairing.views(),
        terminalInput: config.terminalInput === true,
        ...(recovery.blocked() ? { recovery: { blocked: recovery.blocked()! } } : {})
      };
    },

    revoke,

    rename,

    deviceInfo(deviceId) {
      const d = devices.find((x) => x.id === deviceId);
      return d ? { label: d.label, kind: d.kind ?? deviceKindOfLabel(d.label), ...(d.name ? { name: d.name } : {}) } : null;
    },

    credential(deviceId) {
      const c = devices.find((d) => d.id === deviceId)?.credential;
      return c && c.rpId === rpOf(config.relayUrl)?.rpId ? c : null;
    },

    setCredential(deviceId, c) {
      if (!devices.some((d) => d.id === deviceId)) throw new Error('no such device');
      saveDevices(devices.map((d) => (d.id === deviceId ? { ...d, credential: c } : d)));
    },

    pushOf(deviceId) {
      return devices.find((d) => d.id === deviceId)?.push ?? null;
    },

    setPush(deviceId, p) {
      if (!devices.some((d) => d.id === deviceId)) throw new Error('no such device');
      saveDevices(devices.map((d) => {
        if (d.id !== deviceId) return d;
        const { push: _old, ...rest } = d;
        return p ? { ...rest, push: p } : rest;
      }));
      changed();
    },

    prefsOf(deviceId) {
      return devices.find((d) => d.id === deviceId)?.prefs ?? DEFAULT_DEVICE_PREFS;
    },

    setPrefs(deviceId, raw) {
      const prefs = DevicePrefsSchema.parse(raw);
      if (!devices.some((d) => d.id === deviceId)) throw new Error('no such device');
      saveDevices(devices.map((d) => (d.id === deviceId ? { ...d, prefs } : d)));
    },

    relayPushKey: () => pushKey,

    pcKey: () => pc.publicKey,

    async sendPush(msg) {
      const at = session;
      if (!at || linkState.state !== 'online') return { result: 'failed' };
      try {
        const res = await fetchImpl(new URL('/push/send', at.relayUrl).toString(), {
          method: 'POST',
          headers: { authorization: `Bearer ${at.token}`, 'content-type': 'application/json' },
          body: JSON.stringify(msg),
          signal: AbortSignal.timeout(PUSH_TIMEOUT_MS)
        });
        if (!res.ok) { await res.body?.cancel(); return { result: 'failed', status: res.status }; }
        const parsed = PushSendResultSchema.safeParse(await res.json());
        return parsed.success ? parsed.data : { result: 'failed' };
      } catch (e) {
        log(`mobile: push not sent (${(e as Error).name})`);
        return { result: 'failed' };
      }
    },

    onChange(fn) {
      changeListeners.add(fn);
      return () => { changeListeners.delete(fn); };
    },

    async handle(msg) {
      if (stopped) throw new Error('mobile access is stopped');
      switch (msg.type) {
        case 'mobile.set': {
          const next: MobileConfig = { enabled: msg.enabled, relayUrl: msg.relayUrl, ...(config.terminalInput ? { terminalInput: true } : {}) };
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
        case 'mobile.terminal': {
          const next: MobileConfig = { enabled: config.enabled, relayUrl: config.relayUrl, ...(msg.input ? { terminalInput: true } : {}) };
          writeMobileConfig(next);
          config = next;
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
        case 'mobile.pairing.approve': {
          pairingIn(msg.id, ['confirm']);
          // pair_ok would go nowhere while the device is stored: refuse, the pairing stays in confirm.
          if (linkState.state !== 'online') throw new Error('the relay is offline');
          const before = new Set(devices.map((d) => d.id));
          pairing.approve(msg.id);
          // The device it replaces goes once the new one is stored (so a relay peer they share stays the new one's), and only
          // when a new key was approved: the same key approved again is that very device.
          const added = devices.some((d) => !before.has(d.id));
          if (msg.replaces !== undefined && added && before.has(msg.replaces)) await revoke(msg.replaces);
          return;
        }
        case 'mobile.pairing.deny':
          pairingIn(msg.id, ['confirm', 'waiting']);
          pairing.deny(msg.id);
          return;
        case 'mobile.device.revoke':
          return revoke(msg.id);
        case 'mobile.device.rename':
          rename(msg.id, msg.name);
          return;
        case 'mobile.device.ack': {
          if (!devices.some((d) => d.id === msg.id)) throw new Error('no such device');
          saveDevices(devices.map((d) => {
            if (d.id !== msg.id) return d;
            if (msg.what === 'refused') { const { refused: _r, ...rest } = d; return rest; }
            if (!d.recovered) return d;
            const { pending: _p, ...trace } = d.recovered;
            return { ...d, recovered: trace };
          }));
          changed();
          return;
        }
        case 'mobile.recovery.unblock':
          recovery.unblock();
          log('mobile recovery: unblocked on the PC');
          changed();
          return;
      }
    },

    send: (deviceId, text) => channels.send(deviceId, text),

    onRecovery(fn) {
      recoveryListeners.add(fn);
      return () => { recoveryListeners.delete(fn); };
    },

    onMessage(fn) {
      messageListeners.add(fn);
      return () => { messageListeners.delete(fn); };
    },

    async stop() {
      if (stopped) return;
      cancelSignin();
      closeLink();
      pairing.stop();
      recovery.stop();
      stopped = true;
      recoveryListeners.clear();
      changeListeners.clear();
      messageListeners.clear();
    }
  };
}
