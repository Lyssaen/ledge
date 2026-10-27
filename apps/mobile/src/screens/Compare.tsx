import { useState, type ReactNode } from 'react';
import { copy } from '../copy';
import type { Reach } from '../link/link';
import type { PairingState } from '../link/pairing';
import { href } from '../router';
import { Notice } from '../ui/Notice';
import { Board, Fill, H1, OUTLINE, PRIMARY, Spinner } from '../ui/Board';
import { Icon } from '../ui/icons';
import { Mascot } from '../ui/MobileBot';

const C = copy.compare;

/** The six digits as the boards show them, « 482 107 », whatever spacing the pairing gave. */
const halves = (code: string): [string, string] => {
  const digits = code.replace(/\D/g, '');
  return [digits.slice(0, 3), digits.slice(3)];
};

/** A sentence of copy around one value set apart (bold, monospace): what comes before it and after it. */
const MARK = '\u0000';
const around = (sentence: string): [string, string] => {
  const [before = '', after = ''] = sentence.split(MARK);
  return [before, after];
};

function Account({ login }: { login: string | null }) {
  if (!login) return null;
  return (
    <div className="flex h-8 items-center gap-2 self-center rounded-full border border-line pr-3 pl-1 text-body text-muted">
      <span aria-hidden="true" className="inline-flex size-6 items-center justify-center rounded-full bg-raised text-meta font-semibold text-fg">{login.slice(0, 1).toUpperCase()}</span>
      {copy.account(login)}
    </div>
  );
}

export interface CompareProps {
  /** The pairing's state; null while the link has not started one yet. */
  step: PairingState | null;
  login: string | null;
  pcName: string | null;
  /** The keys were found lost at start: said until the phone is linked again. */
  lost: boolean;
  /** A pairing was asked and the link fell back to unpaired without one: only a new start gets out of it. */
  stalled?: boolean;
  /** Where the PC is: while its code is awaited, a PC away or a relay out of reach is said, not a bare spinner. */
  reach?: Reach;
  /** « Réessayer », with the PC away or the relay out of reach. */
  onRetry?: () => void;
  onSame: () => void;
  /** Cancels the pairing (« Ils sont différents » and « Annuler »). */
  onCancel: () => void;
  onRestart: () => void;
  /** « Voir ce qui attend », once linked. */
  onDone: () => void;
  /** What leads out of the « linked » step: the way to the inbox, with the offer to protect accepts when there is one. */
  actions?: ReactNode;
}

