// The phone's side of pairing: commit, wait for the PC's offer, reveal, show the code, then both confirmations.
// The phone has no cancel frame: giving up is going silent, and the PC's own pairing expires.
import { PAIR_LABEL_MAX, type SealedFrame } from '@ledge/protocol';
import { commit, fingerprint, pairingCode, randomNonce, type Identity } from '@ledge/seal';
import { copy } from '../copy';
import type { PinnedPc } from './keys';

/** The same window as the PC's (`packages/ledge/src/mobile/pairing.ts`), counted from `pair_commit`. */
export const PAIRING_TTL_MS = 5 * 60_000;

export type PairingState =
  | { step: 'committing' }
  | { step: 'compare'; code: string; pcConfirmed: boolean; phoneConfirmed: boolean }
  | { step: 'linked'; pc: PinnedPc }
  | { step: 'refused' }
  | { step: 'expired' }
  | { step: 'cancelled' };

export interface Pairing {
  /** A frame from the PC; anything but `pair_offer`, `pair_ok` and `pair_no` is ignored, as is a frame out of order. */
  receive(f: SealedFrame): Promise<void>;
  /** The user saw the same code on both screens. */
  confirmOnPhone(): void;
  /** Gives up without a word to the PC. */
  cancel(): void;
  state(): PairingState;
}

type Offer = { pc: string; fingerprint: string };

/**
 * Sends `pair_commit` at once. Linked only once `pair_ok` came **and** `confirmOnPhone()` was called, in either order,
 * the PC's `pair_ok` within `ttlMs` of the commit (the phone's own confirmation may come later); the pinned key is the
 * one of `pair_offer`. A second `pair_offer` is ignored. A commitment that cannot be computed ends in `cancelled`.
 */
export function startPairing(opts: {
  identity: Identity;
  label: string;
  send(f: SealedFrame): void;
  now?(): number;
  ttlMs?: number;
}): Pairing {
  const now = opts.now ?? Date.now;
  const expiresAt = now() + (opts.ttlMs ?? PAIRING_TTL_MS);
  const nonce = randomNonce();
  const label = opts.label.trim().slice(0, PAIR_LABEL_MAX).trim() || copy.compare.deviceLabel;

  let s: PairingState = { step: 'committing' };
  /** Set by the first `pair_offer`, before any await: a second one finds it taken. */
  let offerTaken = false;
  let offer: Offer | null = null;

  const live = () => s.step === 'committing' || s.step === 'compare';
  /** Once the PC said yes, the window is closed on its side: only the phone's own confirmation is left. */
  const expireIfDue = () => {
    if (s.step === 'compare' && s.pcConfirmed) return;
    if (live() && now() >= expiresAt) s = { step: 'expired' };
  };

  const settleIfBoth = () => {
    if (s.step !== 'compare' || !s.pcConfirmed || !s.phoneConfirmed || !offer) return;
    s = { step: 'linked', pc: { publicKey: offer.pc, fingerprint: offer.fingerprint, name: null, pinnedAt: new Date(now()).toISOString() } };
  };

  const onOffer = async (f: Extract<SealedFrame, { k: 'pair_offer' }>) => {
    if (s.step !== 'committing' || offerTaken) return;
    offerTaken = true;
    let code: string;
    let fp: string;
    try {
      // Throws `bad_key` on a point that is not on the curve.
      fp = await fingerprint(f.pc);
      code = await pairingCode({ pcPublicKey: f.pc, devicePublicKey: opts.identity.publicKey, deviceNonce: nonce, pcNonce: f.n });
    } catch {
      // Not a P-256 point: ignored, as a frame that fails its schema would be.
      offerTaken = false;
      return;
    }
    expireIfDue();
    if (s.step !== 'committing') return;
    offer = { pc: f.pc, fingerprint: fp };
    // The code is on screen before the reveal leaves, so the PC's pair_ok always finds `compare`.
    s = { step: 'compare', code, pcConfirmed: false, phoneConfirmed: false };
    opts.send({ k: 'pair_reveal', d: opts.identity.publicKey, n: nonce });
  };

  // A commitment that cannot be computed leaves nothing to wait for: cancelled, as if the user gave up, silently.
  const ready = commit(opts.identity.publicKey, nonce).then(
    (c) => { if (s.step === 'committing') opts.send({ k: 'pair_commit', c, label }); },
    () => { if (live()) s = { step: 'cancelled' }; }
  );

  return {
    async receive(f) {
      await ready;
      expireIfDue();
      if (f.k === 'pair_offer') return onOffer(f);
      if (f.k === 'pair_no') {
        if (live()) s = { step: 'refused' };
        return;
      }
      if (f.k === 'pair_ok' && s.step === 'compare' && !s.pcConfirmed) {
        s = { ...s, pcConfirmed: true };
        settleIfBoth();
      }
    },
    confirmOnPhone() {
      expireIfDue();
      if (s.step !== 'compare' || s.phoneConfirmed) return;
      s = { ...s, phoneConfirmed: true };
      settleIfBoth();
    },
    cancel() {
      if (live()) s = { step: 'cancelled' };
    },
    state() {
      expireIfDue();
      return s;
    }
  };
}
