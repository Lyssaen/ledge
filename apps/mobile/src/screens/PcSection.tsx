import { useId, useState } from 'react';
import type { PcAction } from '@ledge/protocol';
import { copy } from '../copy';
import type { ChatAction } from '../state/chat';
import { olderThan, pcRunning, type PcRun } from '../state/pc';
import { useMobile, type MobileStore } from '../state/store';
import { Button } from '../ui/Button';
import { Sheet } from '../ui/Dialog';

const P = copy.connection.pcUpdate;
/** What a passkey-confirmed operation came to: a cancelled or expired passkey is a quiet note, a refusal says why when it has words for it. */
interface OutcomeNote { text: string; quiet: boolean }
function outcomeNote(r: ChatAction, fallback: string): OutcomeNote {
  switch (r.status) {
    case 'cancelled': return { text: copy.confirm.cancelled, quiet: true };
    case 'expired': return { text: copy.confirm.expired, quiet: true };
    case 'rejected':
      if (r.reason === 'assertion_expired') return { text: copy.confirm.expired, quiet: true };
      return { text: P.refusals[r.reason] ?? fallback, quiet: false };
    default: return { text: fallback, quiet: false };
  }
}

const CARD = 'flex flex-col gap-3 rounded-card border bg-surface p-3.5';

/** « Mettre à jour le PC ? » or « Redémarrer le daemon ? »: the versions, the passkey, then the confirmed operation. */
function ConfirmSheet({ store, action, pc, from, to, onClose }: { store: MobileStore; action: PcAction; pc: string; from: string; to: string; onClose: () => void }) {
  const id = useId();
  const canConfirm = !!useMobile(store).device?.confirm;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<OutcomeNote | null>(null);
  const go = () => {
    setBusy(true); setNote(null);
    void store.pcAction(action, action === 'update' ? to : undefined)
      .then(r => { if (r.status === 'applied') onClose(); else setNote(outcomeNote(r, P.notDone)); }, () => setNote({ text: P.notDone, quiet: false }))
      .finally(() => setBusy(false));
  };
  return (
    // While the passkey and the PC's answer are awaited, nothing closes the sheet: the outcome must land here.
    <Sheet labelledBy={`${id}-title`} onClose={() => { if (!busy) onClose(); }}>
      <h2 id={`${id}-title`} className="text-heading leading-[1.3] font-semibold tracking-[-.5px]">{action === 'update' ? P.confirmUpdate : P.confirmRestart}</h2>
      <p className="text-body text-muted">{action === 'update' ? P.confirmUpdateBody(pc, from, to) : P.confirmRestartBody(pc)}</p>
      <p className={`rounded-control border border-dashed border-input px-3 py-2 text-small ${canConfirm ? 'text-muted' : 'text-attention'}`}>{canConfirm ? P.passkey : P.noPasskey}</p>
      {note && <p role="status" className={`text-body ${note.quiet ? 'text-muted' : 'text-danger-fg'}`}>{note.text}</p>}
      <div className="flex gap-2">
        <Button variant="ghost" className="flex-1" disabled={busy} onClick={onClose}>{P.cancel}</Button>
        <Button variant="primary" className="flex-[2]" disabled={busy || !canConfirm} onClick={go}>{P.confirm}</Button>
      </div>
    </Sheet>
  );
}

/** The steps of a run, each done, running or to come; « Retour du lien » runs while the PC is away. */
function Steps({ run, fresh }: { run: PcRun; fresh: boolean }) {
  const order = run.action === 'update' ? (['asked', 'installing', 'restarting', 'back'] as const) : (['asked', 'restarting', 'back'] as const);
  const at = run.step === 'restarting' ? (fresh ? order.indexOf('restarting') : order.length - 1) : 1;
  return (
    <ol className="flex flex-col gap-1.5 text-small">
      {order.map((s, i) => (
        <li key={s} className={`flex items-center gap-2 ${i > at ? 'text-muted' : ''}`}>
          <span aria-hidden="true" className="w-4 text-center">{i < at ? '✓' : i === at ? '…' : '·'}</span>
          <span>{P.steps[s]}</span>
        </li>
      ))}
    </ol>
  );
}

