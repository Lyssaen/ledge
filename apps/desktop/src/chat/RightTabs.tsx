import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import { LEDGE_GIVER, openDecision, taskClosed, type ChatTurn, type Task } from '@ledge/protocol';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';
import type { HomeTab } from '../nav/state';
import type { TasksApi } from '../tasks/useTasksApi';
import { NoteDecision } from '../tasks/NoteDecision';
import { DecisionAnswer } from '../tasks/DecisionAnswer';
import '../styles/rtabs.css';

/** Where the local daemon stands for these lists, which only come from its state: before its first state, gone, or there. */
export type ListState = 'connecting' | 'offline' | 'ready';

/** The IDE's right panel as the app keeps it for the window's life (docs/mockups/ledge-ide-tasks-history.html): the tab, the task
 *  shown on « Tâches », and what a « Voir » or « Résumer la journée » asked from elsewhere. */
export interface RightTabs {
  tasks: TasksApi;
  tab: HomeTab;
  /** The task whose detail replaces the list, or null for the list. */
  task: string | null;
  /** Bumped by each « Voir » from elsewhere: the filters go back to All / Anyone, so the task is in the list on the way back. */
  seen: number;
  /** A question asked from elsewhere (« Résumer la journée »): sent once per `n`, on Conversation. */
  ask?: { text: string; n: number };
  onTab(tab: HomeTab, task?: string | null): void;
}

type StateFilter = 'all' | 'open' | 'closed';
type GiverFilter = 'all' | 'ledge' | 'sessions' | 'decisions';
/** Who a task comes from: Ledge, a session for another, or a session asking the user (a decision, owner Ledge). */
const giverOf = (x: Task): Exclude<GiverFilter, 'all'> => x.owner === LEDGE_GIVER ? 'decisions' : x.giver === LEDGE_GIVER ? 'ledge' : 'sessions';
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
/** A row's mark: a decision awaited from the user, then done, refused or dropped, else open. */
const markOf = (x: Task): ['asked' | 'done' | 'bad' | 'open', string] =>
  openDecision(x) ? ['asked', '?'] : x.state === 'done' ? ['done', '✓'] : x.state === 'refused' || x.state === 'dropped' ? ['bad', '!'] : ['open', '○'];

/** The tab strip under the chat's header: Conversation · Tâches (its open tasks counted) · Historique. */
export function RightTabStrip({ tab, open, onTab }: { tab: HomeTab; open: number; onTab(tab: HomeTab): void }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="rt-tabs" role="tablist" aria-label={t.home.tabsLabel}>
      <button type="button" role="tab" aria-selected={tab === 'conversation'} className={cls(tab === 'conversation' && 'on')} onClick={() => onTab('conversation')}>{t.home.tabs.conversation}</button>
      <button type="button" role="tab" aria-selected={tab === 'tasks'} aria-label={t.home.tabs.tasks(open)} className={cls(tab === 'tasks' && 'on')} onClick={() => onTab('tasks')}>{t.home.tasks.back}<span className="n">{open}</span></button>
      <button type="button" role="tab" aria-selected={tab === 'history'} className={cls(tab === 'history' && 'on')} onClick={() => onTab('history')}>{t.home.tabs.history}</button>
    </div>
  );
}

/** « Connexion… » before the local daemon's first state: in place of the list, no skeleton. */
function Connecting(): JSX.Element {
  const { t } = useI18n();
  return <div className="rt-empty" role="status"><span className="rt-spin" aria-hidden="true" />{t.home.tasks.connecting}</div>;
}
/** The local daemon is gone: the last list stays, dimmed, under this banner. */
function OfflineBanner(): JSX.Element {
  const { t } = useI18n();
  return <div className="rt-banner" role="status"><span className="rt-dot" aria-hidden="true" />{t.home.tasks.offline}</div>;
}

/** « Tâches » (old home's TasksTab at the panel's 300 px): two filters, the latest first; a click opens the task in place of the
 *  list, « ‹ Tâches » (and Escape, in ChatPanel) brings the list back at the same place with its filters. */
