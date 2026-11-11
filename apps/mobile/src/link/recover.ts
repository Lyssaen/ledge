// The phone's side of a passkey recovery after a reinstall (docs/mobile-passkey-recover-contract.md §3): a new device key,
// the PC's offer, a discoverable assertion over a challenge the phone computes itself, and the PC's answer. Nothing is
// pinned before `recover_ok`, and nothing is sent once the passkey's userHandle names another PC key (rule 2).
import { RECOVER_TTL_MS, type RecoverWhy, type SealedFrame } from '@ledge/protocol';
import { digestTag, fingerprint, keyDigest, randomNonce, recoverChallenge, userHandleDigest, userHandleMatches, type Identity } from '@ledge/seal';
import type { PinnedPc } from './keys';
import type { Discoverable } from './webauthn';

/** Why a recovery ended without the device back: the PC's `failed` is shown as `timeout` (screen 2 i), as the contract says;
 *  `unsaved` the PC took the device back but this one could not keep the PC's key, so nothing is linked. */
export type RecoverEnd = Exclude<RecoverWhy, 'failed'> | 'unsaved';

export type RecoveryState =
  /** `recover_start` sent, the PC's offer awaited (« Connexion à WSL… »). */
  | { step: 'reaching' }
  /** The offer is in: Face ID, through the device's own sheet. */
  | { step: 'faceid'; pcName: string | null }
  /** The proof is sent: the PC checks it (« WSL vérifie la passkey… »). */
  | { step: 'checking'; pcName: string | null }
  /** Back: the PC to pin, and the name this device keeps on it. */
  | { step: 'done'; pc: PinnedPc; name: string | null }
  /**
   * Stopped. `device` the device the passkey names (`revoked`, `connected`), `revokedAt` the day it was revoked,
   * `retryInMs` until the PC takes a recovery again (`rate`), `tags` the passkey's PC key and the one received (`otherPc`).
   */
  | { step: 'failed'; why: RecoverEnd; pcName: string | null; device?: string; revokedAt?: string; retryInMs?: number; tags?: readonly [string, string] }
  | { step: 'cancelled' };

export interface Recovery {
  /** A frame from the PC; anything but `recover_offer`, `recover_ok` and `recover_no` is ignored, as is one out of order. */
  receive(f: SealedFrame): Promise<void>;
  /**
   * « Réessayer » after Face ID was cancelled: the same offer while it lives, so the device's sheet opens inside the tap
   * and the PC counts no second try. False when the offer is spent or too old: a new recovery is needed.
   */
  again(): boolean;
  /** « Annuler »: gives up without a word to the PC, whose nonce expires on its own. */
  cancel(): void;
  state(): RecoveryState;
}

/** An offer is used again only with this much of its life left, so the proof still reaches the PC in time. */
const AGAIN_MARGIN_MS = 15_000;

/**
 * Sends `recover_start` at once and moves on each frame; `changed` runs on every change of `state()`. `assert` opens the
 * device's passkey sheet for a challenge (a discoverable `get()`). No answer within `ttlMs` of a frame sent: `timeout`.
 */
