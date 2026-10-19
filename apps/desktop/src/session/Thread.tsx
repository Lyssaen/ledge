import { Fragment, memo, useCallback, useMemo, useRef, useState, useSyncExternalStore, type JSX, type ReactNode } from 'react';
import { daemonStore, qualify, splitId } from '@ledge/fleet';
import type { Helper, HelperItem, ReceivedItem, SentItem, Session, ThreadItem } from '@ledge/protocol';
import { ThreadMarkdown } from '@ledge/ui/documents/markdown';
import type { DocumentReference } from '@ledge/ui/documents/references';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import type { NavAction } from '../nav/state';
import { helperState } from '../atelier/layout';
import { cls } from '../shell/cls';
import { SHELL_ICONS } from '../shell/icons';
import { HelperBot, SessionBot, StateBadge } from '../shell/SessionBot';
import { ActionGroup } from './ActionGroup';
import { MessageCard } from './MessageCard';
import { nameOf } from './changedFiles';
import { PlanCard } from './PlanCard';
import { docRefs, helperOf, peerKey, planTitle, timeMark, type Exchange, type Segment } from './exchanges';

const CHIP_MARK = { accept: '✓', always: '✓', deny: '✕', unknown: '·' } as const;
/** A decided plan (ExitPlanMode): approved, or sent back to planning. */
const PLAN_MARK = { accept: '✓', always: '✓', deny: '↺', unknown: '·' } as const;

export interface ThreadProps {
  session: Session; helper: Helper | null; items: readonly ThreadItem[]; xs: readonly Exchange[];
  /** The clock; offline, the instant the thread froze (its times stand still). */
  now: number;
  /** The first item new since the last visit, frozen for the life of the page; null: nothing new. */
  unread: string | null;
  /** « Session terminée · il y a 2 h », « Plus aucune nouvelle… · il y a 2 h » : `whenOf(…).text`. */
  since: string;
  dispatch(a: NavAction): void;
  /** The action reached from the Changes view (« tour 2 »), lit for a moment; null: none. */
  flash: string | null;
  /** « Voir la modification »: the file's change in the side pane. Stable (the page's callback). */
  onChange(path: string): void;
  /** A document link or card in a message: the document in the side pane. Stable (the page's callback). */
  onDocument(path: string): void;
  /** The plan whose tab is the pane's active one (« Ouvert à côté »); null: none. */
  planOpen: string | null;
  /** « Lire le plan »: the plan in the side pane. Stable (the page's callback). */
  onPlan(key: string): void;
}

/** What the agent said, and a card for each document it names (docRefs): parsed again only when its text changes, never on
 *  the page's clock. */
const Say = memo(function Say({ kind, text, onDocument }: { kind: 'message' | 'reply'; text: string; onDocument(path: string): void }): JSX.Element {
  const { t } = useI18n();
  const refs = useMemo(() => docRefs(text), [text]);
  const onLink = useCallback((ref: DocumentReference) => onDocument(ref.path), [onDocument]);
  return (
    <div className={`agent-message ${kind}`}>
      <div className="msg-body"><ThreadMarkdown text={text} onDocument={onLink} /></div>
      {refs.map(path => (
        <button key={path} type="button" className="document-card" onClick={() => onDocument(path)}>
          <Icon d={SHELL_ICONS.file} size={16} />
          <span><strong>{nameOf(path)}</strong><small className="mono">{path}</small></span>
          <span className="doc-open">{t.session.thread.read}<Icon d={ICONS.chevronRight.d} size={13} /></span>
        </button>
      ))}
    </div>
  );
});

interface TurnProps {
  session: Session; helper: Helper | null; items: readonly ThreadItem[]; x: Exchange;
  /** Its time mark, its live badge, and whether it is the last exchange (the frozen or ended note goes under it). */
  at: string; running: boolean; last: boolean;
  /** The clock, for the exchanges whose times count on (an action without a duration); the others get 0 and stay still. */
  now: number;
  unread: string | null; since: string; dispatch(a: NavAction): void;
  /** The flashed action when it is in this exchange, else null (the others are left alone). */
  flash: string | null; onChange(path: string): void; onDocument(path: string): void;
  /** The open plan when it is in this exchange, else null. */
  planOpen: string | null; onPlan(key: string): void;
  /** Messages between agents: the peers' sessions Ledge knows (by `peer`), each conversation's message ids in the thread's
   *  order (by peerKey), the folded conversations and the fold's toggle (stable). */
  peers: ReadonlyMap<string, Session>; convs: ReadonlyMap<string, readonly string[]>;
  folded: ReadonlySet<string>; onFold(key: string): void;
}

/** One exchange: its time, the prompt as a bubble, the agent named once, then what it said, decided and did. Rendered again
 *  only when what it shows changes: the clock's tick reaches the exchange whose action runs, not the ones before it. */
