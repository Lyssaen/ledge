import { Fragment, memo, useCallback, useMemo, useRef, useState, useSyncExternalStore, type JSX, type ReactNode } from 'react';
import { daemonStore, qualify, splitId } from '@ledge/fleet';
import type { Helper, HelperItem, NoticeItem, Pending, ReceivedItem, SentItem, Session, ThreadItem, ToolItem } from '@ledge/protocol';
import type { BotState } from '@ledge/ui/bots/poseFor';
import { ThreadMarkdown } from '@ledge/ui/documents/markdown';
import type { DocumentReference } from '@ledge/ui/documents/references';
import { liveTool, target } from '@ledge/ui/thread/tools';
import { helperThread } from '@ledge/ui/thread/turns';
import { Badge } from '@ledge/ui/ui/Badge';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import type { NavAction } from '../nav/state';
import { helperState } from '../atelier/layout';
import { cls } from '../shell/cls';
import { SHELL_ICONS } from '../shell/icons';
import { HelperBot, SessionBot, StateBadge } from '../shell/SessionBot';
import { UserAvatar } from '../shell/UserAvatar';
import { ActionGroup, KIND_ICON, Spin } from './ActionGroup';
import { firstLine, MessageCard } from './MessageCard';
import { NoticeLine } from './NoticeLine';
import { nameOf } from './changedFiles';
import { PlanCard } from './PlanCard';
import { WaitLine } from './WaitLine';
import { waitOf, type Wait } from './waiting';
import { clock, displayIds, docRefs, fmtDur, helperOf, kindOf, peerKey, planTitle, summarize, timeMark, verbOf, type Exchange, type Segment } from './exchanges';
import { marksOf, tagLabel, taskOf, type Marked, type SynapseTags, type TaskNotice } from './markers';

type Decision = 'accept' | 'always' | 'deny' | 'unknown';
/** A request's answer on the rail: its node's tone and icon, its badge's colour. */
const DECIDED: Record<Decision, { node: string; icon: readonly string[]; badge: BotState }> = {
  accept: { node: 'success', icon: ICONS.check.d, badge: 'idle' }, always: { node: 'success', icon: ICONS.check.d, badge: 'idle' },
  deny: { node: 'danger', icon: ICONS.close.d, badge: 'error' }, unknown: { node: '', icon: SHELL_ICONS.terminal, badge: 'done' }
};
/** A decided plan (ExitPlanMode): approved, or sent back to planning. */
const PLAN_DECIDED: Record<Decision, { node: string; icon: readonly string[] }> = {
  accept: { node: 'success', icon: SHELL_ICONS.plan }, always: { node: 'success', icon: SHELL_ICONS.plan },
  deny: { node: '', icon: SHELL_ICONS.restore }, unknown: { node: '', icon: SHELL_ICONS.plan }
};
/** A task notification's tone: its node, its icon, its badge's colour. */
const TASK: Record<TaskNotice['status'], { node: string; icon: readonly string[]; badge: BotState }> = {
  killed: { node: 'warning', icon: SHELL_ICONS.stop, badge: 'question' }, completed: { node: 'success', icon: ICONS.check.d, badge: 'idle' },
  failed: { node: 'danger', icon: ICONS.close.d, badge: 'error' }, other: { node: '', icon: SHELL_ICONS.mail, badge: 'done' }
};

/** The pinned request, as the thread's last row says it: what it is, and who asks. */
export interface Waiting { kind: Pending['kind']; asker: string }

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
  /** The conversation whose tab is the pane's active one (its peerKey: « Ouvert à côté »); null: none. */
  convOpen: string | null;
  /** « suivre la conversation »: the conversation with that peer (peerKey) beside the thread. Stable (the page's callback);
   *  absent: no way to it (a subagent's page). */
  onConversation?(peer: string): void;
  /** The pinned request of this thread (online only); null: none. */
  waiting?: Waiting | null;
}

/** What the agent said, and a card for each document it names (docRefs): parsed again only when its text changes, never on
 *  the page's clock. */