export function startRecovery(opts: {
  identity: Identity;
  model: string;
  send(f: SealedFrame): boolean;
  assert(challenge: string): Promise<Discoverable | 'cancelled'>;
  changed(): void;
  /** Keeps the PC's key once it took the device back; `done` only once it is kept. */
  pin(pc: PinnedPc): Promise<void>;
  now?(): number;
  ttlMs?: number;
}): Recovery {
  const now = opts.now ?? Date.now;
  const ttl = opts.ttlMs ?? RECOVER_TTL_MS;
  const nonce = randomNonce();
  let s: RecoveryState = { step: 'reaching' };
  /** The PC's offer, with the challenge computed from it, ready before any tap so the sheet opens inside one. */
  let offer: { pc: string; n: string; name: string | null; at: number; challenge: string } | null = null;
  /** The offer's nonce went with a proof: the PC has consumed it. */
  let spent = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const set = (next: RecoveryState) => {
    s = next;
    if (next.step !== 'reaching' && next.step !== 'checking') clearTimeout(timer);
    opts.changed();
  };
  const live = () => s.step === 'reaching' || s.step === 'faceid' || s.step === 'checking';
  const fail = (why: RecoverEnd, extra: Partial<Extract<RecoveryState, { step: 'failed' }>> = {}) =>
    set({ step: 'failed', why, pcName: offer?.name ?? null, ...extra });
  /** Waits for the PC's next frame; its silence past the nonce's life is screen 2 i. */
  const wait = () => {
    clearTimeout(timer);
    const step = s.step;
    timer = setTimeout(() => { if (s.step === step) fail('timeout'); }, ttl);
  };

  const sign = async () => {
    const o = offer;
    if (!o) return;
    set({ step: 'faceid', pcName: o.name });
    let got: Discoverable | 'cancelled';
    try {
      // Nothing is awaited before the sheet is asked for: « Réessayer » opens it inside its own tap.
      got = await opts.assert(o.challenge);
    } catch {
      got = 'cancelled';
    }
    if (s.step !== 'faceid' || offer !== o) return;
    if (got === 'cancelled') { fail('none'); return; }
    // Rule 2: the passkey names the PC key it was made for; another one, or none, and nothing leaves this device.
    let match: 'ok' | 'old' | 'other';
    try { match = await userHandleMatches(got.userHandle, o.pc); } catch { match = 'other'; }
    if (s.step !== 'faceid' || offer !== o) return;
    if (match === 'old') { fail('old'); return; }
    if (match === 'other') {
      const mine = userHandleDigest(got.userHandle);
      let theirs = '';
      try { theirs = digestTag(await keyDigest(o.pc)); } catch { /* an offer's key is a valid point: its schema and fingerprint said so */ }
      fail('otherPc', { tags: [mine ? digestTag(mine) : '', theirs] });
      return;
    }
    spent = true;
    if (!opts.send({ k: 'recover_proof', assertion: got.assertion, userHandle: got.userHandle })) { fail('offline'); return; }
    set({ step: 'checking', pcName: o.name });
    wait();
  };

  if (opts.send({ k: 'recover_start', d: opts.identity.publicKey, n: nonce, model: opts.model })) wait();
  else s = { step: 'failed', why: 'offline', pcName: null };

  return {
    async receive(f) {
      if (f.k === 'recover_offer') {
        if (s.step !== 'reaching' || offer) return;
        let challenge: string;
        try {
          await fingerprint(f.pc);
          challenge = await recoverChallenge({ pcPublicKey: f.pc, devicePublicKey: opts.identity.publicKey, pcNonce: f.n, deviceNonce: nonce });
        } catch { return; }
        if (s.step !== 'reaching' || offer) return;
        offer = { pc: f.pc, n: f.n, name: f.name ?? null, at: now(), challenge };
        await sign();
        return;
      }
      if (f.k === 'recover_no') {
        if (s.step !== 'reaching' && s.step !== 'checking') return;
        const why: RecoverEnd = f.why === 'failed' ? 'timeout' : f.why;
        fail(why, {
          ...(f.device !== undefined ? { device: f.device } : {}),
          ...(f.revokedAt !== undefined ? { revokedAt: f.revokedAt } : {}),
          ...(f.retryInMs !== undefined ? { retryInMs: f.retryInMs } : {})
        });
        return;
      }
      if (f.k === 'recover_ok' && s.step === 'checking' && offer) {
        const o = offer;
        const fp = await fingerprint(o.pc);
        if (s.step !== 'checking') return;
        const pc: PinnedPc = { publicKey: o.pc, fingerprint: fp, name: o.name, pinnedAt: new Date(now()).toISOString() };
        clearTimeout(timer);
        try { await opts.pin(pc); } catch { if (s.step === 'checking') fail('unsaved'); return; }
        if (s.step !== 'checking') return;
        set({ step: 'done', pc, name: f.name ?? null });
      }
    },
    again() {
      if (s.step !== 'failed' || s.why !== 'none' || !offer || spent || now() - offer.at > ttl - AGAIN_MARGIN_MS) return false;
      void sign();
      return true;
    },
    cancel() {
      if (live()) set({ step: 'cancelled' });
    },
    state: () => s
  };
}
