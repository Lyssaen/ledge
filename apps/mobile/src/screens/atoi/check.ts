import { useRef } from 'react';
import type { Assertion } from '@ledge/protocol';
import { getAssertion } from '../../link/webauthn';
import type { ConfirmChallenge, ConfirmRequest, MobileStore } from '../../state/store';

/** Why a device check gave no assertion: dismissed, or it could not be made (no challenge, no passkey, a refused prompt). */
export type CheckProblem = 'cancelled' | 'failed' | 'prepareFailed';

/**
 * The device's check from a card (m1-a-toi.html §4, m1-reponses-rig.html §1): the tap asks the PC's challenge for that exact
 * subject, then opens the device's prompt. A browser may refuse a prompt that did not follow the tap closely enough: the
 * prompt then reads as dismissed, and the challenge is kept, so the next tap on the same subject opens the prompt at once.
 * A challenge is spent by a signature, and dropped when it expires.
 */
export function useDeviceCheck(store: MobileStore): (req: ConfirmRequest) => Promise<Assertion | CheckProblem> {
  const kept = useRef<{ subject: string; challenge: ConfirmChallenge; until: number } | null>(null);
  return async req => {
    const subject = JSON.stringify(req);
    const k = kept.current;
    let challenge = k && k.subject === subject && k.until > Date.now() ? k.challenge : null;
    if (!challenge) {
      kept.current = null;
      try { challenge = await store.prepareConfirm(req); }
      catch { return 'prepareFailed'; }
      // A little short of the PC's own limit, so a challenge used is never one the PC has just let go.
      kept.current = { subject, challenge, until: Date.now() + challenge.expiresInMs - 2_000 };
    }
    if (!challenge.credentialId) { kept.current = null; return 'failed'; }
    const signed = await getAssertion({ challenge: challenge.challenge, rpId: challenge.rpId, credentialId: challenge.credentialId }).catch(() => 'failed' as const);
    if (signed === 'cancelled') return 'cancelled';
    kept.current = null;
    return signed;
  };
}