const Say = memo(function Say({ kind, text, onDocument }: { kind: 'message' | 'reply'; text: string; onDocument(path: string): void }): JSX.Element {
  const { t } = useI18n();
  const refs = useMemo(() => docRefs(text), [text]);
  const onLink = useCallback((ref: DocumentReference) => onDocument(ref.path), [onDocument]);
  return (
    <div className={`agent-message say ${kind}`}>
      <div className="msg-body"><ThreadMarkdown text={text} onDocument={onLink} /></div>
      {refs.map(path => (
        <button key={path} type="button" className="document-card doc" onClick={() => onDocument(path)}>
          <span className="doc-ico"><Icon d={SHELL_ICONS.file} size={16} /></span>
          <span className="doc-name"><strong>{nameOf(path)}</strong><small className="mono">{path}</small></span>
          <span className="doc-open"><Icon d={SHELL_ICONS.file} size={13} />{t.session.thread.read}</span>
        </button>
      ))}
    </div>
  );
});

/** The Story / Objectif a prompt carried (`[synapse-obs]`), as the mockup's tags. */
export function Tags({ tags }: { tags: SynapseTags }): JSX.Element {
  const { t } = useI18n();
  const th = t.session.thread;
  return (
    <span className="tags">
      {tags.story !== undefined && <span className="tag">{th.tags.story} <b>{tagLabel(tags.story, th.tagValues)}</b></span>}
      {tags.objectif !== undefined && <span className="tag">{th.tags.objectif} <b>{tagLabel(tags.objectif, th.tagValues)}</b></span>}
    </span>
  );
}

/** A `<task-notification>` that opened the exchange (a background agent or command that stopped or ended): « Tâche », its
 *  state, what it was about, its exit code and output file, and the notification as it came, folded. */
function TaskRow({ task, at }: { task: TaskNotice; at: string }): JSX.Element {
  const { t } = useI18n();
  const tk = t.session.thread.task;
  const tone = TASK[task.status];
  const { about } = task;
  const code = about?.kind === 'command' ? about.code : undefined;
  return (
    <li className="r task-row prompt-block">
      <span className={cls('n node', tone.node)} aria-hidden="true"><Icon d={tone.icon} size={12} /></span>
      <div className="card task-card">
        <div className="task-head"><span className="kicker mono">{tk.kicker}</span><Badge state={tone.badge} label={tk.statuses[task.status]} /></div>
        <p className="task-text">
          {about?.kind === 'agent' ? <>{tk.agent} <strong>{about.name}</strong> {tk.agentDid[task.status]}</>
            : about?.kind === 'command' ? <>{tk.command} <code>{about.command}</code> {tk.commandDid[task.status]}</>
            : task.summary}
        </p>
        {(code !== undefined || task.output !== undefined) && (
          <div className="task-meta mono">{[code !== undefined ? tk.code(code) : null, task.output ?? null].filter(Boolean).join(' · ')}</div>
        )}
        <details className="raw">
          <summary><Icon d={ICONS.chevronRight.d} size={12} />{tk.raw}</summary>
          <pre className="pre">{task.raw}</pre>
        </details>
      </div>
      <span className="tm">{at}</span>
    </li>
  );
}

/** An agent's text that noted another objective: « Objectif de la session  ~~Analyse~~ → Correction · noté par Mira ». */
function ObjectiveRow({ mark, by, at }: { mark: Marked; by: string; at: string }): JSX.Element {
  const { t } = useI18n();
  const th = t.session.thread;
  return (
    <li className="r objective-row">
      <span className="n node info" aria-hidden="true"><Icon d={SHELL_ICONS.arrowRight} size={12} /></span>
      <div className="objective">
        <span className="muted">{th.objective}</span>
        {mark.was && <><del className="tag was">{tagLabel(mark.was, th.tagValues)}</del><Icon d={SHELL_ICONS.arrowRight} size={12} /></>}
        <span className="tag now"><b>{tagLabel(mark.tags.objectif!, th.tagValues)}</b></span>
        <span className="muted noted">{th.notedBy(by)}</span>
      </div>
      <span className="tm">{at}</span>
    </li>
  );
}

/** Subagents launched one after the other: one card, a row each (its bot, name, state, task, what it did, its thread); two
 *  or more under « Sous-agents lancés · 1 terminé, 1 en cours ». A finished one stays, « Terminée ». */