const Turn = memo(function Turn({ session, helper, items, x, at, running, last, now, unread, since, dispatch, flash, onChange, onDocument, planOpen, onPlan, peers, convs, folded, onFold }: TurnProps): JSX.Element {
  const { t } = useI18n();
  const th = t.session.thread;
  const tpl = t.session.plan;
  // Answered in the terminal, a plan's fate is not known: said as any other request's.
  const planDecided = { accept: tpl.approved, always: tpl.approvedAuto, deny: tpl.toRevise, unknown: th.decided.unknown };
  const offline = session.offline === true;
  const marker = (id: string): ReactNode => id === unread
    ? <div className="unread-marker" role="separator" aria-label={th.unread}><span>{th.unread}</span></div>
    : null;
  const author = helper
    ? <><HelperBot helper={helper} parent={session} size={20} /><strong>{helper.kind}</strong></>
    : <><SessionBot session={session} size={20} /><strong>{session.name}</strong></>;

  // A finished subagent leaves the parent thread: its card would only pile up « Done » there (a failed one stays).
  const ended = (item: HelperItem) => {
    const s = helperState(helperOf(session, items, item.id, t.session.subagent)!);
    return s === 'done' || s === 'idle';
  };
  const segments = x.segments.filter(s => s.kind !== 'helper' || !ended(s.item));

  const helperCard = (item: HelperItem) => {
    const h = helperOf(session, items, item.id, t.session.subagent)!;
    return (
      <button type="button" className="helper-card" data-helper={item.id} aria-label={th.openHelper(h.kind, item.task)} onClick={() => dispatch({ type: 'open', id: session.id, helper: item.id })}>
        <span className="helper-icon"><Icon d={SHELL_ICONS.subagents} size={12} />{th.helperLaunched}</span>
        <HelperBot helper={h} parent={session} size={26} />
        <span className="helper-copy"><strong>{h.kind}</strong><small>{item.task}</small></span>
        <StateBadge state={helperState(h)} offline={offline} />
        <Icon d={ICONS.chevronRight.d} size={14} />
      </button>
    );
  };

  const message = (item: SentItem | ReceivedItem): ReactNode => {
    const key = peerKey(item);
    const conv = convs.get(key) ?? [];
    const peer = item.peer !== undefined ? peers.get(item.peer) ?? null : null;
    const paired = item.kind === 'sent' ? item.received : item.sent;
    return <MessageCard item={item} self={session} peer={peer} header={conv[0] === item.id && conv.length > 1 ? { count: conv.length } : null}
      folded={folded.has(key)} lit={flash === item.id} onFold={() => onFold(key)}
      onOpenPeer={() => peer && dispatch({ type: 'open', id: peer.id, ...(paired !== undefined && { item: paired }) })} />;
  };
  // The marker opens the exchange above its time: on its prompt, else on the first message received that opens it.
  const opener = x.prompt?.id ?? x.received[0]?.id;

  const segment = (s: Segment): ReactNode => {
    if (s.kind === 'tools') {
      const first = s.tools.find(x => x.id === unread);
      const lit = flash !== null && s.tools.some(x => x.id === flash) ? flash : null;
      return <ActionGroup key={s.key} tools={s.tools} todos={s.todos} now={now} live={!offline} marker={first ? marker(first.id) : null} flash={lit} onChange={onChange} />;
    }
    const { item } = s;
    let node: ReactNode;
    if (s.kind === 'say') node = <Say kind={s.item.kind} text={s.item.text} onDocument={onDocument} />;
    else if (s.kind === 'decision') {
      const d = s.item.decision!;
      node = s.item.tool === 'ExitPlanMode'
        ? <div className={`decision-chip plan ${d}`}><span className="chip-mark">{PLAN_MARK[d]}</span><span>{planDecided[d]}</span><strong>{planTitle(s.item.text)}</strong></div>
        : <div className={`decision-chip ${d}`}><span className="chip-mark">{CHIP_MARK[d]}</span><span>{th.decided[d]}</span><code>{s.item.text}</code></div>;
    } else if (s.kind === 'plan') node = <PlanCard plan={s.plan} open={planOpen === s.plan.key} onOpen={onPlan} />;
    else if (s.kind === 'sent') node = message(s.item);
    else node = helperCard(s.item);
    return <Fragment key={item.id}>{marker(item.id)}{node}</Fragment>;
  };

  return (
    <section className={cls('turn open', last && 'current')} aria-label={th.exchange(at)}>
      {opener !== undefined && marker(opener)}
      <div className="turn-time" aria-hidden="true"><span className="mono">{at}</span>{running && <span className="turn-live"><i />{th.live}</span>}</div>
      {x.prompt && (
        <div className={cls('prompt-block', x.prompt.from === 'parent' && 'from-agent')}>
          <div className="prompt-author">{x.prompt.from === 'parent' ? <><SessionBot session={session} size={16} />{th.fromParent(session.name)}</> : th.you}</div>
          <p>{x.prompt.text}</p>
        </div>
      )}
      {x.received.map(r => <Fragment key={r.id}>{r.id !== opener && marker(r.id)}{message(r)}</Fragment>)}
      {segments.length > 0 && <div className="turn-author">{author}</div>}
      {segments.map(segment)}
      {last && offline && <div className="frozen-end"><Icon d={SHELL_ICONS.offline} size={13} />{th.frozenEnd(since)}</div>}
      {last && !offline && session.state === 'exited' && <div className="turn-end">{th.ended(since)}</div>}
    </section>
  );
});