/** A run under way, or the end of one: done (dismissed by « Fermer »), or refused with why and « Réessayer ». */
function RunCard({ store, run, fresh, from, onRetry }: { store: MobileStore; run: PcRun; fresh: boolean; from: string; onRetry: () => void }) {
  const update = run.action === 'update';
  if (pcRunning(run)) {
    return (
      <div className={`${CARD} border-line`} role="status">
        <div className="flex items-baseline justify-between gap-3"><strong className="text-body">{update ? P.updating(run.version) : P.restarting}</strong><span className="text-meta text-info">{P.running}</span></div>
        <Steps run={run} fresh={fresh} />
        <p className="text-small text-muted">{P.leave}</p>
      </div>
    );
  }
  if (run.step === 'done') {
    return (
      <div className={`${CARD} border-ok/40`} role="status">
        <div className="flex items-baseline justify-between gap-3"><strong className="text-body">{update ? P.done(run.version) : P.restarted}</strong><span className="text-meta text-ok">{P.upToDate}</span></div>
        <Button onClick={() => store.dismissPc()}>{P.close}</Button>
      </div>
    );
  }
  return (
    <div className={`${CARD} border-danger-fg/40`} role="alert">
      <div className="flex items-baseline justify-between gap-3"><strong className="text-body">{update ? P.failed : P.notRestarted}</strong><span className="text-meta text-danger-fg">{P.refused}</span></div>
      <p className="text-small text-muted">{P.unchanged(from)} {run.reason ? P.reasons[run.reason] : ''}</p>
      <Button onClick={onRetry}>{P.retry}</Button>
    </div>
  );
}

/**
 * « Le PC » of the Connexion screen: offered when the PC's daemon is older than this app (`appVersion`), or can restart.
 * The update asks for the app's own version; a PC that cannot install it says so, without a command (it holds the PC's paths).
 */
export function PcSection({ store, appVersion }: { store: MobileStore; appVersion: string | null }) {
  const state = useMobile(store);
  const [asking, setAsking] = useState<PcAction | null>(null);
  const daemon = state.daemon;
  const run = state.pc;
  if (!daemon) return null;
  const behind = appVersion !== null && olderThan(daemon.version, appVersion);
  if (!behind && !daemon.restart && !run) return null;
  const pc = daemon.name;
  // An update is asked again for this app's version; without one known, the card is only cleared.
  const retry = () => { store.dismissPc(); if (run?.action === 'restart' || appVersion) setAsking(run?.action ?? 'restart'); };
  return (
    <section aria-labelledby="pc-title" className="flex flex-col gap-2.5">
      <h2 id="pc-title" className="text-body text-muted">{P.title}</h2>
      {run ? <RunCard store={store} run={run} fresh={state.fresh} from={daemon.version} onRetry={retry} /> : behind && (daemon.update ? (
        <div className={`${CARD} border-input`}>
          <div className="flex flex-col"><strong className="text-body">{P.behind}</strong><span className="font-mono text-small text-muted">{P.versions(daemon.version, appVersion)}</span></div>
          <p className="text-small text-muted">{P.why}</p>
          <Button variant="primary" block disabled={!state.fresh} onClick={() => setAsking('update')}>{P.update}</Button>
          <p className="text-meta text-muted">{P.keepGoing}</p>
        </div>
      ) : (
        <div className={`${CARD} border-attention/40`}>
          <div className="flex flex-col"><strong className="text-body">{P.manual}</strong><span className="font-mono text-small text-muted">{P.versions(daemon.version, appVersion)}</span></div>
          <p className="text-small text-muted">{daemon.restart ? P.clone : P.byHand}</p>
        </div>
      ))}
      {daemon.restart && (
        <div className="flex items-center gap-3 rounded-control border border-line px-3.5 py-3">
          <span className="flex min-w-0 flex-1 flex-col"><span className="text-body">{P.restart}</span><span className="text-small text-muted">{P.restartHint}</span></span>
          <Button size="sm" disabled={!state.fresh || pcRunning(run)} onClick={() => setAsking('restart')}>{P.restartGo}</Button>
        </div>
      )}
      {asking && <ConfirmSheet store={store} action={asking} pc={pc} from={daemon.version} to={asking === 'update' && appVersion ? appVersion : daemon.version} onClose={() => setAsking(null)} />}
    </section>
  );
}
