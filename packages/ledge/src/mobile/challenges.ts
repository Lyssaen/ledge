import { randomBytes } from 'node:crypto';

// Single-use challenges the daemon issues to a phone before it asks for a passkey assertion. Each challenge is bound
// to one device, one purpose and one subject, and is consumed on first use. Imports only node:crypto, like webauthn.ts.

export const CHALLENGE_TTL_MS = 60_000;
const MAX_OUTSTANDING = 1_000;

export interface ChallengeBinding { deviceId: string; purpose: 'register' | 'decide' | 'launch' | 'close'; subject: string }
export type ChallengeVerdict = 'ok' | 'expired' | 'mismatch' | 'unknown';
interface Pending { binding: ChallengeBinding; issuedAt: number; slot: string }

export function createChallengeStore(opts: { now?: () => number; ttlMs?: number; max?: number } = {}) {
  const now = opts.now ?? Date.now;
  const ttlMs = opts.ttlMs ?? CHALLENGE_TTL_MS;
  const max = opts.max ?? MAX_OUTSTANDING;
  // Challenge -> pending, in issue order (a Map keeps insertion order, so the first key is the oldest).
  const pending = new Map<string, Pending>();
  // One outstanding challenge per (device, purpose, subject): a new issue replaces the previous one.
  const slots = new Map<string, string>();

  const slotOf = (b: ChallengeBinding): string => JSON.stringify([b.deviceId, b.purpose, b.subject]);
  const forget = (challenge: string, p: Pending): void => {
    pending.delete(challenge);
    if (slots.get(p.slot) === challenge) slots.delete(p.slot);
  };

  return {
    issue(b: ChallengeBinding): string {
      const slot = slotOf(b);
      const previous = slots.get(slot);
      if (previous !== undefined) pending.delete(previous);
      const challenge = randomBytes(32).toString('base64url');
      pending.set(challenge, { binding: { deviceId: b.deviceId, purpose: b.purpose, subject: b.subject }, issuedAt: now(), slot });
      slots.set(slot, challenge);
      while (pending.size > max) {
        const oldest = pending.keys().next().value;
        if (oldest === undefined) break;
        const p = pending.get(oldest);
        if (p) forget(oldest, p);
      }
      return challenge;
    },

    /** Synchronous and single-use: a challenge is dropped on any answer that found it, valid or not. */
    consume(challenge: string, b: ChallengeBinding): ChallengeVerdict {
      if (typeof challenge !== 'string' || challenge === '') return 'unknown';
      const p = pending.get(challenge);
      if (!p) return 'unknown';
      forget(challenge, p);
      if (now() - p.issuedAt > ttlMs) return 'expired';
      const want = p.binding;
      if (want.deviceId !== b.deviceId || want.purpose !== b.purpose || want.subject !== b.subject) return 'mismatch';
      return 'ok';
    },
  };
}

export type ChallengeStore = ReturnType<typeof createChallengeStore>;
