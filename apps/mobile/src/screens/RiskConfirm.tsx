import type { Assertion } from '@ledge/protocol';
import { useEffect, useRef, useState } from 'react';
import { copy } from '../copy';
import { getAssertion } from '../link/webauthn';
import type { InboxItem } from '../model/requests';
import type { ConfirmChallenge, ConfirmedExpect, MobileStore } from '../state/store';
import { Notice } from '../ui/Notice';
import { isApple } from './device';
import { buttonClass } from '../ui/Button';
import { Icon } from '../ui/icons';

const C = copy.confirm;
const full = (variant?: 'primary') => buttonClass({ variant, block: true });

/** What the PC said about the device check of the last accept, when it refused it. */
export type ConfirmReason = 'assertion_expired' | 'assertion_invalid' | 'confirm_required';

type Problem = 'cancelled' | 'expired' | 'failed' | 'prepareFailed' | 'changed';


export interface RiskConfirmProps {
  store: MobileStore;
  item: InboxItem;
  /** The PC can be reached and the request is still the one pending: a challenge is asked, a tap is honoured. */
  enabled: boolean;
  /** The PC refused the last accept for its device check: a new challenge is asked only when « Réessayer » is tapped. */
  reason?: ConfirmReason | undefined;
  /** Sends what the device confirmed, with its assertion and the request it confirmed (an accept, or a reply with the option chosen): the op's id, or null when nothing was sent. */
  onConfirm: (assertion: Assertion, expect: ConfirmedExpect) => string | null;
  /** The other way out, beside the confirmation: refusing (the default), or going back to choose again. */
  onDeny: () => void;
  denyLabel?: string;
}

/**
 * The card of a high-impact accept: the device (Face ID, fingerprint, PIN) signs the PC's challenge, and only then is
 * the accept (or the reply with the option chosen) sent, with that assertion. The challenge is asked as soon as the card opens, so the tap that follows can
 * open the device's prompt at once. A cancelled prompt sends nothing; the PC's refusals of the check say so and offer
 * a new challenge.
 */
export function RiskConfirm({ store, item, enabled, reason, onConfirm, onDeny, denyLabel }: RiskConfirmProps) {
  const [challenge, setChallenge] = useState<ConfirmChallenge | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [asking, setAsking] = useState(false);
  // A refusal of the PC is read before anything new is asked.
  const [waitingRetry, setWaitingRetry] = useState(reason !== undefined);
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);
  const enabledNow = useRef(enabled);
  enabledNow.current = enabled;
  // The request the live challenge was prepared for.
  const prepared = useRef<ConfirmedExpect | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    if (waitingRetry || !enabled) return;
    const pending = store.getState().sessions.get(item.sessionId)?.pending;
    if (!pending?.key) return;
    let on = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setChallenge(null);
    const expect: ConfirmedExpect = { key: pending.key, kind: pending.kind, text: pending.text };
    store.prepareConfirm({ purpose: 'decide', id: item.sessionId, expect }).then(
      c => {
        if (!on) return;
        prepared.current = expect;
        setChallenge(c);
        // A challenge is good for a minute: after that the PC would only refuse it.
        timer = setTimeout(() => { if (on) { setChallenge(null); setProblem('expired'); } }, c.expiresInMs);
      },
      () => { if (on) setProblem('prepareFailed'); }
    );
    return () => { on = false; clearTimeout(timer); };
  }, [store, item.sessionId, item.key, enabled, waitingRetry, attempt]);

  const shown: Problem | null = waitingRetry && reason ? (reason === 'assertion_expired' ? 'expired' : 'failed') : problem;
  const retry = () => { setProblem(null); setWaitingRetry(false); setAttempt(a => a + 1); };

  const go = async () => {
    if (!enabled || asking || !challenge) return;
    if (!challenge.credentialId) { setChallenge(null); setProblem('failed'); return; }
    setAsking(true);
    setProblem(null);
    const signed = await getAssertion({ challenge: challenge.challenge, rpId: challenge.rpId, credentialId: challenge.credentialId }).catch(() => 'failed' as const);
    if (!mounted.current) return;
    setAsking(false);
    // The gesture took a while: only the request it was prepared for may be answered with it.
    const asked = prepared.current;
    if (!asked || !enabledNow.current || store.getState().sessions.get(item.sessionId)?.pending?.key !== asked.key) {
      setChallenge(null);
      setProblem('changed');
      return;
    }
    if (signed === 'cancelled') { setProblem('cancelled'); return; }
    if (signed === 'failed') { setProblem('failed'); return; }
    // The challenge is spent by this accept, whatever the PC says of it.
    setChallenge(null);
    if (onConfirm(signed, asked) === null) setProblem('failed');
  };

  const needsNew = shown === 'expired' || shown === 'failed' || shown === 'prepareFailed' || shown === 'changed';
  const label = asking ? C.asking : challenge ? (isApple() ? C.goApple : C.go) : C.preparing;
  return (
    <section aria-labelledby="confirm-title" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
      <h2 id="confirm-title" className="text-[17px] leading-[1.35] font-semibold">{C.heading}</h2>
      <p className="text-xs leading-[1.6] text-muted">{C.note}</p>
      {shown && <Notice title={shown === 'changed' ? copy.decide.changed : C[shown]} tone="warning" role="alert" />}
      {needsNew
        ? <button type="button" disabled={!enabled} onClick={retry} className={full('primary')}>{C.retry}</button>
        : <button type="button" disabled={!enabled || asking || !challenge} onClick={() => { void go(); }} className={full('primary')}>{label}</button>}
      <button type="button" disabled={!enabled} onClick={onDeny} className={full()}>{denyLabel ?? copy.decide.deny}</button>
    </section>
  );
}

/**
 * Where a high-impact accept stands when the device cannot confirm it (a PC of lot 5, no credential, no platform
 * authenticator): done on the PC. Not a button: there is nothing to tap.
 */
export function OnPc() {
  return (
    <p className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-control border border-dashed border-line px-4 py-2.5 text-center text-[13px] leading-[1.4] font-medium text-muted">
      <Icon name="monitor" className="size-4" />
      {copy.decide.onPc}
    </p>
  );
}
