import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import { daemonStore, useDaemon, type DaemonClient } from '@ledge/fleet';
import { contextShare, LEDGE_GIVER, openDecision, taskClosed, type ChatTurn, type Projects, type Task } from '@ledge/protocol';
import { ChatView } from '@ledge/ui/chat/ChatView';
import { ChatCopyProvider } from '@ledge/ui/chat/copy';
import { useActionCards } from '@ledge/ui/chat/useActionCards';
import { useAttachments } from '../images/useAttachments';
import { TurnThumbs } from '../images/Thumbs';
import { ResidentMascot } from '@ledge/ui/bots/ResidentMascot';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import type { FleetView } from '../fleet/useFleet';
import type { Decisions } from '../fleet/decisions';
import { chatCopy, useI18n } from '../i18n/lang';
import { useMotionPreferences } from '../motionPreferences';
import { useTheme } from '../shell/theme';
import { cls } from '../shell/cls';
import { SessionBot } from '../shell/SessionBot';
import { attentionOf, quickDecide } from '../shell/sidebar/model';
import { useDefaultTool } from '../settings/tool';
import { HOME_TABS, type HomeTab, type NavAction } from '../nav/state';
import { closedLedgeTasks, nearLimit, openDecisions, type TasksApi } from '../tasks/useTasksApi';
import { DecisionAnswer } from '../tasks/DecisionAnswer';
import type { Wait } from '../list/time';
import { useAgentHighlight } from './useAgentHighlight';
import { useChatCards } from './useChatCards';
import { useTaskCards } from './useTaskCards';
import { CardModelPick } from './CardModelPick';
import { useProjectReview } from './projectReview';
import type { OpenRigAsksView } from '@ledge/fleet/openrigAsks';
import { AsksColumn } from '../asks/AsksColumn';
import { sessionOfAsk } from '../asks/model';

export interface LedgeHomeProps {
  client: DaemonClient; view: FleetView; tasks: TasksApi; decisions: Decisions; waits: ReadonlyMap<string, Wait>;
  tab: HomeTab; dispatch: (a: NavAction) => void;
  /** The task « Tâches » opens on (the sidebar's « Voir »). */
  task?: string;
  paused: boolean; focus: number;
  projects: Projects | null;
  onLaunched(id: string): void; onTerminal(id: string): void; notify(text: string): void; onProposal(pid: string): void;
  /** « À toi »: what OpenRig's rigs ask the person, and the card the sidebar's « Voir » brings into view. */
  asks?: OpenRigAsksView; askFocus?: { id: string; n: number } | null; machineLabel?: string;
}

const isToday = (iso: string) => iso.slice(0, 10) === new Date().toISOString().slice(0, 10);
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });


/**
 * « Le point » (ledge home spec §2.2): built here from the daemon's state, never by the model, so it is instant and true.
 * What waits for the user (answerable in place: the decisions sessions put to it too) and the closed tasks Ledge gave; the tasks
 * Ledge gave, open or closed today. « Résumer la journée » is an ordinary question.
 */
