import { useEffect, useState, type JSX, type ReactNode } from 'react';
import type { ChatAction as PointSuggestion, ChatPoint, PhoneChatTurn, PointAnswer, PointItem } from '@ledge/protocol';
import { newestPointRead } from '@ledge/ui/chat/point';
import { copy, locale } from '../../copy';
import { useChat, useMobile, type MobileStore } from '../../state/store';
import type { ChatAction } from '../../state/chat';
import { kitButtonClass } from '../kit/Controls';

// The point Ledge writes on its own, on the phone (docs/mockups/ledge-operator.html, board 7): the compact form of the Desktop's
// point (packages/ui/src/chat/PointTurn.tsx), its rows answered in place.

export interface PointTurnProps {
  turn: PhoneChatTurn & { point: ChatPoint };
  onAnswer: (item: string, a: PointAnswer) => void;
  onSuggestion: (item: string) => void;
  /** The row whose answer or suggestion is on its way: every button waits. */
  busy?: string | null;
  /** What became of this phone's last answer, when it did not go through: said under its row. */
  note?: { item: string; text: string } | null;
  /** The PC is out of reach, or the conversation is a past one: nothing can be sent. */
  disabled?: boolean;
}

const GROUPS = ['atoi', 'done', 'ongoing', 'rigs'] as const;
const TONE: Record<PointItem['tone'], string> = { perm: 'bg-approval', ask: 'bg-attention', work: 'bg-info', idle: 'bg-ok', off: 'bg-muted/70' };
const ROW = 'grid grid-cols-[12px_minmax(0,1fr)] gap-x-2 gap-y-0.5 border-t border-dashed border-line py-1.5 first:border-t-0';
const DANGER = 'border-approval/45 text-approval';
const plain = (s: string) => s.replace(/\*\*/g, '');
const clock = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** A suggestion's button: the point's own words for its action, else the generic card's verb, else « Appliquer ». */
function suggestionLabel(s: PointSuggestion): string {
  const vars = s.vars ?? {}, C = copy.chat.action;
  return copy.chat.operator.suggest[s.action]?.(vars) ?? C.verb(s.action, vars) ?? C.verbs[s.action] ?? C.apply;
}

function Dot({ tone, faded }: { tone: PointItem['tone']; faded?: boolean }) {
  return <span aria-hidden="true" className={`mt-[7px] size-2 rounded-full ${TONE[tone]} ${faded ? 'opacity-50' : ''}`} />;
}

/** The compact point: « Le point » and its time, then its rows; the tasks under way fold to one line. Settled, it folds to one line. */
export function PointTurn(p: PointTurnProps): JSX.Element {
  const O = copy.chat.operator;
  const point = p.turn.point;
  const frame = 'rounded-card border border-[color-mix(in_srgb,var(--sidebar-primary)_40%,var(--border))] bg-surface px-3 py-2.5 text-body';
  if (point.foldedAt) {
    const text = O.folded(clock(point.foldedAt));
    return <article data-point data-point-folded aria-label={text} className={`${frame} text-muted`}>{text}</article>;
  }
  return (
    <article data-point aria-label={`${O.title} · ${clock(p.turn.askedAt)}`} className={frame}>
      <div className="mb-1 flex items-center gap-1.5 text-small text-muted">
        <b className="font-semibold text-fg">{O.title}</b>
        <span className="flex-1" />
        <span className="font-mono">{clock(p.turn.askedAt)}</span>
      </div>
      <div>
      {GROUPS.map(g => {
        const rows = point.items.filter(i => i.group === g);
        if (!rows.length) return null;
        if (g === 'ongoing') return (
          <div key={g} data-point-group={g} className={ROW}><Dot tone="work" /><span className="min-w-0">{O.ongoing(rows.length)}</span></div>
        );
        return rows.map(i => <Row key={i.id} item={i} {...p} />);
      })}
      </div>
    </article>
  );
}