function HelpersRow({ session, items, list, offline, dispatch }: {
  session: Session; items: readonly ThreadItem[]; list: readonly HelperItem[]; offline: boolean; dispatch(a: NavAction): void;
}): JSX.Element {
  const { t, lang } = useI18n();
  const th = t.session.thread;
  const rows = list.map(item => {
    const h = helperOf(session, items, item.id, t.session.subagent)!;
    const own = helperThread([...items], item.id).items.filter((i): i is ToolItem => i.kind === 'tool');
    const ms = own.reduce((n, x) => n + (x.durationMs ?? 0), 0);
    return { item, h, state: helperState(h), count: own.length, ms, run: offline ? undefined : liveTool(own) };
  });
  const tally = { done: 0, working: 0, error: 0 };
  for (const r of rows) tally[r.state === 'done' || r.state === 'idle' ? 'done' : r.state === 'error' ? 'error' : 'working']++;
  return (
    <li className="r helpers-row">
      <span className="n node info" aria-hidden="true"><Icon d={SHELL_ICONS.subagents} size={12} /></span>
      <div className={cls('card helpers-card', rows.length > 1 && 'many')}>
        {rows.length > 1 && (
          <div className="helpers-head">
            <span>{th.launched(rows.length)}</span>
            <span className="muted">· {(['done', 'working', 'error'] as const).filter(k => tally[k] > 0).map(k => th.tally[k](tally[k])).join(', ')}</span>
          </div>
        )}
        {rows.map(({ item, h, state, count, ms, run }) => (
          <div key={item.id} className="helper-card" data-helper={item.id}>
            <span className="helper-bot"><HelperBot helper={h} parent={session} size={20} /></span>
            <span className="helper-name"><strong>{h.kind}</strong><span className="muted">{th.subagent}</span></span>
            <StateBadge state={state} offline={offline} />
            <div className="helper-task">{item.task}</div>
            {run && (
              <div className="act helper-live">
                <Spin live /><span className="vb"><Icon d={KIND_ICON[kindOf(run.tool)]} size={13} />{th.verbs[verbOf(run)]}</span>
                <span className="tg" title={run.label}>{target(run) || run.tool}</span>
              </div>
            )}
            <div className="helper-foot">
              {count > 0 && <span className="mono muted">{th.actions(count)}{ms > 0 && ` · ${fmtDur(ms, lang)}`}</span>}
              <button type="button" className="lnk" onClick={() => dispatch({ type: 'open', id: session.id, helper: item.id })}>
                <Icon d={ICONS.chevronRight.d} size={12} />{th.openThread(h.kind)}
              </button>
            </div>
          </div>
        ))}
      </div>
      <span className="tm">{clock(list[0]!.at)}</span>
    </li>
  );
}

/** The latest instant an exchange shows. */
const lastAt = (x: Exchange): string => {
  const ats = [x.at, ...x.received.map(r => r.at), ...x.notices.map(n => n.at), ...x.segments.flatMap(s => (s.kind === 'tools' ? s.tools.map(tool => tool.at) : [s.item.at]))];
  return ats.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));
};

type Group = Exclude<Segment, { kind: 'helper' }> | { kind: 'helpers'; list: HelperItem[] };
/** Subagents launched one after the other share a card. */
const grouped = (segments: readonly Segment[]): Group[] => {
  const out: Group[] = [];
  for (const s of segments) {
    const last = out.at(-1);
    if (s.kind === 'helper' && last?.kind === 'helpers') last.list.push(s.item);
    else out.push(s.kind === 'helper' ? { kind: 'helpers', list: [s.item] } : s);
  }
  return out;
};