export function TasksPane({ api, task, seen, state, onShow }: { api: TasksApi; task: string | null; seen: number; state: ListState; onShow(id: string | null): void }): JSX.Element {
  const { t } = useI18n();
  const c = t.home.tasks;
  const [filter, setFilter] = useState<StateFilter>('all');
  const [giver, setGiver] = useState<GiverFilter>('all');
  const [answering, setAnswering] = useState<string | null>(null);
  // A « Voir » from elsewhere: the filters back to All / Anyone (the first render keeps the defaults anyway).
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } setFilter('all'); setGiver('all'); }, [seen]);
  // The list's scroll, kept while a detail replaces it, and given back on the way back.
  const listRef = useRef<HTMLDivElement>(null);
  const scroll = useRef(0);
  const detail = task ? api.tasks.find(x => x.id === task) : undefined;
  useLayoutEffect(() => { if (!detail && listRef.current) listRef.current.scrollTop = scroll.current; }, [detail]);
  useEffect(() => { setAnswering(null); }, [task]);
  const offline = state === 'offline';
  if (state === 'connecting') return <Connecting />;

  if (detail) {
    const asked = openDecision(detail);
    return (
      <section className="rt-detail" aria-label={detail.title}>
        {offline && <OfflineBanner />}
        <button type="button" className="rt-back" onClick={() => onShow(null)}>‹ {c.back}</button>
        <h3><code>{detail.id}</code> · {detail.title}</h3>
        <span className="rt-meta">{asked ? t.decision.asks(detail.giverName) : `${c.from(detail.giverName, detail.ownerName)} · ${t.chat.task.state[detail.state]}`}</span>
        {detail.text && <div className="rt-txt">{detail.text}</div>}
        {detail.result && <div><b>{detail.state === 'done' ? c.result : c.reason} :</b> {detail.result}</div>}
        {asked && detail.brain && <NoteDecision task={{ ...detail, brain: detail.brain }} api={api} />}
        {asked && !detail.brain && (answering === detail.id && !offline
          ? <DecisionAnswer task={detail} api={api} onClose={() => setAnswering(null)} />
          : <button type="button" className="rt-btn pri" disabled={offline} onClick={() => setAnswering(detail.id)}>{t.decision.answer}</button>)}
        <h4>{c.log}</h4>
        <ul className="rt-log">{detail.log.map((l, i) => <li key={i}><small>{clock(l.at)}</small>{l.by} : {l.what}</li>)}</ul>
      </section>
    );
  }

  const list = api.tasks.filter(x => (filter === 'all' || (filter === 'open') !== taskClosed(x)) && (giver === 'all' || giver === giverOf(x))).slice().reverse();
  const open = (id: string) => { scroll.current = listRef.current?.scrollTop ?? 0; onShow(id); };
  return (
    <div className="rt-pane" role="tabpanel" aria-label={t.home.tabs.tasks(api.tasks.filter(x => !taskClosed(x)).length)}>
      {offline && <OfflineBanner />}
      <div className="rt-filters" role="group" aria-label={c.filters}>
        <select aria-label={c.filters} value={filter} onChange={e => setFilter(e.target.value as StateFilter)}>
          <option value="all">{c.all}</option><option value="open">{c.open}</option><option value="closed">{c.closed}</option>
        </select>
        <select aria-label={c.giver} value={giver} onChange={e => setGiver(e.target.value as GiverFilter)}>
          <option value="all">{c.anyGiver}</option><option value="ledge">{c.ledge}</option><option value="sessions">{c.sessions}</option><option value="decisions">{c.decisions}</option>
        </select>
      </div>
      {api.tasks.length === 0 ? <div className="rt-empty">{c.none}</div>
        : list.length === 0 ? <div className="rt-empty">{c.noneFiltered}<button type="button" className="rt-btn" onClick={() => { setFilter('all'); setGiver('all'); }}>{c.clearFilters}</button></div>
          : (
            <div ref={listRef} className={cls('rt-list', offline && 'dim')}>
              {list.map(x => {
                const [k, m] = markOf(x);
                return (
                  <button key={x.id} type="button" className="rt-trow" data-task={x.id} onClick={() => open(x.id)}>
                    <span className={`mk ${k}`} aria-hidden="true">{m}</span>
                    <b>{x.title}</b>
                    <small><code>{x.id}</code> · {c.from(x.giverName, x.ownerName)} · {k === 'asked' ? t.asks.pill.decision : t.chat.task.state[x.state]}</small>
                  </button>
                );
              })}
            </div>
          )}
    </div>
  );
}

/** « Historique »: the questions asked to Ledge since the last new conversation, the latest first; a click goes back to the
 *  conversation on that question (ChatPanel scrolls to it and lights it). */
export function HistoryPane({ chat, state, onOpen }: { chat: readonly ChatTurn[]; state: ListState; onOpen(qid: string): void }): JSX.Element {
  const { t } = useI18n();
  if (state === 'connecting') return <Connecting />;
  const offline = state === 'offline';
  return (
    <div className="rt-pane" role="tabpanel" aria-label={t.home.tabs.history}>
      {offline && <OfflineBanner />}
      {chat.length === 0 ? <div className="rt-empty">{t.home.history.none}</div> : (
        <div className={cls('rt-list', offline && 'dim')}>
          {chat.slice().reverse().map(turn => (
            <button key={turn.qid} type="button" className="rt-hrow" title={t.home.history.open} onClick={() => onOpen(turn.qid)}>
              <small>{clock(turn.askedAt)}</small><span>{turn.question}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
