import type { Assertion } from '@ledge/protocol';
import type { ReactNode } from 'react';
import { copy } from '../copy';
import type { InboxItem } from '../model/requests';
import type { Outcome } from '../model/requestOutcome';
import { href } from '../router';
import { useBusy } from '../useBusy';
import { Notice } from '../ui/Notice';
import type { MobileStore } from '../state/store';
import { usePlatform } from './device';
import { OnPc, RiskConfirm, type ConfirmReason } from './RiskConfirm';

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
  /** The phone could not send the last tap at all (link not ready, a request it cannot name): said, not swallowed. */
  refused?: boolean;
  /** The store, and whether the PC checks the device (`device.confirm`): a high-impact accept is then confirmed here. */
  store?: MobileStore | undefined;
  deviceConfirm?: boolean;
  /**
   * An OMP dialog answered with an option (the options are in the page): `canConfirm` is whether this phone can sign for the
   * PC (else the PC answers); `picked` the option tapped, awaiting the device's confirmation; `onReply` sends it with the assertion.
   */
  optionReply?: { canConfirm: boolean; picked: string | null; onBack: () => void; onReply: (assertion: Assertion) => string | null } | undefined;
  /** An OMP `ask` of several questions: how many have no choice yet, and what sending or declining does. */
  multi?: { missing: number; onSend: () => void; onCancel: () => void } | undefined;
}

function reasonText(item: InboxItem, r: Extract<Outcome, { kind: 'rejected' | 'failed' }>['reason']): string {
  const D = copy.decide;
  switch (r) {
    case 'invalid': return item.kind === 'question' ? D.otherInvalid : D.failed;
    // The dialog on the PC has no row for a free answer.
    case 'free_text': return D.otherUnsupported;
    case 'untypable': return item.kind === 'question' ? copy.question.untypable : D.failed;
    case 'busy': return D.busy;
    case 'not_taken': return D.notTaken;
    case 'read_only': return D.readOnly;
    default: return D.failed;
  }
}

/**
 * The decision of a request, as the board's footer: [Refuser][Autoriser une fois], or « Envoyer ma réponse » for a
 * question, then the way to the agent's thread and what a tap does. A decision is one tap, sent now, never queued: this
 * footer never offers one it could not honour. A high-impact accept is confirmed with the device when the PC checks it (`RiskConfirm`), else done on the PC.
 */
export function DecisionFooter(p: DecisionFooterProps) {
  const { item, outcome, fresh, changed, stillPending, onReread, onDecide, answerable = false, choice = null, onAnswer, answerBlocked = false, onCheck, refused = false, store, deviceConfirm = false, optionReply, multi } = p;
  const D = copy.decide;
  const [checking, setChecking] = useBusy();
  const platform = usePlatform();

  const thread = <a href={href({ name: 'thread', sessionId: item.sessionId })} className={`${full} border-transparent text-muted`}>{copy.result.thread(item.botName)}</a>;
  // The board's order: what to do, then the way to the thread, then what a tap does.
  const wrap = (children: ReactNode, hint?: string, withThread = true) => (
    <footer className="flex flex-none flex-col gap-2.5 border-t border-line bg-bg pt-3 pb-4">
      {children}
      {withThread && thread}
      {hint && <p className="text-center text-[10px] text-muted">{hint}</p>}
    </footer>
  );

  if (item.kind === 'question' && !answerable && !optionReply && !multi) return wrap(null, D.answerOnPc);

  const onPc = item.risk === 'high' || (outcome.kind === 'rejected' && outcome.reason === 'confirm_required');
  const live = fresh && !changed && stillPending;
  // The device signs the PC's challenge here; without a credential, a platform authenticator or a PC that asks, it is the PC.
  const guard = deviceConfirm && platform ? store : undefined;
  const confirmable = optionReply ? optionReply.canConfirm && guard !== undefined : onPc && !answerable && guard !== undefined;
  const deviceReason: ConfirmReason | undefined = outcome.kind === 'rejected' && (outcome.reason === 'assertion_expired' || outcome.reason === 'assertion_invalid' || outcome.reason === 'confirm_required') ? outcome.reason : undefined;
  const buttons = (enabled: boolean) => optionReply ? (
    // The options are in the page; this is the card of the one tapped, or where the PC takes over.
    !confirmable ? <OnPc /> : optionReply.picked !== null && guard ? (
      <RiskConfirm store={guard} item={item} enabled={enabled} reason={deviceReason} onConfirm={optionReply.onReply} onDeny={optionReply.onBack} denyLabel={copy.answers.change} />
    ) : null
  ) : multi ? (
    <div className="flex flex-col gap-2.5">
      {multi.missing > 0 && <p className="text-center text-xs text-muted">{copy.answers.missing(multi.missing)}</p>}
      <button type="button" disabled={!enabled || multi.missing > 0} onClick={multi.onSend} className={`${full} border-transparent bg-fg text-[#121415]`}>{copy.answers.send}</button>
      <button type="button" disabled={!enabled} onClick={multi.onCancel} className={`${full} border-line`}>{copy.answers.cancel}</button>
    </div>
  ) : confirmable && guard ? (
    <RiskConfirm store={guard} item={item} enabled={enabled} reason={deviceReason} onConfirm={a => guard.decide(item.sessionId, 'accept', { assertion: a })} onDeny={() => onDecide('deny')} />
  ) : answerable ? (
    <button type="button" disabled={!enabled || choice === null || answerBlocked} onClick={() => onAnswer?.()} className={`${full} border-transparent bg-fg text-[#121415]`}>{D.send}</button>
  ) : (
    <div className="flex gap-2.5">
      <button type="button" disabled={!enabled} onClick={() => onDecide('deny')} className={btn}>{D.deny}</button>
      {onPc
        ? <OnPc />
        : <button type="button" disabled={!enabled} onClick={() => onDecide('accept')} className={`${btn} border-transparent bg-fg text-[#121415]`}>{D.allow}</button>}
    </div>
  );
  const linkHint = !fresh ? D.offlineHint : optionReply ? (confirmable ? D.answerHint : D.onPcHint) : multi ? D.answerHint : onPc && !answerable && !confirmable ? D.onPcHint : answerable ? D.answerHint : D.hint;
  const decide = (notice?: ReactNode) => wrap(<>{notice}{buttons(live)}</>, linkHint);

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
      if (confirmable && deviceReason) return decide();
      if (r === 'confirm_required') return decide();
      if (r === 'no_prompt' || r === 'nothing_to_decide') return wrap(<Notice title={D.noPrompt} tone="warning" role="alert" />);
      if (r === 'stale') {
        return wrap(<>
          <Notice title={D.changed} tone="warning" role="alert" />
          <a href={href({ name: 'inbox' })} className={`${full} border-line bg-surface`}>{copy.result.back}</a>
        </>, undefined, false);
      }
      const notice = <Notice title={reasonText(item, r)} tone="warning" role="alert" />;
      return stillPending ? decide(notice) : wrap(notice);
    }
    default:
      return decide(refused ? <Notice title={D.failed} tone="warning" role="alert" /> : undefined);
  }
}
