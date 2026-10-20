import { useState } from 'react';
import { ResidentMascot } from '@ledge/ui/bots/ResidentMascot';
import { copy } from '../copy';
import type { PairingState } from '../link/pairing';
import { href } from '../router';
import { Notice } from '../ui/Notice';
import { Board, Fill, H1, ICON, OUTLINE, PRIMARY, Spinner } from '../ui/Board';

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
    <div className="flex h-8 items-center gap-2 self-center rounded-full border border-line pr-3 pl-1 text-[13px] text-muted">
      <span aria-hidden="true" className="inline-flex size-6 items-center justify-center rounded-full bg-raised text-[11px] font-semibold text-fg">{login.slice(0, 1).toUpperCase()}</span>
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
  onSame: () => void;
  /** Cancels the pairing (« Ils sont différents » and « Annuler »). */
  onCancel: () => void;
  onRestart: () => void;
  /** « Voir ce qui attend », once linked. */
  onDone: () => void;
}

/** Board Compare: the code of both keys, read on the PC and here, then confirmed on both. */
export function Compare({ step, login, pcName, lost, onSame, onCancel, onRestart, onDone }: CompareProps) {
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
          <ResidentMascot size={88} theme="dark" />
          <h1 className={H1}>{C.doneTitle(pcName ?? step.pc.name ?? copy.yourPc)}</h1>
          <p className="max-w-[300px] text-muted">{C.doneBody}</p>
        </div>
        <Fill />
        <a href={href({ name: 'inbox' })} onClick={onDone} className={PRIMARY}>{C.seePending}</a>
      </Board>
    );
  }

  if (step?.step === 'cancelled' && differ) {
    return (
      <Board>
        <Account login={login} />
        <section role="alert" className="rounded-control border border-danger-fg/15 bg-danger-bg p-4 text-danger-fg">
          <div className="mb-2 flex items-center gap-2.5">
            <svg className={ICON} viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
            <strong>{C.cancelledTitle}</strong>
          </div>
          <p className="text-[13px] leading-[1.6]">{C.cancelledBody}</p>
        </section>
        <Fill />
        {restartButton}
      </Board>
    );
  }

  const ended = step?.step === 'cancelled' ? [C.cancelledTitle, null]
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
          <div aria-label={C.codeLabel(`${a} ${b}`)} className="flex justify-center gap-3.5 font-mono text-[40px] leading-[48px] font-semibold tracking-[.06em]"><span>{a}</span><span>{b}</span></div>
          <span className="text-xs text-muted">{C.basis}</span>
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
      {step && <button type="button" onClick={onCancel} className={OUTLINE}>{C.cancel}</button>}
    </Board>
  );
}