interface TurnProps {
  session: Session; helper: Helper | null; items: readonly ThreadItem[]; x: Exchange;
  /** Its time mark, and whether it is the last exchange (the waiting, frozen or ended row goes in it). */
  at: string; last: boolean;
  /** null: open, as it must be (the last one, what is new, what runs or waits, what the reader came back to); true:
   *  folded to its row; false: unfolded by the reader, its row kept to fold it again. */
  folded: boolean | null; onUnfold(key: string): void;
  /** The clock, for the exchanges whose times count on (an action without a duration); the others get 0 and stay still. */
  now: number;
  unread: string | null; since: string; dispatch(a: NavAction): void;
  /** The flashed action when it is in this exchange, else null (the others are left alone). */
  flash: string | null; onChange(path: string): void; onDocument(path: string): void;
  /** The open plan when it is in this exchange, else null. */
  planOpen: string | null; onPlan(key: string): void;
  /** The open conversation when this exchange holds its first message (its header), else null. */
  convOpen: string | null; onConversation?(peer: string): void;
  /** Messages between agents: the peers' sessions Ledge knows (by `peer`), each conversation's message ids in the thread's
   *  order (by peerKey), the folded conversations and the fold's toggle (stable). */
  peers: ReadonlyMap<string, Session>; convs: ReadonlyMap<string, readonly string[]>;
  folded2: ReadonlySet<string>; onFold(key: string): void;
  /** The thread's `[synapse-obs]` markers, by item id. */
  marks: ReadonlyMap<string, Marked>;
  waiting: Waiting | null;
  /** The last exchange's wait when the agent works with no action running (waitOf), else null. */
  wait: Wait | null;
}

/** One exchange on the rail: its prompt (or the task it was told of), then what the agent said, decided and did, a row each,
 *  and its end. A past one folds to one row. Rendered again only when what it shows changes: the clock's tick reaches the
 *  exchange whose action runs, not the ones before it. */
