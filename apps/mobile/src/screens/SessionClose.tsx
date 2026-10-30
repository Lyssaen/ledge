import type { Assertion, PhoneSession } from '@ledge/protocol';
import { useEffect, useRef, useState } from 'react';
import { copy } from '../copy';
import { getAssertion } from '../link/webauthn';
import { closeCuts, type EndError, type Ending } from '../model/sessionEnd';
import { href } from '../router';
import { useMobile, type ConfirmChallenge, type MobileStore } from '../state/store';
import { useBusy } from '../useBusy';
import { buttonClass } from '../ui/Button';
import { Sheet } from '../ui/Dialog';
import { Icon } from '../ui/icons';
import { Notice } from '../ui/Notice';
import { isApple } from './device';

const C = copy.sessionEnd;
const full = (variant?: 'primary') => buttonClass({ variant, block: true });

type Problem = 'cancelled' | 'expired' | 'failed' | 'prepareFailed';

/**
 * The device check of a close or a resume, as RiskConfirm makes it: the challenge is asked as soon as it can be, so the tap
 * that follows opens the device's prompt at once; a cancelled prompt sends nothing, and an expired or failed check offers a new one.
 */
function useDeviceCheck(store: MobileStore, purpose: 'close' | 'act', id: string, enabled: boolean, onConfirm: (a: Assertion) => string | null) {
  const [challenge, setChallenge] = useState<ConfirmChallenge | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [asking, setAsking] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    if (!enabled) return;
    let on = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setChallenge(null);
    store.prepareConfirm({ purpose, id }).then(
      c => {
        if (!on) return;
        setChallenge(c);
        // A challenge is good for a minute: after that the PC would only refuse it.
        timer = setTimeout(() => { if (on) { setChallenge(null); setProblem('expired'); } }, c.expiresInMs);
      },
      () => { if (on) setProblem('prepareFailed'); }
    );
    return () => { on = false; clearTimeout(timer); };
  }, [store, purpose, id, enabled, attempt]);

  const go = async () => {
    if (!enabled || asking || !challenge) return;
    if (!challenge.credentialId) { setChallenge(null); setProblem('failed'); return; }
    setAsking(true);
    setProblem(null);
    const signed = await getAssertion({ challenge: challenge.challenge, rpId: challenge.rpId, credentialId: challenge.credentialId }).catch(() => 'failed' as const);
    if (!mounted.current) return;
    setAsking(false);
    if (signed === 'cancelled') { setProblem('cancelled'); return; }
    if (signed === 'failed') { setChallenge(null); setProblem('failed'); return; }
    // The challenge is spent by this operation, whatever the PC says of it.
    setChallenge(null);
    if (onConfirm(signed) === null) setProblem('failed');
  };
  const retry = () => { setProblem(null); setAttempt(a => a + 1); };
  const needsNew = problem === 'expired' || problem === 'failed' || problem === 'prepareFailed';
  return { challenge, problem, asking, needsNew, go, retry };
}

/**
 * The confirmation of a session's close (2a–2e) or resume (5a): what happens to the agent, what the close cuts, then the
 * device's check from the same button. Offline it offers only to reconnect, without a passkey only the way to Connexion;
 * nothing is sent from either. It closes as soon as the operation is sent: the page follows it.
 */
export function EndSheet({ store, session, mode, onClose, onSent, onReconnect }: {
  store: MobileStore; session: PhoneSession; mode: 'close' | 'resume';
  onClose: () => void; onSent: () => void; onReconnect?: (() => void) | undefined;
}) {
  const { fresh, device } = useMobile(store);
  const [reconnecting, setReconnecting] = useBusy();
  const name = session.name;
  const closing = mode === 'close';
  const protectedDevice = !!device?.confirm;
  const check = useDeviceCheck(store, closing ? 'close' : 'act', session.id, fresh && protectedDevice, a => {
    const op = closing ? store.sessionClose(session.id, a) : store.sessionResume(session.id, a);
    if (op !== null) onSent();
    return op;
  });
  const cuts = closing ? closeCuts(session) : [];
  const label = check.asking ? copy.confirm.asking : check.challenge
    ? (closing ? (isApple() ? C.goCloseApple : C.goClose) : (isApple() ? C.goResumeApple : C.goResume))
    : copy.confirm.preparing;
  const cancel = <button type="button" onClick={onClose} className={full()}>{C.cancel}</button>;
  return (
    <Sheet labelledBy="end-title" onClose={onClose}>
      <h2 id="end-title" className="text-heading leading-[1.3] tracking-[-.5px]">{closing ? C.closeTitle(name) : C.resumeTitle(name)}</h2>
      {!fresh ? (
        <>
          <Notice title={C.offlineTitle} tone="warning" role="status"><p>{closing ? C.offlineClose(name) : C.offlineResume(name)}</p></Notice>
          {onReconnect && (
            <button type="button" disabled={reconnecting} onClick={() => { setReconnecting(true); onReconnect(); }} className={full('primary')}>
              {reconnecting ? copy.link.reconnecting : C.reconnect}
            </button>
          )}
          {cancel}
        </>
      ) : !protectedDevice ? (
        <>
          <Notice title={C.unprotectedTitle} tone="warning" role="status"><p>{closing ? C.unprotectedClose(name) : C.unprotectedResume(name)}</p></Notice>
          <a href={href({ name: 'connection' })} className={full('primary')}>{C.openConnection}</a>
          {cancel}
        </>
      ) : (
        <>
          <p className="text-body leading-[1.6] text-muted">{closing ? C.closeBody : C.resumeBody}</p>
          {cuts.length > 0 && (
            <Notice title={C.cutsTitle} tone="warning">
              <ul className="flex list-disc flex-col gap-1 pl-5">{cuts.map(c => <li key={c}>{c}</li>)}</ul>
            </Notice>
          )}
          {check.problem && <Notice title={copy.confirm[check.problem]} tone="warning" role="alert" />}
          <p className="text-small leading-[1.6] text-muted">{cuts.length > 0 ? `${C.force} ${C.check}` : C.check}</p>
          {check.needsNew
            ? <button type="button" onClick={check.retry} className={full('primary')}>{copy.confirm.retry}</button>
            : <button type="button" disabled={check.asking || !check.challenge} onClick={() => { void check.go(); }} className={full('primary')}>{label}</button>}
          {cancel}
        </>
      )}
    </Sheet>
  );
}

