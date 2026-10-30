import { Fragment, useId, useState, type ReactNode } from 'react';
import type { PhoneChatAction } from '@ledge/protocol';
import type { ActionRowView } from '@ledge/ui/chat/actionRow';
import { copy } from '../../copy';
import { actionChecked, allRows, cardState, phoneRowOf, type Shown } from '../../model/actionCard';
import { href } from '../../router';
import { isApple } from '../../screens/device';
import { OnPc } from '../../screens/RiskConfirm';
import type { ChatAction } from '../../state/chat';
import type { MobileStore } from '../../state/store';
import { buttonClass } from '../Button';
import { Sheet } from '../Dialog';
import { Icon } from '../icons';
import { CARD, GHOST, PRIMARY } from './RelayCard';

const C = copy.chat.action;
const DANGER = buttonClass({ size: 'sm', className: 'border-danger-fg/50 text-danger-fg' });
const DANGER_FILL = buttonClass({ block: true, className: 'border-transparent bg-[var(--destructive)] text-[var(--destructive-foreground)] active:opacity-75' });

/** `**name**` in a line, bold; the rest as text. */
function bold(text: string): ReactNode {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <strong key={i} className="font-semibold">{part}</strong> : <Fragment key={i}>{part}</Fragment>));
}
const plain = (s: string) => s.replace(/\*\*/g, '');
const clock = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '');
const lineOf = (r: ActionRowView) => (r.vars && r.action !== undefined ? C.line(r.action, r.vars) : undefined) ?? r.summary;
const deniedLine = (r: ActionRowView) => (r.vars && r.action === 'session.decide' ? C.line('session.decide', { ...r.vars, decision: 'deny' }) : undefined) ?? lineOf(r);
const whyOf = (r: ActionRowView) => C.why(r.code ?? (r.state === 'failed' ? 'failed' : undefined), r.action, r.vars ?? {});
const verbOf = (r: ActionRowView) => (r.action !== undefined ? C.verbs[r.action] : undefined) ?? C.apply;

function Risk({ r }: { r: ActionRowView }) {
  const destructive = r.risk === 'destructive';
  return (
    <span className={`inline-flex items-center gap-1 text-small ${destructive ? 'font-medium text-danger-fg' : 'text-muted'}`}>
      {destructive && <Icon name="warning" className="size-3.5" />}{C.risk[r.risk]}
    </span>
  );
}

/** The step's node on the rail: its number, a check once applied, a cross once failed or refused. */
function Node({ s, k, r, last }: { s: Shown; k: number; r: ActionRowView; last: boolean }) {
  const label = s === 'done' || s === 'failed' || s === 'refused' || s === 'running' ? C.stepState[s](k) : C.step(k);
  const look = s === 'done' ? 'border-ok bg-ok text-bg' : s === 'failed' ? 'border-transparent bg-[var(--destructive)] text-[var(--destructive-foreground)]'
    : r.risk === 'destructive' ? `border-danger-fg/60 text-danger-fg ${s === 'held' ? 'border-dashed' : ''}` : `border-input text-muted ${s === 'held' ? 'border-dashed' : ''}`;
  return (
    <div className="relative flex justify-center self-stretch">
      {!last && <span aria-hidden="true" className="absolute top-5 -bottom-3 left-1/2 w-px -translate-x-1/2 bg-muted/45" />}
      <span role="img" aria-label={label} className={`relative grid size-5 place-items-center rounded-full border-[1.5px] bg-surface font-mono text-[11px] ${look}`}>
        {s === 'done' ? <Icon name="check" className="size-3" /> : s === 'failed' || s === 'refused' ? <Icon name="close" className="size-3" /> : s === 'running' ? <Icon name="spinner" className="size-3 motion-safe:animate-spin" /> : k}
      </span>
    </div>
  );
}

/** A row's text: its line, its risk, its detail (whole in the sheet and once applied) and the request it answers. */
function RowText({ r, s, whole }: { r: ActionRowView; s: Shown; whole: boolean }) {
  return (
    <div className="min-w-0">
      <p className="break-words text-body">{bold(s === 'denied' ? deniedLine(r) : lineOf(r))}</p>
      {s !== 'denied' && <Risk r={r} />}
      {r.detail && <p className={`mt-1 break-words text-small text-muted ${whole || s === 'done' ? '' : 'line-clamp-2'}`}>{r.detail}</p>}
      {r.request && (
        <pre className={`mt-1.5 max-h-40 overflow-auto rounded-md border border-line border-l-2 border-l-muted bg-bg px-2.5 py-2 font-mono text-small whitespace-pre-wrap break-words ${s === 'stale' ? 'line-through opacity-60' : s === 'denied' ? 'opacity-60' : ''}`}>
          <span className="mb-0.5 block font-sans text-muted">{C.kind[r.request.kind] ?? r.request.kind}</span>{r.request.text}
          {s === 'cut' && <span className="mt-1 block border-t border-dashed border-line pt-1 font-sans text-muted">{C.cutMark}</span>}
        </pre>
      )}
    </div>
  );
}