const Turn = memo(function Turn({ session, helper, items, x, at, last, folded, onUnfold, now, unread, since, dispatch, flash, onChange, onDocument, planOpen, onPlan, convOpen, onConversation, peers, convs, folded2, onFold, marks, waiting, wait }: TurnProps): JSX.Element {
  const { t } = useI18n();
  const th = t.session.thread;
  const offline = session.offline === true;
  const name = helper?.kind ?? session.name;
  const bot = (size: number) => helper ? <HelperBot helper={helper} parent={session} size={size} /> : <SessionBot session={session} size={size} />;
  const tools = x.segments.flatMap(s => (s.kind === 'tools' ? s.tools : []));
  const sum = summarize(tools, now, !offline);
  const task = x.prompt?.from === 'you' ? taskOf(x.prompt.text) : null;
  const promptText = x.prompt ? marks.get(x.prompt.id)?.text ?? x.prompt.text : '';

  const fold = folded !== null && (
    <li className="r r-fold turn-fold">
      <span className="n node" aria-hidden="true"><Icon d={folded ? ICONS.chevronRight.d : SHELL_ICONS.chevronDown} size={13} /></span>
      <button type="button" className="fold-row" aria-expanded={!folded} onClick={() => onUnfold(x.key)}>
        <span className="fold-text">
          <strong>{th.exchange(at)}</strong>
          {` · ${task ? task.summary : firstLine(promptText || x.received[0]?.text || '')}`}
          {sum.count > 0 && ` · ${th.actions(sum.count)}`}{sum.files > 0 && ` ${th.files(sum.files)}`}
        </span>
      </button>
      <span className="tm">{at}</span>
    </li>
  );
  if (folded) return <li className="turn folded" aria-label={th.exchange(at)}><ol className="turn-rows">{fold}</ol></li>;

  const marker = (id: string): ReactNode => id === unread
    ? <li className="r unread-marker" role="separator" aria-label={th.unread}><span className="n new-dot" /><span className="newsep">{th.unread}</span><span className="tm" /></li>
    : null;

  const message = (item: SentItem | ReceivedItem): ReactNode => {
    const key = peerKey(item);
    const conv = convs.get(key) ?? [];
    const peer = item.peer !== undefined ? peers.get(item.peer) ?? null : null;
    const paired = item.kind === 'sent' ? item.received : item.sent;
    return <MessageCard item={item} self={session} peer={peer} header={conv[0] === item.id && conv.length > 1 ? { count: conv.length } : null}
      folded={folded2.has(key)} lit={flash === item.id} onFold={() => onFold(key)} time={clock(item.at)}
      onOpenPeer={() => peer && dispatch({ type: 'open', id: peer.id, ...(paired !== undefined && { item: paired }) })}
      following={convOpen === key} onFollow={onConversation && (() => onConversation(key))} />;
  };
  const notice = (item: NoticeItem): ReactNode => {
    const peer = item.peer !== undefined ? peers.get(item.peer) ?? null : null;
    return (
      <li className="r notice-row">
        <span className="n node" aria-hidden="true"><Icon d={SHELL_ICONS.mail} size={12} /></span>
        <NoticeLine item={item} peer={peer} onOpenPeer={() => peer && dispatch({ type: 'open', id: peer.id })} />
        <span className="tm">{clock(item.at)}</span>
      </li>
    );
  };
  // The marker opens the exchange above its prompt, else above the first message received or notice that opens it.
  const opener = x.prompt?.id ?? x.received[0]?.id ?? x.notices[0]?.id;

  const decision = (item: Extract<Segment, { kind: 'decision' }>['item']): ReactNode => {
    const d = item.decision!;
    if (item.tool === 'ExitPlanMode') {
      const title = planTitle(item.text);
      const plan = x.segments.find((s): s is Extract<Segment, { kind: 'plan' }> => s.kind === 'plan' && s.plan.title === title);
      const tone = PLAN_DECIDED[d];
      return (
        <li className="r decision-row">
          <span className={cls('n node', tone.node)} aria-hidden="true"><Icon d={tone.icon} size={12} /></span>
          <div className={`decision-chip plan ${d}`}>
            <span>{th.planDecided[d]}</span><strong>{th.quote(title)}</strong>
            {plan && <button type="button" className="lnk" onClick={() => onPlan(plan.plan.key)}><Icon d={SHELL_ICONS.plan} size={12} />{t.session.plan.readPlan}</button>}
          </div>
          <span className="tm">{clock(item.at)}</span>
        </li>
      );
    }
    const tone = DECIDED[d];
    return (
      <li className="r decision-row">
        <span className={cls('n node', tone.node)} aria-hidden="true"><Icon d={tone.icon} size={12} /></span>
        <div className={`decision-chip ${d}`}><Badge state={tone.badge} label={item.byClose ? th.decided.denyByClose : th.decided[d]} /><code>{item.text}</code></div>
        <span className="tm">{clock(item.at)}</span>
      </li>
    );
  };

  const segment = (s: Group): ReactNode => {
    if (s.kind === 'tools') {
      const first = s.tools.find(x => x.id === unread);
      const lit = flash !== null && s.tools.some(x => x.id === flash) ? flash : null;
      return <ActionGroup key={s.key} tools={s.tools} todos={s.todos} now={now} live={!offline} marker={first ? marker(first.id) : null} flash={lit} onChange={onChange} />;
    }
    if (s.kind === 'helpers') return <Fragment key={s.list[0]!.id}>{s.list.map(h => marker(h.id))}<HelpersRow session={session} items={items} list={s.list} offline={offline} dispatch={dispatch} /></Fragment>;
    const { item } = s;
    let node: ReactNode;
    if (s.kind === 'say') {
      const mark = marks.get(item.id);
      const text = mark ? mark.text : s.item.text;
      node = <>
        {text !== '' && (
          <li className="r say-row">
            <span className="n botn">{bot(26)}<span className="visually-hidden">{name}</span></span>
            <Say kind={s.item.kind} text={text} onDocument={onDocument} />
            <span className="tm" />
          </li>
        )}
        {mark?.was !== undefined && <ObjectiveRow mark={mark} by={name} at={clock(item.at)} />}
      </>;
    } else if (s.kind === 'decision') node = decision(s.item);
    else if (s.kind === 'plan') node = (
      <li className="r plan-row">
        <span className={cls('n node', s.plan.status === 'proposed' && 'warning')} aria-hidden="true"><Icon d={SHELL_ICONS.plan} size={12} /></span>
        <PlanCard plan={s.plan} open={planOpen === s.plan.key} onOpen={onPlan} />
        <span className="tm">{clock(item.at)}</span>
      </li>
    );
    else node = message(s.item);
    return <Fragment key={item.id}>{marker(item.id)}{node}</Fragment>;
  };

  const runs = sum.running !== null || (!offline && last && (session.state === 'working' || session.state === 'starting'));
  const ended = tools.length > 0 && !runs && !(last && (offline || waiting !== null));
  const lastTool = tools.at(-1);
  const failedText = sum.failed > 0 && th.endFailed(sum.failed, false);
  return (
    <li className={cls('turn open', last && 'current')} aria-label={th.exchange(at)}>
      <ol className="turn-rows">
        {fold}
        {opener !== undefined && marker(opener)}
        {task ? <TaskRow task={task} at={at} /> : x.prompt && (
          <li className={cls('r prompt-row prompt-block', x.prompt.from === 'parent' && 'from-agent')}>
            {x.prompt.from === 'parent'
              ? <span className="n botn" aria-hidden="true"><SessionBot session={session} size={26} /></span>
              : <UserAvatar className="n av" size={15} />}
            <div className="prompt-col">
              <span className="who prompt-author">
                {x.prompt.from === 'parent' ? th.fromParent(session.name) : th.you}
                {marks.get(x.prompt.id) && <Tags tags={marks.get(x.prompt.id)!.tags} />}
              </span>
              <p className="prompt-text">{promptText}</p>
            </div>
            <span className="tm">{at}</span>
          </li>
        )}
        {x.received.map(r => <Fragment key={r.id}>{r.id !== opener && marker(r.id)}{message(r)}</Fragment>)}
        {x.notices.map(n => <Fragment key={n.id}>{n.id !== opener && marker(n.id)}{notice(n)}</Fragment>)}
        {grouped(x.segments).map(segment)}
        {wait && <WaitLine wait={wait} seedKey={x.key} now={now} />}
        {last && waiting && (
          <li className="r waiting-row">
            <span className="n node danger" aria-hidden="true"><Icon d={SHELL_ICONS.stop} size={10} /></span>
            <span className="waiting-text">{th.waits[waiting.kind](waiting.asker)} {th.resumes}</span>
            <span className="tm" />
          </li>
        )}
        {ended && (
          <li className="r end-row">
            <span className="n pip" aria-hidden="true" />
            <span className="end-text">
              {th.endOf} · {failedText && <><span className="end-failed">{failedText}</span>{lastTool?.status === 'success' && th.endFailed(sum.failed, true).slice(failedText.length)} · </>}
              {th.actions(sum.count)}{sum.files > 0 && ` ${th.files(sum.files)}`}
            </span>
            <span className="tm">{clock(lastAt(x))}</span>
          </li>
        )}
        {last && offline && (
          <li className="r frozen-end">
            <span className="n node" aria-hidden="true"><Icon d={SHELL_ICONS.offline} size={12} /></span>
            <span className="end-text">{th.frozenEnd(since)}</span>
            <span className="tm" />
          </li>
        )}
        {last && !offline && session.state === 'exited' && (
          <li className="r turn-end">
            <span className="n pip" aria-hidden="true" />
            <span className="end-text">{th.ended(clock(lastAt(x)), since)}</span>
            <span className="tm">{clock(lastAt(x))}</span>
          </li>
        )}
      </ol>
    </li>
  );
});

