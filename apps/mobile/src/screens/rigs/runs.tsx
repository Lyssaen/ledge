import { copy } from '../../copy';
import type { Run, RigsStore } from '../../state/rigs';
import { isApple } from '../device';
import { clock } from '../Inbox';
import { Commands, HoldBar, Receipt } from './kit';

/*
 * An OpenRig action from the phone, while it runs and once it ended (m4-rigs.html, §4 and §6): the band « Arrêt de ledge-dev… · le
 * rig répond quand c'est fait », then the receipt with the commands run, a refusal or a failure in its words.
 */

const C = copy.rigs;

type ActKind = Extract<Run['subject'], { kind: 'act' }>['action']['kind'];

/** What an act names in its words: the rig, the seat (`dev-front`), nothing for the daemon and the kernel. */
function argOf(run: Run): string {
  const s = run.subject;
  if (s.kind === 'seats') return s.rig;
  if (s.kind !== 'act') return '';
  const a = s.action as { rig?: string; seat?: string };
  return a.rig ?? a.seat?.split('@')[0] ?? '';
}

const kindOf = (run: Run): ActKind | 'seats' | null => (run.subject.kind === 'act' ? run.subject.action.kind : run.subject.kind === 'seats' ? 'seats' : null);

/** The run's verb when it did not happen (« Pas arrêté »). */
function notDone(run: Run): string {
  const k = kindOf(run);
  return k ? C.notDone[k] : C.rejected.nothingSent;
}

/** The verb that sends a checked run again (« Arrête de nouveau pour vérifier encore »); null when the run asks no check. */
function againVerb(run: Run): string | null {
  const k = kindOf(run);
  const V = C.rejected.againVerb;
  if (k === 'seats') return V.remove;
  if (k === 'rig.stop' || k === 'daemon.stop' || k === 'kernel.stop') return V.stop;
  if (k === 'rig.restart' || k === 'daemon.restart' || k === 'kernel.restart') return V.restart;
  if (k === 'rig.policy' || k === 'rig.permissions') return V.apply;
  if (k === 'seat.set') return V.save;
  return null;
}

/** Why a run was refused before it ran, or did not leave (m4-complement.html, §3): « <verbe> : <cause>. », then what happened. */
function refusal(run: Run, pc: string): { mark: 'bad' | 'warn'; title: string; sub?: string } {
  const apple = isApple();
  const r = run.phase === 'expired' ? 'assertion_expired' : run.phase === 'cancelled' ? 'cancelled' : run.phase === 'unsent' ? 'unsent' : run.reason ?? 'unavailable';
  const verb = againVerb(run);
  const again = verb ? C.rejected.again(verb) : C.rejected.nothingSent;
  switch (r) {
    case 'busy': return { mark: 'warn', title: C.busy.title(pc), sub: C.busy.body };
    case 'confirm_required':
      if (run.subject.kind === 'seats') return { mark: 'warn', title: apple ? C.reseat.wouldLeave.title : C.reseat.wouldLeave.titleDevice, sub: C.reseat.wouldLeave.body };
      return { mark: 'warn', title: C.rejected.confirm_required };
    case 'assertion_expired': return { mark: 'bad', title: C.because(notDone(run), C.rejected.assertion_expired(apple)), sub: again };
    case 'assertion_invalid': return { mark: 'bad', title: C.because(notDone(run), C.rejected.assertion_invalid(apple)), sub: again };
    case 'cancelled': return { mark: 'bad', title: C.because(notDone(run), C.rejected.cancelled), sub: C.rejected.nothingSent };
    case 'unsent': return { mark: 'bad', title: C.because(notDone(run), C.rejected.unsent), sub: C.rejected.nothingSent };
    // M0's words: the PC does not send its rigs to this device (yet).
    default: return { mark: 'bad', title: C.because(notDone(run), `${C.notSent(pc)}.`) };
  }
}

