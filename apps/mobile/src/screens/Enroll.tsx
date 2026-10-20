import { useEffect, useState, type ReactNode } from 'react';
import { copy } from '../copy';
import { createCredential } from '../link/webauthn';
import { deviceLabel } from '../link/label';
import { href } from '../router';
import { useMobile, type ConfirmChallenge, type MobileStore } from '../state/store';
import { Notice } from '../ui/Notice';
import { OUTLINE, PRIMARY } from '../ui/Board';
import { usePlatform } from './device';

const E = copy.enroll;

type Problem = 'cancelled' | 'unsupported' | 'failed' | 'prepareFailed';

/**
 * Protecting the high-impact accepts: this device makes a passkey and the PC keeps its public key. The challenge is
 * asked as soon as the offer is shown, so the tap can open the device's prompt at once (the browser wants it inside
 * the tap). `offered`: the PC checks the device, this device has no credential yet and can verify its user.
 */
export function useEnroll(store: MobileStore) {
  const state = useMobile(store);
  const platform = usePlatform();
  const offered = state.device?.confirm === false && platform;
  const [challenge, setChallenge] = useState<ConfirmChallenge | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [asking, setAsking] = useState(false);
  const [opId, setOpId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const phase = opId ? state.ops[opId]?.phase : undefined;
  const registered = state.device?.confirm === true || phase === 'applied';
  const sending = phase === 'sending' || phase === 'uncertain';
  const refused = phase === 'rejected' || phase === 'failed';

  useEffect(() => {
    if (!offered || registered) return;
    let on = true;
    setChallenge(null);
    store.prepareConfirm({ purpose: 'register' }).then(c => { if (on) setChallenge(c); }, () => { if (on) setProblem('prepareFailed'); });
    return () => { on = false; };
  }, [store, offered, registered, attempt]);

  // The create call stays in the tap's own turn: nothing is awaited before it.
  const go = () => {
    if (!challenge || asking || sending) return;
    const ch = challenge;
    setAsking(true);
    setProblem(null);
    createCredential({ challenge: ch.challenge, rpId: ch.rpId }, { label: deviceLabel(globalThis.navigator?.userAgent ?? '') }).then(
      made => {
        setAsking(false);
        if (made === 'cancelled') { setProblem('cancelled'); return; }
        if (made === 'unsupported') { setProblem('unsupported'); return; }
        // The challenge is spent by this registration, whatever the PC says of it.
        setChallenge(null);
        const op = store.registerCredential(made);
        if (op === null) setProblem('failed'); else setOpId(op);
      },
      () => { setAsking(false); setProblem('failed'); }
    );
  };
  const retry = () => { setProblem(null); setOpId(null); setAttempt(a => a + 1); };
  const shown: Problem | null = problem ?? (refused ? 'failed' : null);
  return { offered, registered, challenge, asking: asking || sending, problem: shown, go, retry };
}

type Enroll = ReturnType<typeof useEnroll>;

/** The offer's button, or « Réessayer » when a new challenge is needed, and what went wrong. */
function Action({ e, className }: { e: Enroll; className: string }) {
  const renew = e.problem === 'failed' || e.problem === 'prepareFailed';
  const text = e.problem === 'cancelled' ? copy.confirm.cancelled : e.problem === 'unsupported' ? E.unsupported : e.problem === 'failed' ? copy.confirm.failed : e.problem === 'prepareFailed' ? copy.confirm.prepareFailed : null;
  return (
    <>
      {text && <Notice title={text} tone="warning" role="alert" />}
      {renew
        ? <button type="button" onClick={e.retry} className={className}>{copy.confirm.retry}</button>
        : e.problem === 'unsupported' ? null
        : <button type="button" disabled={!e.challenge || e.asking} onClick={e.go} className={className}>{e.challenge || e.asking ? E.go : copy.confirm.preparing}</button>}
    </>
  );
}

/** The row of Connection: « Accords à impact élevé », protected by this device or the way to protect them. Nothing from a PC that does not check the device. */
export function ProtectRow({ store }: { store: MobileStore }) {
  const e = useEnroll(store);
  if (e.registered) return <ProtectedRow>{E.done}</ProtectedRow>;
  if (!e.offered) return null;
  return (
    <ProtectedRow>
      <div className="flex flex-col items-end gap-2">
        <Action e={e} className="inline-flex min-h-10 items-center justify-center rounded-control border border-line px-3 text-[13px] font-medium disabled:opacity-45" />
      </div>
    </ProtectedRow>
  );
}

function ProtectedRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line px-4 py-3 last:border-b-0">
      <dt className="flex-none text-muted">{E.row}</dt>
      <dd className="min-w-0 text-right break-words">{children}</dd>
    </div>
  );
}

/**
 * The step after a pairing: « Protéger les accords » when the PC checks the device and this one can, then the way to
 * the inbox. Once shown it stays, until the protection is done or put off.
 */
export function ProtectStep({ store, onDone }: { store: MobileStore; onDone: () => void }) {
  const e = useEnroll(store);
  const [shown, setShown] = useState(false);
  useEffect(() => { if (e.offered) setShown(true); }, [e.offered]);
  const inbox = href({ name: 'inbox' });
  if (!shown) return <a href={inbox} onClick={onDone} className={PRIMARY}>{copy.compare.seePending}</a>;
  if (e.registered) {
    return (
      <>
        <Notice title={E.done} role="status" />
        <a href={inbox} onClick={onDone} className={PRIMARY}>{copy.compare.seePending}</a>
      </>
    );
  }
  return (
    <>
      <section aria-labelledby="protect-title" className="flex flex-col gap-3 rounded-control border border-line bg-surface p-4">
        <h2 id="protect-title" className="text-[17px] leading-[1.35] font-semibold">{E.title}</h2>
        <p className="text-[13px] leading-[1.6] text-muted">{E.body}</p>
        <Action e={e} className={PRIMARY} />
      </section>
      <a href={inbox} onClick={onDone} className={OUTLINE}>{E.later}</a>
    </>
  );
}
