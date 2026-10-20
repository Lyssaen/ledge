import { PHONE_PROTOCOL, type PhoneClientMessage, type PhoneServerMessage, type PhoneSession } from '@ledge/protocol';
import type { LinkState, PhoneLink } from '../../src/link/link';

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
  const link: PhoneLink = {
    state: () => state,
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    onMessage(fn) { handlers.add(fn); return () => { handlers.delete(fn); }; },
    async send(m) {
      if (state !== 'ready') return false;
      sent.push(m);
      return true;
    },
    pairing: () => null,
    startPairing() {},
    async relink() {},
    async signOut() {},
    close() {}
  };
  return {
    link,
    sent,
    /** The messages of one type sent so far. */
    of<T extends PhoneClientMessage['type']>(type: T) { return sent.filter((m): m is Extract<PhoneClientMessage, { type: T }> => m.type === type); },
    set(s: LinkState) { state = s; for (const f of [...listeners]) f(); },
    deliver(m: PhoneServerMessage) { for (const h of [...handlers]) h(m); },
    listening: () => handlers.size + listeners.size
  };
}

const caps = { freeTextAnswer: true };
export const snapshot = (sessions: PhoneSession[], name = 'Atelier'): PhoneServerMessage => ({
  type: 'snapshot', protocol: PHONE_PROTOCOL, sessions,
  capabilities: { claude: caps, codex: caps, cursor: { freeTextAnswer: false } }, daemon: { version: '0.9.0', name }
});
