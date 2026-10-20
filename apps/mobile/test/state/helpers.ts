import { PHONE_PROTOCOL, type PhoneClientMessage, type PhoneServerMessage, type PhoneSession } from '@ledge/protocol';
import type { PinnedPc } from '../../src/link/keys';
import type { LinkState, PhoneLink, Reach } from '../../src/link/link';
import type { Pairing, PairingState } from '../../src/link/pairing';

/** A Storage held in memory, one per test, so nothing leaks between them. */
export class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, String(value)); }
}

/** A PhoneLink driven by the test: its state is set by hand, what the store sends is recorded, the PC's messages delivered. */
export function fakeLink(initial: LinkState = 'ready') {
  let state = initial;
  const listeners = new Set<() => void>();
  const handlers = new Set<(m: PhoneServerMessage) => void>();
  const sent: PhoneClientMessage[] = [];
  /** The link's own calls (pairing, relink, signOut, retry), in order. */
  const calls: string[] = [];
  let pairingState: PairingState | null = null;
  let pinned: PinnedPc | null = null;
  let received: string | null = null;
  let reach: Reach = 'pc_online';
  const notify = () => { for (const f of [...listeners]) f(); };
  const pairing: Pairing = {
    async receive() {},
    confirmOnPhone() {
      calls.push('confirmOnPhone');
      if (pairingState?.step === 'compare') { pairingState = { ...pairingState, phoneConfirmed: true }; notify(); }
    },
    cancel() {
      calls.push('cancel');
      if (pairingState?.step === 'committing' || pairingState?.step === 'compare') { pairingState = { step: 'cancelled' }; notify(); }
    },
    state: () => pairingState ?? { step: 'committing' }
  };
  const link: PhoneLink = {
    state: () => state,
    reach: () => reach,
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    onMessage(fn) { handlers.add(fn); return () => { handlers.delete(fn); }; },
    async send(m) {
      if (state !== 'ready') return false;
      sent.push(m);
      return true;
    },
    pairing: () => pairingState ? pairing : null,
    startPairing() { calls.push('startPairing'); },
    async relink() { calls.push('relink'); },
    async signOut() { calls.push('signOut'); },
    retry() { calls.push('retry'); },
    pinned: () => pinned,
    receivedKey: () => received,
    close() {}
  };
  return {
    link,
    sent,
    /** The messages of one type sent so far. */
    of<T extends PhoneClientMessage['type']>(type: T) { return sent.filter((m): m is Extract<PhoneClientMessage, { type: T }> => m.type === type); },
    calls,
    set(s: LinkState) { state = s; notify(); },
    /** The pairing under way as the link would show it; null for none. */
    setPairing(s: PairingState | null) { pairingState = s; notify(); },
    setPinned(pc: PinnedPc | null) { pinned = pc; notify(); },
    setReceivedKey(fp: string | null) { received = fp; notify(); },
    setReach(r: Reach) { reach = r; notify(); },
    deliver(m: PhoneServerMessage) { for (const h of [...handlers]) h(m); },
    listening: () => handlers.size + listeners.size
  };
}

const caps = { freeTextAnswer: true };
export const snapshot = (sessions: PhoneSession[], name = 'Atelier', boot?: string): PhoneServerMessage => ({
  type: 'snapshot', protocol: PHONE_PROTOCOL, sessions,
  capabilities: { claude: caps, codex: caps, cursor: { freeTextAnswer: false }, omp: { freeTextAnswer: false } }, daemon: { version: '0.9.0', name, ...(boot ? { boot } : {}) }
});
