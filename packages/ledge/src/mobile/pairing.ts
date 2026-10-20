// Device pairing on the PC: commitment, offer, reveal, code, then the user's decision.
import { PAIR_LABEL_MAX, type SealedFrame } from '@ledge/protocol';
import { b64u, checkCommitment, fingerprint, fromB64u, importPublicKey, pairingCode, randomNonce, type Identity } from '@ledge/seal';
import type { ApprovedDevice } from './files.js';
import type { Schedule } from './link.js';
import { log } from '../log.js';

export type PairingView = {
  id: string;
  label: string;
  code: string | null;
  expiresAt: string;
  state: 'waiting' | 'confirm' | 'approved' | 'linked' | 'expired' | 'refused';
};

export interface Pairing {
  /** True if `frame` was a `pair_*` frame (handled or ignored here). */
  receive(peer: string, frame: SealedFrame): Promise<boolean>;
  approve(id: string): void;
  deny(id: string): void;
  /** The first confirmed channel of device `deviceId` (its fingerprint). */
  linked(deviceId: string): void;
  views(): PairingView[];
  /** A new `welcome`: pairings still `waiting` or `confirm` are dropped. */
  reset(): void;
  stop(): void;
}

export const PAIRING_TTL_MS = 5 * 60_000;
export const MAX_PAIRINGS = 3;
/** How long an `expired`, `refused` or `linked` pairing stays visible, for the popup. */
export const PAIRING_LINGER_MS = 10_000;
const DEFAULT_LABEL = 'Appareil';

interface Entry {
  id: string;
  peer: string;
  label: string;
  commitment: string;
  pcNonce: string;
  expiresAt: number;
  state: PairingView['state'];
  code: string | null;
  /** Set once the reveal checked out. */
  device: { publicKey: string; fingerprint: string } | null;
  /** A reveal is being checked: a second one is ignored. */
  revealing: boolean;
  cancelTimer: () => void;
}

const realSchedule: Schedule = (fn, ms) => {
  const h = setTimeout(fn, ms);
  return () => clearTimeout(h);
};

/** Control characters removed, trimmed, cut to `PAIR_LABEL_MAX` (never inside a surrogate pair); empty becomes `'Appareil'`. */
export function cleanLabel(raw: string): string {
  let s = raw.replace(/\p{Cc}/gu, '').trim();
  if (s.length > PAIR_LABEL_MAX) {
    s = s.slice(0, PAIR_LABEL_MAX);
    if (/[\uD800-\uDBFF]$/.test(s)) s = s.slice(0, -1);
    s = s.trim();
  }
  return s || DEFAULT_LABEL;
}

const isPairFrame = (f: SealedFrame) => f.k.startsWith('pair_');

/**
 * The PC side of the exchange. Peers are only routing hints: the approved device is named by its key's fingerprint.
 * `now` and `schedule` (TTL and linger timers) are for tests; they default to the real ones.
 */