function Row(p: PointTurnProps & { item: PointItem }): JSX.Element {
  const O = copy.chat.operator, C = copy.chat.action;
  const { item } = p;
  const [answering, setAnswering] = useState(false);
  const [text, setText] = useState('');
  const off = !!p.disabled || (p.busy !== null && p.busy !== undefined);
  const busy = p.busy === item.id;
  const yours = item.group === 'atoi';
  const permission = item.ref?.kind === 'session.request' && item.tone === 'perm';
  const s = item.suggestion;
  const send = () => { const v = text.trim(); if (!v) return; p.onAnswer(item.id, { text: v }); setAnswering(false); setText(''); };

  const buttons = (): ReactNode => {
    if (item.settled) return null;
    const list: ReactNode[] = [];
    for (const x of item.answers ?? []) {
      list.push(
        <button key={`a-${x.id}`} type="button" disabled={off} onClick={() => p.onAnswer(item.id, { id: x.id })}
          className={kitButtonClass({ variant: x.style === 'primary' ? 'primary' : 'outline', size: 'xs', className: x.style === 'danger' ? DANGER : '' })}>{x.label}</button>
      );
    }
    if (item.freeText) list.push(<button key="reply" type="button" disabled={off} aria-expanded={answering} onClick={() => setAnswering(v => !v)} className={kitButtonClass({ variant: 'ghost', className: 'h-8 px-2.5' })}>{O.reply}</button>);
    if (s && s.state !== 'done') {
      const running = s.state === 'running' || busy;
      list.push(
        <button key="suggest" type="button" disabled={off || running} onClick={() => p.onSuggestion(item.id)}
          className={kitButtonClass({ size: 'xs', className: s.risk === 'destructive' ? DANGER : '' })}>{running ? C.running : suggestionLabel(s)}</button>
      );
    }
    return list.length ? <div data-point-acts className="col-start-2 mt-1 flex flex-wrap gap-1.5">{list}</div> : null;
  };

  return (
    <div data-point-item={item.id} data-settled={item.settled ? true : undefined} className={ROW}>
      <Dot tone={item.tone} faded={!!item.settled} />
      <div className={`min-w-0 [overflow-wrap:anywhere] ${item.settled ? 'text-muted' : ''}`}>
        <b className="font-semibold">{item.who}</b>
        {yours ? ' : ' : ' '}
        {permission ? <code className="font-mono text-[13px]">{item.text}</code> : plain(item.text)}
        {!yours && item.sub && <span className="text-muted"> · {item.sub}</span>}
        {item.settled && (
          <span data-point-receipt className="block text-small text-ok">
            ✓ {[item.settled.answer, O.settled[item.settled.where], clock(item.settled.at)].filter(Boolean).join(' · ')}
          </span>
        )}
        {!item.settled && s?.state === 'done' && <span data-point-receipt className="block text-small text-ok">✓ {suggestionLabel(s)} · {C.done(s.doneAt ? clock(s.doneAt) : '')}</span>}
        {!item.settled && item.error && <span role="alert" className="block text-small text-danger-fg">{O.error(item.error)}</span>}
        {!item.settled && p.note?.item === item.id && <span role="status" className="block text-small text-muted">{p.note.text}</span>}
      </div>
      {buttons()}
      {answering && !item.settled && (
        <div data-point-answer className="col-start-2 mt-1 flex gap-1.5">
          <input aria-label={O.answer.label} placeholder={O.answer.placeholder} value={text} disabled={off}
            onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
            className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-well px-2.5 text-[13px]" />
          <button type="button" onClick={() => { setAnswering(false); setText(''); }} className={kitButtonClass({ variant: 'ghost', className: 'h-8 px-2.5' })}>{O.answer.cancel}</button>
          <button type="button" disabled={off || !text.trim()} onClick={send} className={kitButtonClass({ variant: 'primary', size: 'xs' })}>{O.answer.send}</button>
        </div>
      )}
    </div>
  );
}

/** What the phone says of an answer that did not go through; null once it went. */
function noteOf(r: ChatAction): string | null {
  if (r.status === 'applied') return null;
  if (r.status === 'cancelled' || r.status === 'expired') return copy.confirm[r.status];
  if (r.status === 'rejected' && r.reason === 'confirm_required') return copy.chat.operator.setup;
  if (r.status === 'rejected' && r.reason === 'stale') return copy.chat.operator.stale;
  return copy.chat.operator.notSent;
}

/** The point wired to the store: an answer or a suggestion goes as `point.act`, through the device's check when it needs one. */
export function StorePoint({ store, turn, readOnly }: { store: MobileStore; turn: PhoneChatTurn & { point: ChatPoint }; readOnly: boolean }) {
  const fresh = useMobile(store).fresh;
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ item: string; text: string } | null>(null);
  const go = (item: string, a: PointAnswer | 'suggest') => {
    setBusy(item); setNote(null);
    const end = (r: ChatAction) => { setBusy(null); const text = noteOf(r); setNote(text ? { item, text } : null); };
    void store.pointAct(turn.qid, item, a).then(end, () => end({ status: 'failed' }));
  };
  return <PointTurn turn={turn} busy={busy} note={note} disabled={readOnly || !fresh} onAnswer={go} onSuggestion={item => go(item, 'suggest')} />;
}

/** Marks the newest point read (`operator.read`) while a screen that shows it is open: the Ledge tab, and « À toi ». */
export function useOperatorRead(store: MobileStore): void {
  const chat = useChat(store);
  const fresh = useMobile(store).fresh;
  const newest = newestPointRead(chat.turns as Parameters<typeof newestPointRead>[0]);
  const eventId = newest?.eventId;
  useEffect(() => { if (eventId !== undefined && fresh) store.operatorRead(eventId); }, [eventId, fresh, store]);
}