/** The state line of the footer, as Reply's: a spinner while something runs, the text says what. */
function StateLine({ tone, label }: { tone: 'attention' | 'info'; label: string }) {
  return (
    <div className={`flex items-center gap-1.5 text-meta ${tone === 'attention' ? 'text-attention' : 'text-info'}`}>
      <Icon name="spinner" className="size-3 animate-spin motion-reduce:animate-none" stroke={2} />
      {label}
    </div>
  );
}

/** What the PC said against a close or a resume: a retry reopens the sheet, a lost link offers to reconnect. */
export function EndErrorNotice({ error, fresh, onRetry, onReconnect }: { error: EndError; fresh: boolean; onRetry: () => void; onReconnect?: (() => void) | undefined }) {
  const [busy, setBusy] = useBusy();
  return (
    <Notice title={error.title} tone="warning" role="alert">
      <p>{error.body}</p>
      {error.retry && <button type="button" onClick={onRetry} className={buttonClass({ size: 'sm', className: 'mt-2' })}>{C.retry}</button>}
      {error.reconnect && !fresh && onReconnect && (
        <button type="button" disabled={busy} onClick={() => { setBusy(true); onReconnect(); }} className={buttonClass({ size: 'sm', className: 'mt-2' })}>
          {busy ? copy.link.reconnecting : C.reconnect}
        </button>
      )}
    </Notice>
  );
}

/**
 * The page's footer in place of the composer while the session closes (3a), once it ended (3b), and while it resumes (5b).
 * A status the screen reader announces; `focus` takes the focus to it, after the sheet that started it. A session started
 * outside Ledge (`readOnly`) ends with its title alone: Ledge can resume it from nowhere.
 */
export function EndFooter({ ending, name, canResume, resumeHeld = false, readOnly, fresh, focus, onResume, onReconnect }: {
  ending: Exclude<Ending, { kind: 'open' }>; name: string; canResume: boolean; readOnly: boolean; fresh: boolean; focus: boolean;
  /** A resume of unknown outcome goes again by itself once the link is back: a second one would be refused. */ resumeHeld?: boolean;
  onResume: () => void; onReconnect?: (() => void) | undefined;
}) {
  const box = useRef<HTMLElement>(null);
  useEffect(() => { if (focus) box.current?.focus({ preventScroll: true }); }, [focus]);
  return (
    <footer ref={box} tabIndex={-1} role="status" className="flex flex-none flex-col gap-2.5 border-t border-line bg-bg pt-3 pb-3 outline-none [@media(max-height:650px)]:pb-2">
      {ending.kind === 'closing' && (
        <>
          <StateLine tone="attention" label={C.closing(name)} />
          <p className="text-small text-muted">{C.closingHint}</p>
        </>
      )}
      {ending.kind === 'resuming' && <StateLine tone="info" label={C.resuming(name)} />}
      {ending.kind === 'ended' && (
        <>
          {ending.error && <EndErrorNotice error={ending.error} fresh={fresh} onRetry={onResume} onReconnect={onReconnect} />}
          <section aria-labelledby="ended-title" className="flex flex-col gap-2.5 rounded-card border border-line bg-surface p-4">
            <h2 id="ended-title" className="text-body font-semibold">{C.ended}</h2>
            {!readOnly && <p className="text-small leading-[1.6] text-muted">{canResume ? C.endedBody : C.endedOnPc}</p>}
            {ending.killed && <p className="text-small text-attention">{C.killed}</p>}
            {canResume && !readOnly && (
              <button type="button" aria-disabled={resumeHeld || undefined} onClick={() => { if (!resumeHeld) onResume(); }} className={buttonClass({ variant: 'primary', block: true, className: resumeHeld ? 'opacity-45' : '' })}>
                <Icon name="resume" />
                {C.resume(name)}
              </button>
            )}
          </section>
        </>
      )}
    </footer>
  );
}