/** Board Compare: the code of both keys, read on the PC and here, then confirmed on both. */
export function Compare({ step, login, pcName, lost, stalled = false, reach = 'pc_online', onRetry, onSame, onCancel, onRestart, onDone, actions }: CompareProps) {
  // The user said the codes differ: the cancellation that follows is the board's warning, not a plain one.
  const [differ, setDiffer] = useState(false);
  const pc = pcName ?? copy.yourPc;
  const restart = () => { setDiffer(false); onRestart(); };
  const restartButton = <button type="button" onClick={restart} className={OUTLINE}>{C.retry}</button>;
  const lostNotice = lost && step?.step !== 'linked' ? <Notice title={C.lostTitle} role="status"><p>{C.lostBody}</p></Notice> : null;

  if (step?.step === 'linked') {
    return (
      <Board top="pt-40">
        <div className="flex flex-col items-center gap-3.5 text-center">
          <Mascot size={88} />
          <h1 className={H1}>{C.doneTitle(step.pc.name ?? pcName ?? copy.yourPc)}</h1>
          <p className="max-w-[300px] text-muted">{C.doneBody}</p>
        </div>
        <Fill />
        {actions ?? <a href={href({ name: 'inbox' })} onClick={onDone} className={PRIMARY}>{C.seePending}</a>}
      </Board>
    );
  }

  if (step?.step === 'cancelled' && differ) {
    return (
      <Board>
        <Account login={login} />
        <section role="alert" className="rounded-control border border-danger-fg/15 bg-danger-bg p-4 text-danger-fg">
          <div className="mb-2 flex items-center gap-2.5">
            <Icon name="warning" stroke={1.5} />
            <strong>{C.cancelledTitle}</strong>
          </div>
          <p className="text-body leading-[1.6]">{C.cancelledBody}</p>
        </section>
        <Fill />
        {restartButton}
      </Board>
    );
  }

  const ended = step?.step === 'cancelled' ? [C.cancelledTitle, null]
    : !step && stalled ? [C.stalledTitle, C.stalledBody]
    : step?.step === 'expired' ? [C.expiredTitle, C.expiredBody]
    : step?.step === 'refused' ? [C.refusedTitle, C.refusedBody]
    : null;
  if (ended) {
    return (
      <Board>
        <Account login={login} />
        <div className="flex flex-col gap-2 text-center">
          <h1 className={H1}>{ended[0]}</h1>
          {ended[1] && <p className="text-muted">{ended[1]}</p>}
        </div>
        {lostNotice}
        <Fill />
        {restartButton}
      </Board>
    );
  }

  if (step?.step === 'compare' && step.phoneConfirmed) {
    return (
      <Board top="pt-40">
        <Account login={login} />
        <div className="flex flex-col items-center gap-3.5 text-center">
          <Spinner />
          <h1 className={H1}>{C.waitTitle}</h1>
          <p className="max-w-[300px] text-muted">
            {around(C.waitBody(pc, MARK))[0]}<span className="font-mono text-fg">{halves(step.code).join(' ')}</span>{around(C.waitBody(pc, MARK))[1]}
          </p>
        </div>
        <Fill />
        <button type="button" onClick={onCancel} className={OUTLINE}>{C.cancel}</button>
      </Board>
    );
  }

  if (step?.step === 'compare') {
    const [a, b] = halves(step.code);
    const [before, after] = around(C.intro(MARK));
    return (
      <Board>
        <Account login={login} />
        <div className="flex flex-col gap-2 text-center">
          <h1 className={H1}>{C.title}</h1>
          <p className="text-muted">{before}<strong className="font-semibold text-fg">{pc}</strong>{after}</p>
        </div>
        <div className="flex flex-col items-center gap-3 rounded-control border border-line bg-surface px-4 py-6">
          <div aria-label={C.codeLabel(`${a} ${b}`)} className="flex justify-center gap-3.5 font-mono text-[2.5rem] leading-[48px] font-semibold tracking-[.06em]"><span>{a}</span><span>{b}</span></div>
          <span className="text-small text-muted">{C.basis}</span>
        </div>
        {lostNotice}
        <Fill />
        <div className="flex flex-col gap-3">
          <button type="button" onClick={onSame} className={PRIMARY}>{C.same}</button>
          <button type="button" onClick={() => { setDiffer(true); onCancel(); }} className={OUTLINE}>{C.different}</button>
        </div>
      </Board>
    );
  }

  const cancelButton = step && <button type="button" onClick={onCancel} className={OUTLINE}>{C.cancel}</button>;

  // No PC to send the code: said, with what to do. The pairing starts by itself once the PC is on the relay.
  const away = reach === 'pc_offline' ? [C.offlineTitle, C.offlineBody(pc)] : reach === 'relay_unreachable' ? [C.relayTitle, C.relayBody] : null;
  if (away) {
    return (
      <Board top="pt-40">
        <Account login={login} />
        <div role="status" className="flex flex-col gap-2 text-center">
          <h1 className={H1}>{away[0]}</h1>
          <p className="text-muted">{away[1]}</p>
        </div>
        {lostNotice}
        <Fill />
        <div className="flex flex-col gap-3">
          <button type="button" onClick={onRetry} className={PRIMARY}>{C.retryNow}</button>
          {cancelButton}
        </div>
      </Board>
    );
  }

  // No pairing yet, or its first frame on the way: the PC's code comes next.
  return (
    <Board top="pt-40">
      <Account login={login} />
      <div role="status" className="flex flex-col items-center gap-3.5 text-center text-muted">
        <Spinner />
        <p>{C.waitCode}</p>
      </div>
      {lostNotice}
      <Fill />
      {cancelButton}
    </Board>
  );
}