/** An action whose time counts on with the clock (running, or cut without a duration): its exchange takes every tick. */
const ticks = (x: Exchange) => x.segments.some(s => s.kind === 'tools' && s.tools.some(tool => tool.durationMs === undefined));
const holds = (x: Exchange, id: string) => x.segments.some(s => s.kind === 'tools' && s.tools.some(tool => tool.id === id)) || messagesOf(x).some(m => m.id === id);
const holdsPlan = (x: Exchange, key: string) => x.segments.some(s => s.kind === 'plan' && s.plan.key === key);

const NONE: ReadonlySet<string> = new Set();

/** The messages between agents of an exchange, in the order shown: the received ones that open it, then the sent ones. */
const messagesOf = (x: Exchange): (SentItem | ReceivedItem)[] => [...x.received, ...x.segments.flatMap(s => (s.kind === 'sent' ? [s.item] : []))];

/** Each conversation's message ids in the thread's order, by peerKey: its first one carries the header. */
function conversations(xs: readonly Exchange[]): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, string[]>();
  for (const m of xs.flatMap(messagesOf)) {
    const ids = out.get(peerKey(m));
    if (ids) ids.push(m.id); else out.set(peerKey(m), [m.id]);
  }
  return out;
}

/** The sessions of the thread's peers that Ledge knows, by `peer` (a raw daemon id, on this session's machine). The same
 *  map while none of them changes, so the store's other changes leave the exchanges alone. */
function usePeers(session: Session, xs: readonly Exchange[]): ReadonlyMap<string, Session> {
  const ids = useMemo(() => [...new Set(xs.flatMap(messagesOf).flatMap(m => (m.peer !== undefined ? [m.peer] : [])))], [xs]);
  const machine = splitId(session.id)?.machine ?? 'local';
  const last = useRef<ReadonlyMap<string, Session>>(new Map());
  const select = useCallback(() => {
    const byId = daemonStore.getState().byId;
    const next = new Map<string, Session>();
    for (const p of ids) { const s = byId.get(qualify(machine, p)); if (s) next.set(p, s); }
    const prev = last.current;
    if (prev.size === next.size && [...next].every(([k, v]) => prev.get(k) === v)) return prev;
    return (last.current = next);
  }, [ids, machine]);
  return useSyncExternalStore(daemonStore.subscribe, select, select);
}

/** The flat thread (session.tsx renderTurn / renderItem): one section per exchange, the frozen or ended note after the last
 *  one. Memoised: the store's changes elsewhere (another session's preview, the chat, an error) leave it alone, its props
 *  being the session, its items and their exchanges, the clock and the page's stable callbacks. */
export const Thread = memo(function Thread({ session, helper, items, xs, now, unread, since, dispatch, flash, onChange, onDocument, planOpen, onPlan }: ThreadProps): JSX.Element {
  const { lang } = useI18n();
  const offline = session.offline === true;
  const convs = useMemo(() => conversations(xs), [xs]);
  const peers = usePeers(session, xs);
  // The folded conversations (peerKeys), this session's only: another session starts with all of them open.
  const [fold, setFold] = useState<{ id: string; keys: ReadonlySet<string> }>(() => ({ id: session.id, keys: new Set() }));
  const folded = fold.id === session.id ? fold.keys : NONE;
  const onFold = useCallback((key: string) => setFold(f => {
    const keys = new Set(f.id === session.id ? f.keys : []);
    if (!keys.delete(key)) keys.add(key);
    return { id: session.id, keys };
  }), [session.id]);
  return <>{xs.map((x, i) => (
    <Turn key={x.key} session={session} helper={helper} items={items} x={x} at={timeMark(x.at, now, lang)} last={i === xs.length - 1}
      running={!offline && x.segments.some(s => s.kind === 'tools' && s.tools.some(tool => tool.status === 'running'))}
      now={ticks(x) ? now : 0} unread={unread} since={since} dispatch={dispatch}
      flash={flash !== null && holds(x, flash) ? flash : null} onChange={onChange} onDocument={onDocument}
      planOpen={planOpen !== null && holdsPlan(x, planOpen) ? planOpen : null} onPlan={onPlan}
      peers={peers} convs={convs} folded={folded} onFold={onFold} />
  ))}</>;
});
