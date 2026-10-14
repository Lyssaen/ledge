import { randomBytes } from 'node:crypto';

/** What a high-impact challenge authorises: one decision, by one device, on one version of one request. */
export interface Binding { deviceId: string; sessionId: string; pendingId: string; pendingVersion: number; decision: 'accept' }

export type ConsumeResult = 'ok' | 'expired' | 'mismatch' | 'unknown';

interface Entry { binding: Binding; expiresAt: number }

const TTL_MS = 60_000;

const sameBinding = (a: Binding, b: Binding) =>
  a.deviceId === b.deviceId && a.sessionId === b.sessionId && a.pendingId === b.pendingId &&
  a.pendingVersion === b.pendingVersion && a.decision === b.decision;

/**
 * Single-use WebAuthn challenges for high-impact decisions (Global Constraints: "à usage unique et lié à la
 * demande, à sa version et à la décision"). Held in memory only: a daemon restart voids them all.
 * Both methods are synchronous, so a challenge is taken before any await in the caller.
 */
export class ChallengeStore {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(o: { now?: () => number; ttlMs?: number } = {}) {
    this.now = o.now ?? Date.now;
    this.ttlMs = o.ttlMs ?? TTL_MS;
  }

  /** A fresh challenge; any earlier one of the same device for the same request stops being valid. */
  issue(b: Binding): { challenge: string; expiresAt: string } {
    const now = this.now();
    for (const [c, e] of this.entries) {
      if (e.expiresAt < now || (e.binding.deviceId === b.deviceId && e.binding.pendingId === b.pendingId)) this.entries.delete(c);
    }
    const challenge = randomBytes(32).toString('base64url');
    const expiresAt = now + this.ttlMs;
    this.entries.set(challenge, { binding: { ...b }, expiresAt });
    return { challenge, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** Spends the challenge whatever the outcome (an unknown one has nothing to spend), so it is never checked twice. */
  consume(challenge: string, b: Binding): ConsumeResult {
    const e = this.entries.get(challenge);
    if (!e) return 'unknown';
    this.entries.delete(challenge);
    if (this.now() > e.expiresAt) return 'expired';
    return sameBinding(e.binding, b) ? 'ok' : 'mismatch';
  }
}