/** An action whose time counts on with the clock (running, or cut without a duration): its exchange takes every tick. */
const ticks = (x: Exchange) => x.segments.some(s => s.kind === 'tools' && s.tools.some(tool => tool.durationMs === undefined));
const holds = (x: Exchange, id: string) => x.segments.some(s => s.kind === 'tools' && s.tools.some(tool => tool.id === id)) || messagesOf(x).some(m => m.id === id);
const holdsPlan = (x: Exchange, key: string) => x.segments.some(s => s.kind === 'plan' && s.plan.key === key);
/** The wait at the end of the rail: the agent (or the subagent shown) works, online, asks nothing, and nothing in its last
 *  exchange says so already: no action runs, no subagent it launched still works (their card carries the state). */
function useWait(session: Session, helper: Helper | null, items: readonly ThreadItem[], xs: readonly Exchange[], asking: Waiting | null, unnamed: string): Wait | null {
  const x = xs[xs.length - 1];
  const working = session.offline !== true && asking === null && (helper ?? session).state === 'working';
  return useMemo(() => {
    if (!working || !x || x.segments.some(s => s.kind === 'tools' && s.tools.some(tool => tool.status === 'running'))) return null;
    const sub = (item: HelperItem) => helperOf(session, items, item.id, unnamed);
    if (x.segments.some(s => s.kind === 'helper' && sub(s.item)?.state === 'working')) return null;
    return waitOf(x, item => sub(item)?.kind ?? unnamed, item => {
      const end = sub(item)?.finishedAt;
      return end !== undefined ? Date.parse(end) : undefined;
    });
  }, [working, x, session, items, unnamed]);
}