export function createPairing(opts: {
  pc: Identity;
  send(peer: string, frame: SealedFrame): void;
  approve(d: Omit<ApprovedDevice, 'lastSeenAt'>): void;
  onChange(): void;
  now?: () => number;
  ttlMs?: number;
  schedule?: Schedule;
}): Pairing {
  const now = opts.now ?? Date.now;
  const ttlMs = opts.ttlMs ?? PAIRING_TTL_MS;
  const schedule = opts.schedule ?? realSchedule;
  /** One pairing per peer, in arrival order. */
  const entries = new Map<string, Entry>();
  let stopped = false;

  const active = (e: Entry) => e.state === 'waiting' || e.state === 'confirm' || e.state === 'approved';

  const remove = (e: Entry) => {
    e.cancelTimer();
    if (entries.get(e.peer) === e) entries.delete(e.peer);
  };

  /** Final state: visible for the popup, then gone. */
  const settle = (e: Entry, state: 'expired' | 'refused' | 'linked') => {
    e.cancelTimer();
    e.state = state;
    e.cancelTimer = schedule(() => {
      if (entries.get(e.peer) !== e) return;
      entries.delete(e.peer);
      opts.onChange();
    }, PAIRING_LINGER_MS);
    opts.onChange();
  };

  const onTtl = (e: Entry) => {
    if (entries.get(e.peer) !== e) return;
    if (e.state === 'waiting' || e.state === 'confirm') {
      log(`mobile pairing: expired for peer ${e.peer}`);
      settle(e, 'expired');
    } else if (e.state === 'approved') {
      // Already approved and stored; only the wait for its first channel ends.
      remove(e);
      opts.onChange();
    }
  };

  const byId = (id: string) => [...entries.values()].find((e) => e.id === id);

  const onCommit = (peer: string, frame: Extract<SealedFrame, { k: 'pair_commit' }>) => {
    const old = entries.get(peer);
    if (old) remove(old);
    const others = [...entries.values()].filter(active).length;
    if (others >= MAX_PAIRINGS) {
      log(`mobile pairing: refused peer ${peer}, ${MAX_PAIRINGS} pairings already pending`);
      opts.send(peer, { k: 'pair_no' });
      if (old) opts.onChange();
      return;
    }
    const e: Entry = {
      id: b64u(globalThis.crypto.getRandomValues(new Uint8Array(16))),
      peer,
      label: cleanLabel(frame.label),
      commitment: frame.c,
      pcNonce: randomNonce(),
      expiresAt: now() + ttlMs,
      state: 'waiting',
      code: null,
      device: null,
      revealing: false,
      cancelTimer: () => {}
    };
    entries.set(peer, e);
    e.cancelTimer = schedule(() => onTtl(e), ttlMs);
    opts.send(peer, { k: 'pair_offer', pc: opts.pc.publicKey, n: e.pcNonce });
    opts.onChange();
  };

  const onReveal = async (peer: string, frame: Extract<SealedFrame, { k: 'pair_reveal' }>) => {
    const e = entries.get(peer);
    if (!e || e.state !== 'waiting' || e.revealing) return;
    e.revealing = true;
    let ok = false;
    let code = '';
    let id = '';
    try {
      await importPublicKey(frame.d);
      if (fromB64u(frame.n).length === 32 && (await checkCommitment(e.commitment, frame.d, frame.n))) {
        code = await pairingCode({ pcPublicKey: opts.pc.publicKey, devicePublicKey: frame.d, deviceNonce: frame.n, pcNonce: e.pcNonce });
        id = await fingerprint(frame.d);
        ok = true;
      }
    } catch {
      ok = false;
    }
    // Replaced, expired, reset or stopped while checking: this reveal no longer counts.
    if (stopped || entries.get(peer) !== e || e.state !== 'waiting') return;
    e.revealing = false;
    if (!ok) {
      log(`mobile pairing: reveal from peer ${peer} does not match its commitment`);
      remove(e);
      opts.send(peer, { k: 'pair_no' });
      opts.onChange();
      return;
    }
    e.code = code;
    e.device = { publicKey: frame.d, fingerprint: id };
    e.state = 'confirm';
    opts.onChange();
  };

  return {
    async receive(peer, frame) {
      if (!isPairFrame(frame)) return false;
      if (stopped) return true;
      if (frame.k === 'pair_commit') onCommit(peer, frame);
      else if (frame.k === 'pair_reveal') await onReveal(peer, frame);
      // pair_offer, pair_ok and pair_no only travel from the PC: ignored.
      return true;
    },

    approve(id) {
      const e = byId(id);
      if (!e || e.state !== 'confirm' || !e.device) return;
      if (now() > e.expiresAt) { settle(e, 'expired'); return; }
      opts.approve({
        id: e.device.fingerprint,
        publicKey: e.device.publicKey,
        label: e.label,
        approvedAt: new Date(now()).toISOString(),
        lastPeer: e.peer
      });
      log(`mobile pairing: approved device ${e.device.fingerprint}`);
      // Stored before pair_ok, so the device's first hello finds it approved.
      opts.send(e.peer, { k: 'pair_ok' });
      e.state = 'approved';
      // The wait for the device's first channel starts over: approval may come late in the window.
      e.cancelTimer();
      e.expiresAt = now() + ttlMs;
      e.cancelTimer = schedule(() => onTtl(e), ttlMs);
      opts.onChange();
    },

    deny(id) {
      const e = byId(id);
      if (!e || (e.state !== 'confirm' && e.state !== 'waiting')) return;
      opts.send(e.peer, { k: 'pair_no' });
      settle(e, 'refused');
    },

    linked(deviceId) {
      const e = [...entries.values()].find((x) => x.state === 'approved' && x.device?.fingerprint === deviceId);
      if (e) settle(e, 'linked');
    },

    views() {
      return [...entries.values()].map((e) => ({
        id: e.id,
        label: e.label,
        code: e.code,
        expiresAt: new Date(e.expiresAt).toISOString(),
        state: e.state
      }));
    },

    reset() {
      const dropped = [...entries.values()].filter((e) => e.state === 'waiting' || e.state === 'confirm');
      for (const e of dropped) remove(e);
      if (dropped.length) opts.onChange();
    },

    stop() {
      stopped = true;
      for (const e of entries.values()) e.cancelTimer();
      entries.clear();
    }
  };
}
