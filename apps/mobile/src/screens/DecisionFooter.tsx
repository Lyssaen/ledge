import { useEffect, useState, type ReactNode } from 'react';
import { copy } from '../copy';
import type { InboxItem } from '../model/requests';
import type { Outcome } from '../model/requestOutcome';
import { href } from '../router';
import { Notice } from '../ui/Notice';
import { RiskConfirm } from './RiskConfirm';

const btn = 'inline-flex min-h-12 flex-1 items-center justify-center rounded-control border border-line px-4 py-2.5 text-center text-[13px] leading-[1.4] font-medium disabled:opacity-45';
const full = 'inline-flex min-h-12 w-full items-center justify-center rounded-control border px-4 py-2.5 text-[13px] font-medium disabled:opacity-45';

export interface DecisionFooterProps {
  item: InboxItem;
  outcome: Outcome;
  /** The PC's state now: offline, nothing is sent. */
  fresh: boolean;
  /** The request took the place of the one decided: it must be read before deciding. */
  changed: boolean;
  /** This very request (same key) still waits on the PC: only then may a decision be offered. */
  stillPending: boolean;
  onReread: () => void;
  onDecide: (decision: 'accept' | 'deny') => void;
  /** A question: whether it can be answered from here, the option chosen (none yet) and how to send it. */
  answerable?: boolean;
  choice?: number | null;
  onAnswer?: (() => void) | undefined;
  /** The chosen answer cannot be sent yet (a free answer that is empty, too long or not typable). */
  answerBlocked?: boolean;
  /** Reconnect, so an operation of unknown outcome is sent again and the PC says where it ended up. */
  onCheck?: (() => void) | undefined;
}

function reasonText(item: InboxItem, r: Extract<Outcome, { kind: 'rejected' | 'failed' }>['reason']): string {
  const D = copy.decide;
  switch (r) {
    case 'invalid': case 'free_text': case 'untypable': return item.kind === 'question' ? D.otherInvalid : D.failed;
    case 'busy': return D.busy;
    case 'not_taken': return D.notTaken;
    case 'read_only': return D.readOnly;
    default: return D.failed;
  }
}

/**
 * The decision of a request, as the board's footer: [Refuser][Autoriser une fois], or « Envoyer ma réponse » for a
 * question, then the way to the agent's thread and what a tap does. A decision is one tap, sent now, never queued: this
 * footer never offers one it could not honour. A high-impact accept is done on the PC (`RiskConfirm`).
 */
export function DecisionFooter(p: DecisionFooterProps) {
  const { item, outcome, fresh, changed, stillPending, onReread, onDecide, answerable = false, choice = null, onAnswer, answerBlocked = false, onCheck } = p;
  const D = copy.decide;
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    if (!checking) return;
    const t = setTimeout(() => setChecking(false), 4000);
    return () => clearTimeout(t);
  }, [checking]);

  const thread = <a href={href({ name: 'thread', sessionId: item.sessionId })} className={`${full} border-transparent text-muted`}>{copy.result.thread(item.botName)}</a>;
  const wrap = (children: ReactNode, withThread = true) => (
    <footer className="flex flex-none flex-col gap-2.5 border-t border-line bg-bg px-side pt-3 pb-4">{children}{withThread && thread}</footer>
  );
  const hint = (t: string) => <p className="text-center text-[10px] text-muted">{t}</p>;

  if (item.kind === 'question' && !answerable) return wrap(hint(D.answerOnPc));

  const onPc = item.risk === 'high' || (outcome.kind === 'rejected' && outcome.reason === 'confirm_required');
  const live = fresh && !changed && stillPending;
  const buttons = (enabled: boolean) => answerable ? (
    <button type="button" disabled={!enabled || choice === null || answerBlocked} onClick={() => onAnswer?.()} className={`${full} border-transparent bg-fg text-[#121415]`}>{D.send}</button>
  ) : (
    <div className="flex gap-2.5">
      <button type="button" disabled={!enabled} onClick={() => onDecide('deny')} className={btn}>{D.deny}</button>
      {onPc
        ? <RiskConfirm />
        : <button type="button" disabled={!enabled} onClick={() => onDecide('accept')} className={`${btn} border-transparent bg-fg text-[#121415]`}>{D.allow}</button>}
    </div>
  );
  const linkHint = !fresh ? D.offlineHint : onPc && !answerable ? D.onPcHint : answerable ? D.answerHint : D.hint;
  const decide = (notice?: ReactNode) => wrap(<>{notice}{buttons(live)}{hint(linkHint)}</>);

  // A decision in flight or of unknown delivery always comes first: a newer request never hides it.
  if (changed && outcome.kind !== 'sending' && outcome.kind !== 'uncertain') {
    return wrap(<>
      <Notice title={D.changed} tone="warning" role="status" />
      {buttons(false)}
      <button type="button" onClick={onReread} className={`${full} border-line bg-surface`}>{D.reread}</button>
    </>);
  }

  switch (outcome.kind) {
    case 'sending':
      return wrap(<Notice title={D.sending} role="status"><p>{D.sendingBody}</p></Notice>);
    case 'uncertain':
      return wrap(<>
        <Notice title={D.uncertain} tone="warning" role="alert"><p>{D.uncertainBody}</p></Notice>
        {onCheck && <button type="button" disabled={checking} onClick={() => { setChecking(true); onCheck(); }} className={`${full} border-transparent bg-fg text-[#121415]`}>{checking ? D.checking : D.check}</button>}
      </>);
    case 'rejected': case 'failed': {
      const r = outcome.reason;
      if (r === 'confirm_required') return decide();
      if (r === 'no_prompt' || r === 'nothing_to_decide') return wrap(<Notice title={D.noPrompt} tone="warning" role="alert" />);
      if (r === 'stale') {
        return wrap(<>
          <Notice title={D.changed} tone="warning" role="alert" />
          <a href={href({ name: 'inbox' })} className={`${full} border-line bg-surface`}>{copy.result.back}</a>
        </>, false);
      }
      const notice = <Notice title={reasonText(item, r)} tone="warning" role="alert" />;
      return stillPending ? decide(notice) : wrap(notice);
    }
    default:
      return decide();
  }
}