/**
 * The generic card of a turn (#94): a row per action; past one, a plan whose steps sit on a numbered rail and apply in order
 * up to the first failure. A row the device must check, or that cannot be undone, is confirmed in a sheet first; the others
 * apply at the tap. « Ignorer » sets the turn's cards aside on every device.
 */
export function ActionCards({ store, qid, actions, ignoredAt, canConfirm }: { store: MobileStore; qid: string; actions: PhoneChatAction[]; ignoredAt?: string | undefined; canConfirm: boolean }) {
  const [asking, setAsking] = useState<number[] | null>(null);
  const [sending, setSending] = useState<ReadonlySet<number>>(new Set());
  const [note, setNote] = useState<{ rows: number[]; text: string } | null>(null);
  const title = useId();
  const rows = actions.map(phoneRowOf);
  const many = rows.length > 1;
  const { shown: drawn, stopAt } = cardState(rows);
  // A row sent from here reads « En cours… » until the PC says how it went.
  const shown: Shown[] = drawn.map((s, i) => (sending.has(i) && (s === 'proposed' || s === 'held' || s === 'failed') ? 'running' : s));
  const busy = sending.size > 0;
  const sheeted = (idx: readonly number[]) => idx.some(i => actionChecked(actions[i]!));

  const settle = (idx: number[], r: ChatAction) => {
    setSending(new Set());
    if (r.status === 'cancelled' || r.status === 'expired') setNote({ rows: idx, text: copy.confirm[r.status] });
    else if (r.status === 'rejected' && r.reason === 'confirm_required') setNote({ rows: idx, text: copy.chat.closeSetup });
    else if (r.status !== 'applied') setNote({ rows: idx, text: C.notSent });
  };
  const send = (idx: number[], o?: { deny?: true }) => {
    setAsking(null); setNote(null); setSending(new Set(idx));
    void store.act(qid, idx, o).then(r => settle(idx, r), () => settle(idx, { status: 'failed' }));
  };
  const ask = (idx: number[]) => (sheeted(idx) ? setAsking(idx) : send(idx));
  const ignore = (undo?: true) => { void store.ignoreTurn(qid, undo); };

  if (ignoredAt !== undefined) {
    const count = (s: Shown) => shown.filter(x => x === s).length;
    return (
      <p className="flex flex-wrap items-center gap-x-2 px-1 text-small text-muted">
        {C.ignored(rows.length, clock(ignoredAt), { done: count('done'), denied: count('denied'), failed: count('failed') })}
        <button type="button" className={GHOST} onClick={() => ignore(true)}>{C.review}</button>
      </p>
    );
  }

  const ignoreButton = <button type="button" className={GHOST} disabled={busy} onClick={() => ignore()}>{C.ignore}</button>;
  const side = (s: Shown, i: number, r: ActionRowView): ReactNode => {
    const destructive = r.risk === 'destructive';
    const accept = <button type="button" className={destructive ? DANGER : GHOST} disabled={busy || (sheeted([i]) && !canConfirm)} onClick={() => ask([i])}>{verbOf(r)}{sheeted([i]) ? '…' : ''}</button>;
    const deny = r.deny && <button type="button" className={GHOST} disabled={busy} onClick={() => send([i], { deny: true })}>{C.deny}</button>;
    const target = actions[i]!.session;
    switch (s) {
      case 'proposed': case 'held': return <>{!many && s === 'proposed' && ignoreButton}{deny}{accept}</>;
      case 'running': return <span className="text-body text-attention">{C.running}</span>;
      case 'done': return <span className="inline-flex items-center gap-1 text-body text-ok"><Icon name="check" className="size-3.5" />{C.done(clock(r.doneAt))}</span>;
      case 'failed': return <>{!many && ignoreButton}<button type="button" className={GHOST} disabled={busy || (sheeted([i]) && !canConfirm)} onClick={() => ask([i])}>{C.retry}</button></>;
      case 'refused': return <span className="text-body text-muted">{C.refusedState}</span>;
      case 'denied': return <span className="inline-flex items-center gap-1 text-body text-muted"><Icon name="check" className="size-3.5" />{C.denied(clock(r.doneAt))}</span>;
      case 'stale': return target ? <a className={GHOST} href={href({ name: 'thread', sessionId: target })}>{C.open(r.target ?? '')}</a> : null;
      case 'cut': return <>{!many && ignoreButton}{deny}<OnPc /></>;
    }
  };

  const row = (r: ActionRowView, i: number) => {
    const s = shown[i]!;
    return (
      <li key={i} className={`grid gap-x-2.5 gap-y-1 ${many ? 'grid-cols-[22px_minmax(0,1fr)]' : 'grid-cols-1'} ${i > 0 ? 'border-t border-line pt-2.5' : ''}`}>
        {many && <Node s={s} k={i + 1} r={r} last={i === rows.length - 1} />}
        <div className="min-w-0">
          <RowText r={r} s={s} whole={false} />
          {s === 'failed' && <p role="alert" className="mt-1 text-small text-danger-fg">{bold(C.failed(whyOf(r)))}</p>}
          {s === 'refused' && <p role="alert" className="mt-1 text-small text-danger-fg">{bold(C.refused(whyOf(r)))}</p>}
          {s === 'held' && <p className="mt-1 text-small text-muted">{C.held(stopAt + 1)}</p>}
          {s === 'stale' && <p className="mt-1 text-small text-attention">{C.stale}</p>}
          {s === 'cut' && <p className="mt-1 text-small text-muted">{C.cutNote}</p>}
          {s === 'denied' && <p className="mt-1 text-small text-muted">{C.deniedNote(r.target ?? '')}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2">{side(s, i, r)}</div>
        </div>
      </li>
    );
  };

  const foot = (): ReactNode => {
    if (!many) return null;
    if (shown.every(s => s === 'done')) {
      const last = rows.map(r => r.doneAt).filter((x): x is string => !!x).sort().at(-1);
      return <p className="inline-flex items-center gap-1.5 text-body text-ok"><Icon name="check" className="size-3.5" />{C.planDone(clock(last))}</p>;
    }
    const running = shown.indexOf('running');
    if (running >= 0) return <button type="button" className={buttonClass({ variant: 'primary', size: 'sm', block: true })} disabled>{C.progress(running + 1, rows.length)}</button>;
    const plan = allRows(rows);
    if (!plan.rows.length) return null;
    const label = plan.from === 'start' ? C.all(plan.rows.length) : plan.from === 'resume' ? C.resume(stopAt + 1, plan.rows.length) : C.skip(stopAt + 1, plan.rows.length);
    return (
      <>
        <div className="flex gap-2">
          {ignoreButton}
          <button type="button" className={`${PRIMARY} flex-1`} disabled={busy || (sheeted(plan.rows) && !canConfirm)} onClick={() => ask(plan.rows)}>{label}{sheeted(plan.rows) ? '…' : ''}</button>
        </div>
        <span className="text-small text-muted">{stopAt >= 0 ? C.notReplayed : C.inOrder}</span>
      </>
    );
  };

  const needsSetup = !canConfirm && cardState(rows).open.some(i => actionChecked(actions[i]!));
  const shownNote = note && note.rows.every(i => (rows[i]!.state ?? 'proposed') === 'proposed' || rows[i]!.state === 'failed') ? note.text : null;
  return (
    <section aria-label={C.label(rows.length)} aria-live="polite" className={CARD}>
      <ol className="flex flex-col gap-2.5">{rows.map(row)}</ol>
      {foot()}
      {shownNote && <p role="status" className="text-body text-muted">{shownNote}</p>}
      {needsSetup && <p className="text-body text-attention">{copy.chat.closeSetup} <a href={href({ name: 'connection' })} className="text-info underline underline-offset-2">{copy.connection.title}</a></p>}
      {asking && (
        <Sheet labelledBy={title} onClose={() => setAsking(null)}>
          <h2 id={title} className="text-heading leading-[1.3] tracking-[-.5px]">{asking.length > 1 ? C.sheet.many(asking.length) : C.sheet.one(plain(lineOf(rows[asking[0]!]!)))}</h2>
          <ol className="flex flex-col gap-2.5">
            {asking.map((i, k) => (
              <li key={i} className={`grid gap-x-2.5 ${many ? 'grid-cols-[22px_minmax(0,1fr)]' : 'grid-cols-1'}`}>
                {many && <Node s="proposed" k={i + 1} r={rows[i]!} last={k === asking.length - 1} />}
                <RowText r={rows[i]!} s="proposed" whole />
              </li>
            ))}
          </ol>
          <p className="text-small leading-[1.6] text-muted">{asking.length > 1 ? `${C.sheet.stops} ` : ''}{copy.confirm.note}</p>
          <button type="button" className={DANGER_FILL} onClick={() => send(asking)}>
            {isApple() ? copy.confirm.goApple : copy.confirm.go}
          </button>
          <button type="button" className={buttonClass({ block: true })} onClick={() => setAsking(null)}>{C.sheet.cancel}</button>
        </Sheet>
      )}
    </section>
  );
}
