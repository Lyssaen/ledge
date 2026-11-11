import type { PrDetail, PullRequest } from '@ledge/protocol';
import { copy } from '../../copy';
import { mergeConditions, shortSha, inFoot } from '../../model/prs';
import type { ForgeRun, ForgeStore } from '../../state/forge';
import { isApple } from '../device';
import { clock } from '../Inbox';
import { Commands, HoldBar, Receipt, rigButtonClass } from '../rigs/kit';
import { condText, forgeWords } from './parts';

/*
 * An action on a request, while it runs and once it ended (m5-mr-pr.html, §4 and §5): « Fusion… · gh répond quand c'est fait », then
 * the receipt with the command run, or the refusal in its words (the branch moved, the forge refuses, the check, the PC).
 */

const C = copy.prs;
const R = copy.rigs;

/** What did not happen, before the reason (« Pas fusionnée »). */
const notDone = (run: ForgeRun): string => C.notDone[run.action.kind];

/** The code that ended the run: a refusal before it ran, or the error of its end. */
const codeOf = (run: ForgeRun): string | undefined =>
  run.phase === 'expired' ? 'assertion_expired' : run.phase === 'cancelled' ? 'cancelled' : run.phase === 'unsent' ? 'unsent' : run.reason ?? run.done?.error;

/** The band while a run goes, then its receipt. `pc`: the PC's name. */
export function ForgeRunNote({ run, pr, detail, forge, pc, onReload }: {
  run: ForgeRun; pr: PullRequest; detail: PrDetail | undefined; forge: ForgeStore; pc: string; onReload: () => void;
}) {
  const w = forgeWords(pr);
  const apple = isApple();
  const close = { onClose: () => forge.dismiss(run.id), closeLabel: C.close };
  if (run.phase === 'checking') return <HoldBar>{R.running.checking}</HoldBar>;
  if (run.phase === 'sending' || run.phase === 'received') {
    return <HoldBar>{run.action.kind === 'merge' ? `${C.merging} · ${C.answers(w.cli)}` : C.answers(w.cli)}</HoldBar>;
  }
  // The PC did not say it has it (Q76): it may have run; « Réessayer » sends the same operation, which the PC runs once.
  if (run.phase === 'uncertain') {
    return (
      <Receipt mark="ask" title={R.uncertain.title} sub={R.uncertain.body} {...close}>
        <button type="button" onClick={() => forge.resend(run.id)} className={rigButtonClass({ size: 'xs', className: 'mt-1.5' })}>{C.retry}</button>
      </Receipt>
    );
  }
  const code = codeOf(run);
  const d = run.done;
  if (run.phase === 'done' && d?.ok) {
    const at = clock(run.endedAt ? new Date(run.endedAt).toISOString() : null);
    if (run.action.kind === 'merge') {
      return <Receipt mark="ok" title={C.merged(pr.ref)} sub={C.mergedSub(at, pr.target)} {...close}>{d.command && <Commands commands={[d.command]} />}</Receipt>;
    }
    if (run.action.kind === 'rerun') return <Receipt mark="ok" title={C.rerunDone(pr.ref)} sub={C.rerunDoneSub(at)} {...close}>{d.command && <Commands commands={[d.command]} />}</Receipt>;
    return null;
  }
  const again = run.action.kind === 'merge' ? R.rejected.again(C.mergeAgain) : R.rejected.nothingSent;
  switch (code) {
    // The branch moved since it was read: its new head, from the list (§4).
    case 'stale': return (
      <Receipt mark="warn" title={C.stale(shortSha(pr.headSha))} sub={C.staleBody} {...close}>
        <button type="button" onClick={onReload} className={rigButtonClass({ size: 'xs', className: 'mt-1.5' })}>{C.reload}</button>
      </Receipt>
    );
    case 'not_offered': {
      if (run.action.kind === 'rerun') return <Receipt mark="warn" title={C.nothingToRerun} {...close} />;
      const first = detail ? mergeConditions(detail).find(c => !c.ok) : undefined;
      const why = first ? inFoot(condText(first, w.host), first) : d?.message ?? '';
      return <Receipt mark="bad" title={C.refused(w.host, why)} {...close} />;
    }
    case 'busy': return <Receipt mark="warn" title={C.rerunRefused(C.rerunBusy)} {...close} />;
    case 'confirm_required': return <Receipt mark="warn" title={R.rejected.confirm_required} {...close} />;
    case 'assertion_expired': return <Receipt mark="bad" title={R.because(notDone(run), R.rejected.assertion_expired(apple))} sub={again} {...close} />;
    case 'assertion_invalid': return <Receipt mark="bad" title={R.because(notDone(run), R.rejected.assertion_invalid(apple))} sub={again} {...close} />;
    case 'cancelled': return <Receipt mark="bad" title={R.because(notDone(run), R.rejected.cancelled)} sub={R.rejected.nothingSent} {...close} />;
    case 'unsent': return <Receipt mark="bad" title={R.because(notDone(run), R.rejected.unsent)} sub={R.rejected.nothingSent} {...close} />;
    case 'unavailable': return <Receipt mark="warn" title={C.gone(w.kind, pc)} sub={C.goneBody} {...close} />;
    default: return (
      <Receipt mark="bad" title={C.failed(w.cli)} {...(d?.message ? { sub: <span className="font-mono">{d.message}</span> } : {})} {...close}>
        {d?.command && <Commands commands={[d.command]} />}
      </Receipt>
    );
  }
}