export function LePoint({ view, api, decisions, waits, dispatch, onAsk, onShowTask, busy, asks, askFocus, machineLabel = 'local' }: {
  view: FleetView; api: TasksApi; decisions: Decisions; waits: ReadonlyMap<string, Wait>; dispatch: (a: NavAction) => void;
  onAsk(text: string): void; onShowTask(id: string): void; busy: boolean;
  asks?: OpenRigAsksView | undefined; askFocus?: { id: string; n: number } | null | undefined; machineLabel?: string | undefined;
}): JSX.Element {
  const { t } = useI18n();
  const p = t.home.point;
  const attn = useMemo(() => attentionOf(view.sessions, waits), [view.sessions, waits]);
  const closed = closedLedgeTasks(api.tasks);
  const asked = openDecisions(api.tasks);
  const [answering, setAnswering] = useState<string | null>(null);
  // Near their context limit (context handover spec §3.2), as « À toi » lists them.
  const near = useMemo(() => nearLimit(view.sessions, api.later, api.near), [view.sessions, api.later, api.near]);
  const given = api.tasks.filter(x => x.giver === LEDGE_GIVER && (!taskClosed(x) || isToday(x.updatedAt)));
  const state = (x: Task) => t.chat.task.state[x.state];
  const rigAsks = asks?.asks.length ?? 0;
  const count = attn.length + asked.length + closed.length + near.length + rigAsks;
  // The fade at the bottom while « Le point » has more below than it shows.
  const pointRef = useRef<HTMLElement>(null);
  const [more, setMore] = useState(false);
  const measure = useCallback(() => { const el = pointRef.current; if (el) setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 1); }, []);
  useEffect(() => {
    measure();
    const el = pointRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const cols = el.querySelector('.lp-cols');
    if (cols) ro.observe(cols);
    return () => ro.disconnect();
  }, [measure]);
  return (
    <section ref={pointRef} className={cls('le-point', more && 'lp-more')} aria-label={p.title} onScroll={measure}>
      <div className="lp-head">
        <strong>{p.title}</strong>
        <span className="st-fill" />
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => onAsk(p.summarizeQuestion)}>{p.summarize}</Button>
      </div>
      <div className="lp-cols">
        <div className="lp-col" aria-label={p.yours}>
          <h3>{p.yours} {count > 0 && <b className="st-badge">{count}</b>}</h3>
          {asks && <AsksColumn view={asks} sessions={view.sessions} machineLabel={machineLabel} focus={askFocus ?? null}
            sourceOf={ask => { const s = sessionOfAsk(ask, view.sessions); return s ? (path: string) => dispatch({ type: 'open', id: s.id, doc: path }) : null; }}
            onOpenSeat={id => dispatch({ type: 'open', id })} />}
          {/* Never « Rien ne t'attend » when the list is not known whole (a banner, or a failed read: review). */}
          {count === 0 && !(asks?.channel && asks.channel.state !== 'ready') && !asks?.partial && <p className="lp-none">{p.nothingYours}</p>}
          {attn.map(item => (
            <div key={item.session.id} className="lp-row">
              <SessionBot session={item.session} size={16} paused />
              <span className="lp-text"><strong>{item.helper?.kind ?? item.session.name}</strong> {item.session.pending?.text ?? ''}</span>
              {item.kind === 'approval' && quickDecide(item.session) ? <>
                <button type="button" className="st-qa pri" onClick={() => decisions.decide(item.session, 'accept')}>{p.allow}</button>
                <button type="button" className="st-qa" onClick={() => decisions.decide(item.session, 'deny')}>{p.deny}</button>
              </> : <button type="button" className="st-qa" onClick={() => dispatch({ type: 'open', id: item.session.id, ...(item.helper ? { helper: item.helper.id } : {}), ...(item.kind === 'question' ? { focus: 'reply' as const } : {}) })}>{p.see}</button>}
            </div>
          ))}
          {asked.map(x => (
            <div key={x.id} className="lp-decision" data-decision={x.id}>
              <div className="lp-row">
                <span className="lp-mark lp-asked" aria-hidden>?</span>
                <span className="lp-text" title={t.decision.asks(x.giverName)}><strong>{x.giverName}</strong> {x.title}</span>
                {answering !== x.id && <button type="button" className="st-qa pri" onClick={() => setAnswering(x.id)}>{t.decision.answer}</button>}
              </div>
              {x.text && <p className="lp-detail">{x.text}</p>}
              {answering === x.id && <DecisionAnswer task={x} api={api} onClose={() => setAnswering(null)} />}
            </div>
          ))}
          {closed.map(x => (
            <div key={x.id} className="lp-row lp-task-closed" data-task={x.id}>
              <span className={cls('lp-mark', `lp-${x.state}`)} aria-hidden>{x.state === 'done' ? '✓' : '!'}</span>
              <span className="lp-text">{p.closed(x.ownerName, x.title, x.state as 'done' | 'refused' | 'dropped')} <small>· {p.ofLedge}</small></span>
              <button type="button" className="st-qa" onClick={() => onShowTask(x.id)}>{p.see}</button>
              <button type="button" className="st-qa" onClick={() => api.seen(x.id)}>{p.dismiss}</button>
            </div>
          ))}
          {near.map(s => {
            const failed = s.handover?.state === 'failed';
            const pct = Math.round((contextShare(s.context) ?? 0) * 100);
            return (
              <div key={`near:${s.id}`} className="lp-row lp-near" data-near={s.id}>
                <span className={cls('lp-mark', failed ? 'lp-refused' : 'lp-near-mark')} aria-hidden>{failed ? '!' : '◔'}</span>
                <span className="lp-text" title={failed ? s.handover?.reason : t.handover.nearHint}>{failed ? t.handover.failedShort(s.name) : t.handover.nearShort(s.name, pct)}</span>
                <button type="button" className="st-qa pri" title={t.handover.passTitle} onClick={() => { void api.handover(s.id); }}>{failed ? t.handover.retry : t.handover.pass}</button>
              </div>
            );
          })}
        </div>
        <div className="lp-col" aria-label={p.given}>
          <h3>{p.given}</h3>
          {given.length === 0 && <p className="lp-none">{p.noTask}</p>}
          {given.map(x => (
            <button key={x.id} type="button" className="lp-row lp-task" data-state={x.state} onClick={() => onShowTask(x.id)}>
              <span className="lp-text"><strong>{x.title}</strong></span>
              <small>{p.owner(x.ownerName, state(x))}</small>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

type StateFilter = 'all' | 'open' | 'closed';
type GiverFilter = 'all' | 'ledge' | 'sessions' | 'decisions';
/** Who a task comes from: Ledge, a session for another, or a session asking the user (a decision, owner Ledge). */
const giverOf = (x: Task): Exclude<GiverFilter, 'all'> => x.owner === LEDGE_GIVER ? 'decisions' : x.giver === LEDGE_GIVER ? 'ledge' : 'sessions';

/** « Tâches »: Ledge's tasks, the sessions' own and the decisions put to the user, with filters (state, giver); a task opens
 *  on its detail and history, an open decision with « Répondre » too. */
function TasksTab({ api, shown, onShow }: { api: TasksApi; shown: string | null; onShow(id: string | null): void }): JSX.Element {
  const { t } = useI18n();
  const c = t.home.tasks;
  const [state, setState] = useState<StateFilter>('all');
  const [giver, setGiver] = useState<GiverFilter>('all');
  const [answering, setAnswering] = useState<string | null>(null);
  const list = api.tasks.filter(x => (state === 'all' || (state === 'open') !== taskClosed(x))
    && (giver === 'all' || giver === giverOf(x))).slice().reverse();
  const detail = shown ? api.tasks.find(x => x.id === shown) : undefined;
  return (
    <div className="home-list" role="tabpanel" aria-label={t.home.tabs.tasks(api.tasks.length)}>
      <div className="home-filters" role="group" aria-label={c.filters}>
        <select aria-label={c.filters} value={state} onChange={e => setState(e.target.value as StateFilter)}>
          <option value="all">{c.all}</option><option value="open">{c.open}</option><option value="closed">{c.closed}</option>
        </select>
        <select aria-label={c.giver} value={giver} onChange={e => setGiver(e.target.value as GiverFilter)}>
          <option value="all">{c.anyGiver}</option><option value="ledge">{c.ledge}</option><option value="sessions">{c.sessions}</option><option value="decisions">{c.decisions}</option>
        </select>
      </div>
      {list.length === 0 && <p className="lp-none">{c.none}</p>}
      {list.map(x => (
        <button key={x.id} type="button" className={cls('lp-row lp-task', shown === x.id && 'sel')} data-state={x.state} onClick={() => onShow(shown === x.id ? null : x.id)}>
          <code>{x.id}</code>
          <span className="lp-text"><strong>{x.title}</strong> <small>{c.from(x.giverName, x.ownerName)}</small></span>
          <small>{t.chat.task.state[x.state]}</small>
        </button>
      ))}
      {detail && (
        <section className="home-task" aria-label={detail.title}>
          <h3>{detail.id} · {detail.title}</h3>
          <p className="lp-none">{c.from(detail.giverName, detail.ownerName)} · {t.chat.task.state[detail.state]}</p>
          {detail.text && <p className="home-task-text">{detail.text}</p>}
          {detail.result && <p><strong>{detail.state === 'done' ? c.result : c.reason} :</strong> {detail.result}</p>}
          {openDecision(detail) && (answering === detail.id
            ? <DecisionAnswer task={detail} api={api} onClose={() => setAnswering(null)} />
            : <Button variant="primary" size="sm" onClick={() => setAnswering(detail.id)}>{t.decision.answer}</Button>)}
          <h4>{c.log}</h4>
          <ul>{detail.log.map((l, i) => <li key={i}><small>{clock(l.at)}</small> {l.by} : {l.what}</li>)}</ul>
          <Button variant="ghost" size="sm" onClick={() => onShow(null)}>{c.close}</Button>
        </section>
      )}
    </div>
  );
}

/** « Historique »: the day's questions, which the daemon keeps; one opens the conversation on it. */
function HistoryTab({ chat, onOpen }: { chat: readonly ChatTurn[]; onOpen(qid: string): void }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="home-list" role="tabpanel" aria-label={t.home.tabs.history}>
      {chat.length === 0 && <p className="lp-none">{t.home.history.none}</p>}
      {chat.slice().reverse().map(turn => (
        <button key={turn.qid} type="button" className="lp-row" onClick={() => onOpen(turn.qid)} title={t.home.history.open}>
          <small>{clock(turn.askedAt)}</small>
          <span className="lp-text">{turn.question}</span>
        </button>
      ))}
    </div>
  );
}

/** The word being typed when it starts with `@` (a session): what the mention list completes. */
export function mentionAt(text: string): { query: string; start: number } | null {
  const m = /(^|\s)@([^\s@]*)$/.exec(text);
  return m ? { query: m[2]!.toLowerCase(), start: m.index + m[1]!.length } : null;
}

/**
 * Ledge's home view (ledge home spec §2.2), where the app opens: the header, the tabs, « Le point » pinned over the
 * conversation, the cards (sessions, relays, closes, projects, tasks), and a richer composer: suggestions, several
 * lines, `@` a session, and the reminder that Ledge does nothing without a click.
 */
export function LedgeHome(p: LedgeHomeProps): JSX.Element {
  const { client, view, tasks, tab, dispatch } = p;
  const { t } = useI18n();
  const copy = useMemo(() => chatCopy(t), [t]);
  const theme = useTheme();
  const { reduced } = useMotionPreferences();
  const { chat, chatLive } = useDaemon();
  const [tool] = useDefaultTool();
  const send = useCallback((m: Parameters<DaemonClient['send']>[0]) => client.send(m), [client]);
  const onMessage = useCallback((fn: Parameters<DaemonClient['onMessage']>[0]) => client.onMessage(fn), [client]);
  const offline = view.machines.find(m => m.id === 'local')?.ready ? null : copy.offline;
  const turnReady = useCallback((qid: string) => !!view.fleet.turnMachine(qid)?.ready, [view.fleet]);
  const turnMachine = useCallback((qid: string) => view.fleet.turnMachine(qid)?.id, [view.fleet]);
  const cards = useChatCards({ send, chat, lastLaunched: view.lastLaunched, errors: view.errors, sessions: view.sessions, turnReady, turnMachine, onLaunched: p.onLaunched });
  const actionCards = useActionCards({ send, chat, errors: view.errors, turnReady, onMessage });
  const taskCards = useTaskCards({ send, onMessage });
  const project = useProjectReview({ chat, projects: p.projects, machines: view.machines, notify: p.notify, onProposal: p.onProposal });
  const [hovered, setHovered] = useState<string | null>(null);
  useAgentHighlight(hovered);
  const [draft, setDraft] = useState('');
  const [shownTask, setShownTask] = useState<string | null>(p.task ?? null);
  useEffect(() => { if (p.task) setShownTask(p.task); }, [p.task]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  // The composer takes the focus on the conversation tab, unless the sidebar's « Voir » just sent the focus to a card (review P1).
  const seenAsk = useRef(p.askFocus?.n ?? 0);
  useEffect(() => {
    if (p.askFocus && p.askFocus.n !== seenAsk.current) { seenAsk.current = p.askFocus.n; return; }
    if (tab === 'conversation') inputRef.current?.focus({ preventScroll: true });
  }, [p.focus, tab, p.askFocus]);
  const busy = chat.some(x => x.answeredAt === undefined && x.error === undefined);

  // Images pasted or dropped on the field travel inline with the field's question only (not a suggestion's or « Résumer »).
  const images = useAttachments(client, { inline: true });
  const ask = (text: string, withImages = false) => {
    if (offline) return;
    const qid = `q-${crypto.randomUUID()}`;
    daemonStore.beginTurn({ qid, question: text, askedAt: new Date().toISOString(), steps: [] });
    const uploads = withImages ? images.uploads() : [];
    send({ type: 'chat.ask', qid, text, ...(uploads.length ? { images: uploads } : {}), tool });
    if (withImages) images.clear();
    if (tab !== 'conversation') dispatch({ type: 'ledge', tab: 'conversation' });
  };
  const open = (id: string) => { setHovered(null); dispatch({ type: 'open', id }); };
  const showTask = (id: string | null) => { setShownTask(id); if (id && tab !== 'tasks') dispatch({ type: 'ledge', tab: 'tasks' }); };

  // `@` names a session: the list completes the word being typed, inserted as the name the context folder knows.
  const mention = mentionAt(draft);
  const choices = mention
    ? view.sessions.filter(s => s.name.toLowerCase().startsWith(mention.query)).slice(0, 6).map(s => ({ key: s.id, label: t.home.mentionSession(s.name), insert: `@${s.name}` }))
    : [];
  useEffect(() => setMentionIndex(0), [mention?.query]);
  const insert = (value: string) => { if (!mention) return; setDraft(`${draft.slice(0, mention.start)}${value} `); inputRef.current?.focus(); };
  const onFieldKey = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): boolean => {
    if (!choices.length) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => (i + (e.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(choices[mentionIndex]!.insert); return true; }
    return false;
  };
  const suggestions = t.home.suggestions;
  const above = (
    <>
      {choices.length > 0 && (
        <div className="home-mentions" role="listbox" aria-label={t.home.mentions}>
          {choices.map((c, i) => <button key={c.key} type="button" role="option" aria-selected={i === mentionIndex} className={cls(i === mentionIndex && 'sel')} onMouseDown={e => { e.preventDefault(); insert(c.insert); }}>{c.label}</button>)}
        </div>
      )}
      <div className="home-suggestions">
        {suggestions.map(s => (
          <button key={s} type="button" disabled={busy || !!offline}
            onClick={() => { if (s.endsWith('…')) { setDraft(s.slice(0, -1)); inputRef.current?.focus(); } else ask(s); }}>{s}</button>
        ))}
      </div>
    </>
  );
  const machines = view.machines.filter(m => m.ready).length;
  const header = (
    <div className="home-head">
      <ResidentMascot size={30} theme={theme} paused={p.paused} reducedMotion={p.paused || reduced} />
      <div className="home-title">
        <span data-brand className="home-brand">Ledge<span className="brand-dot">.</span></span>
        <span className="home-sub">{t.home.operator(view.sessions.length, machines)}</span>
      </div>
      <span className="st-fill" />
      <Button variant="ghost" size="icon" aria-label={t.chat.reset} title={t.chat.reset} disabled={busy || !!offline || chat.length === 0} onClick={() => send({ type: 'chat.reset' })}><Icon {...ICONS.plus} /></Button>
      <Button variant="ghost" size="icon" aria-label={t.home.toAtelier} title={t.home.toAtelier} onClick={() => dispatch({ type: 'escape' })}><Icon {...ICONS.close} /></Button>
    </div>
  );
  const counts: Record<HomeTab, string> = { conversation: t.home.tabs.conversation, tasks: t.home.tabs.tasks(tasks.tasks.filter(x => !taskClosed(x)).length), history: t.home.tabs.history };
  return (
    <section className="ledge-home" aria-label={t.side.ledgeHome}>
      <div className="home-column">
        {header}
        <div className="home-tabs" role="tablist" aria-label={t.home.tabsLabel}>
          {HOME_TABS.map(x => <button key={x} type="button" role="tab" aria-selected={tab === x} className={cls(tab === x && 'on')} onClick={() => dispatch({ type: 'ledge', tab: x })}>{counts[x]}</button>)}
        </div>
        <div className="home-body">
          {tab === 'conversation' && (
            <ChatCopyProvider value={copy}>
              <ChatView docked visible hideHeader multiline turnImages={turn => <TurnThumbs client={client} turn={turn} />} turns={chat} live={chatLive} sessions={view.sessions} offline={offline}
                pinned={<LePoint view={view} api={tasks} decisions={p.decisions} waits={p.waits} dispatch={dispatch} onAsk={ask} onShowTask={showTask} busy={busy || !!offline}
                  asks={p.asks} askFocus={p.askFocus} machineLabel={p.machineLabel} />}
                above={above} footnote={<small className="home-readonly">{t.home.readOnly}</small>}
                draft={draft} onDraft={setDraft} onFieldKey={onFieldKey}
                attach={{ items: images.items, onFiles: images.add, onRemove: images.remove, ready: images.ready, error: images.error }}
                onAsk={ask} onCancel={qid => send({ type: 'chat.cancel', qid })} onReset={() => send({ type: 'chat.reset' })} onClose={() => dispatch({ type: 'escape' })}
                onOpenSession={open} onTerminal={id => { setHovered(null); p.onTerminal(id); }} turnAvailable={turnReady}
                launchingQid={cards.launchingQid} launchingRows={cards.launchingRows} onLaunchProposal={cards.launch}
                closingQid={cards.closingQid} closingRows={cards.closingRows} onCloseSessions={cards.close}
                onAct={actionCards.act} actingQid={actionCards.actingQid} actingRows={actionCards.actingRows} onIgnoreCards={actionCards.ignore} onDenyAction={actionCards.deny}
                renderModel={(qid, agent, b) => <CardModelPick client={client} machine={turnMachine(qid)} tool={agent} pick={cards.pick(qid)} disabled={b} onPick={next => cards.setPick(qid, next)} />}
                relayingQid={cards.relayingQid} onRelay={cards.relay} onRelayCancel={cards.cancelRelay}
                onProject={project.review} projectNamed={project.projectNamed}
                onGiveTask={taskCards.giveTask} taskBusy={taskCards.taskBusy}
                onAgentHover={setHovered} inputRef={inputRef}
                theme={theme} frozen={offline !== null} reducedMotion={p.paused || reduced} />
            </ChatCopyProvider>
          )}
          {tab === 'tasks' && <TasksTab api={tasks} shown={shownTask} onShow={setShownTask} />}
          {tab === 'history' && <HistoryTab chat={chat} onOpen={qid => {
            dispatch({ type: 'ledge', tab: 'conversation' });
            requestAnimationFrame(() => [...document.querySelectorAll<HTMLElement>('[data-turn]')][chat.findIndex(x => x.qid === qid)]?.scrollIntoView({ block: 'start' }));
          }} />}
        </div>
      </div>
    </section>
  );
}