/** What keeps a past exchange open: an action still running, a plan still waiting for its answer. */
const pending = (x: Exchange, live: boolean) => x.segments.some(s => (live && s.kind === 'tools' && s.tools.some(tool => tool.status === 'running')) || (s.kind === 'plan' && s.plan.status === 'proposed'));

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
  const ids = useMemo(() => [...new Set([...xs.flatMap(messagesOf), ...xs.flatMap(x => x.notices)].flatMap(m => (m.peer !== undefined ? [m.peer] : [])))], [xs]);
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

/** A set of keys kept for this session only: another session starts with none. */
function useKeys(id: string): [ReadonlySet<string>, (key: string) => void] {
  const [state, setState] = useState<{ id: string; keys: ReadonlySet<string> }>(() => ({ id, keys: new Set() }));
  const toggle = useCallback((key: string) => setState(f => {
    const keys = new Set(f.id === id ? f.keys : []);
    if (!keys.delete(key)) keys.add(key);
    return { id, keys };
  }), [id]);
  return [state.id === id ? state.keys : NONE, toggle];
}

/** The rail (the mockup's track B): one list of exchanges, each a list of rows `node · content · time` strung on one line.
 *  The past exchanges fold to a row, except the ones that hold what is new, what runs or waits, or what the reader came back
 *  to. Memoised: the store's changes elsewhere (another session's preview, the chat, an error) leave it alone, its props
 *  being the session, its items and their exchanges, the clock and the page's stable callbacks. */
export const Thread = memo(function Thread({ session, helper, items, xs, now, unread, since, dispatch, flash, onChange, onDocument, planOpen, onPlan, convOpen, onConversation, waiting = null }: ThreadProps): JSX.Element {
  const { t, lang } = useI18n();
  const offline = session.offline === true;
  const wait = useWait(session, helper, items, xs, waiting, t.session.subagent);
  const convs = useMemo(() => conversations(xs), [xs]);
  const peers = usePeers(session, xs);
  const marks = useMemo(() => marksOf(xs).byId, [xs]);
  // The folded conversations (peerKeys) and the past exchanges the reader unfolded (their keys).
  const [folded, onFold] = useKeys(session.id);
  const [unfolded, onUnfold] = useKeys(session.id);
  const fresh = useMemo(() => (unread === null ? -1 : xs.findIndex(x => displayIds([x]).includes(unread))), [xs, unread]);
  // The open conversation reaches only the exchange holding its header (its first message).
  const convHead = convOpen === null ? undefined : convs.get(convOpen)?.[0];
  return (
    <ol className="rail">
      {xs.map((x, i) => {
        const last = i === xs.length - 1;
        const lit = flash !== null && holds(x, flash);
        const open = last || (fresh >= 0 && i >= fresh) || lit || (planOpen !== null && holdsPlan(x, planOpen)) || pending(x, !offline);
        return (
          <Turn key={x.key} session={session} helper={helper} items={items} x={x} at={timeMark(x.at, now, lang)} last={last}
            folded={open ? null : !unfolded.has(x.key)} onUnfold={onUnfold}
            now={ticks(x) || (last && wait !== null) ? now : 0} unread={unread} since={since} dispatch={dispatch}
            flash={lit ? flash : null} onChange={onChange} onDocument={onDocument}
            planOpen={planOpen !== null && holdsPlan(x, planOpen) ? planOpen : null} onPlan={onPlan}
            convOpen={convHead !== undefined && messagesOf(x).some(m => m.id === convHead) ? convOpen : null} onConversation={onConversation}
            peers={peers} convs={convs} folded2={folded} onFold={onFold} marks={marks} waiting={last ? waiting : null} wait={last ? wait : null} />
        );
      })}
    </ol>
  );
});