/** The band while a run goes, then its receipt. `pc`: the PC's name. */
export function RunNote({ run, rigs, pc, bar = false }: { run: Run; rigs: RigsStore; pc: string; bar?: boolean }) {
  const k = kindOf(run);
  const arg = argOf(run);
  const close = { onClose: () => rigs.dismiss(run.id), closeLabel: C.done.close };
  if (run.phase === 'checking') return <HoldBar bar={bar}>{C.running.checking}</HoldBar>;
  if (run.phase === 'sending' || run.phase === 'received') {
    const what = k === 'seats' ? C.running.seats(arg) : k ? C.running[k](arg) : '';
    return <HoldBar bar={bar}>{`${what} · ${C.running.note}`}</HoldBar>;
  }
  // Q76: the PC did not say it has it; a late answer turns this receipt into the real one.
  if (run.phase === 'uncertain') return <Receipt mark="ask" title={C.uncertain.title} sub={C.uncertain.body} {...close} />;
  if (run.phase !== 'done') { const r = refusal(run, pc); return <Receipt mark={r.mark} title={r.title} {...(r.sub ? { sub: r.sub } : {})} {...close} />; }
  const at = clock(run.endedAt ? new Date(run.endedAt).toISOString() : null);
  if (run.reseated) {
    const d = run.reseated;
    if (d.ok) {
      const text = d.added.length ? C.reseat.added(d.added.length, d.links) : C.reseat.removed(d.removed.length);
      return (
        <Receipt mark="ok" title={text} {...close}>
          {d.linksUnsupported && <small className="block text-[12px] text-attention">{C.reseat.noLinks.title} {C.reseat.noLinks.body}</small>}
          <Commands commands={d.commands} />
        </Receipt>
      );
    }
    if (d.error === 'busy') return <Receipt mark="warn" title={C.busy.title(pc)} sub={C.busy.body} {...close} />;
    if (d.error === 'rig_not_running') return <Receipt mark="bad" title={C.reseat.notRunning.title} sub={C.reseat.notRunning.body} {...close} />;
    return <Receipt mark="bad" title={C.failed(d.message ?? C.errors[d.error ?? 'failed'] ?? C.errors.failed!)} {...close}><Commands commands={d.commands} /></Receipt>;
  }
  const d = run.done;
  if (!d || !k || k === 'seats') return null;
  if (d.ok) {
    const snapFirst = run.subject.kind === 'act' && run.subject.action.kind === 'rig.stop' && run.subject.action.snapshot;
    return <Receipt mark="ok" title={C.done[k](arg)} sub={[at, snapFirst ? C.done.snapshotFirst : ''].filter(Boolean).join(' · ')} {...close}><Commands commands={d.commands} /></Receipt>;
  }
  if (d.error === 'busy') return <Receipt mark="warn" title={C.busy.title(pc)} sub={C.busy.body} {...close} />;
  const all = run.subject.kind === 'act' && 'seats' in run.subject.action ? run.subject.action.seats.length : 0;
  if (d.completed !== undefined && all) return <Receipt mark="bad" title={C.completed(d.completed, all)} {...(d.message ? { sub: <span className="font-mono">{d.message}</span> } : {})} {...close} />;
  const known = d.error && d.error !== 'failed' ? C.errors[d.error] : undefined;
  return (
    <Receipt mark="bad" title={known ?? C.failed(C.errors.failed!)} {...(d.message ? { sub: <span className="font-mono">{d.message}</span> } : {})} {...close}>
      <Commands commands={d.commands} />
    </Receipt>
  );
}

/** The last run a screen shows: of the given subjects, the newest. */
export function lastRun(runs: readonly Run[], match: (r: Run) => boolean): Run | undefined {
  for (let i = runs.length - 1; i >= 0; i--) if (match(runs[i]!)) return runs[i];
  return undefined;
}

/** A run that has not ended: this rig's buttons wait (one OpenRig action at a time). */
export const isRunning = (r: Run | undefined): boolean => !!r && (r.phase === 'checking' || r.phase === 'sending' || r.phase === 'received');
