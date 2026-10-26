import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import { daemonStore, useDaemon, type DaemonClient } from '@ledge/fleet';
import { contextShare, LEDGE_GIVER, taskClosed, type ChatTurn, type Projects, type Session, type Task, type Team } from '@ledge/protocol';
import { ChatView } from '@ledge/ui/chat/ChatView';
import { ChatCopyProvider } from '@ledge/ui/chat/copy';
import { useActionCards } from '@ledge/ui/chat/useActionCards';
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
import { teamProject } from '../atelier/layout';
import { closedLedgeTasks, ledgeProgress, nearLimit, type TeamsApi } from '../teams/useTeamsApi';
import type { Wait } from '../list/time';
import { useAgentHighlight } from './useAgentHighlight';
import { useChatCards } from './useChatCards';
import { useTeamCards } from './useTeamCards';
import { CardModelPick } from './CardModelPick';
import { useProjectReview } from './projectReview';

export interface LedgeHomeProps {
  client: DaemonClient; view: FleetView; teams: TeamsApi; decisions: Decisions; waits: ReadonlyMap<string, Wait>;
  tab: HomeTab; dispatch: (a: NavAction) => void;
  /** The task « Tâches » opens on (the sidebar's « Voir »). */
  task?: string;
  paused: boolean; focus: number;
  projects: Projects | null;
  onLaunched(id: string): void; onTerminal(id: string): void; notify(text: string): void; onProposal(pid: string): void;
}

const isToday = (iso: string) => iso.slice(0, 10) === new Date().toISOString().slice(0, 10);
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });


/**
 * « Le point » (ledge home spec §2.2): built here from the daemon's state, never by the model, so it is instant and true.
 * What waits for the user (answerable in place) and the closed tasks Ledge gave; the live teams with the progress of
 * Ledge's tasks; the tasks Ledge gave, open or closed today. « Résumer la journée » is an ordinary question.
 */
export function LePoint({ view, teams, decisions, waits, projects, dispatch, onAsk, onShowTask, busy }: {
  view: FleetView; teams: TeamsApi; decisions: Decisions; waits: ReadonlyMap<string, Wait>; projects: Projects | null; dispatch: (a: NavAction) => void;
  onAsk(text: string): void; onShowTask(id: string): void; busy: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const p = t.home.point;
  const attn = useMemo(() => attentionOf(view.sessions, waits), [view.sessions, waits]);
  const closed = closedLedgeTasks(teams.tasks);
  // Near their context limit (context handover spec §3.2), as « À toi » lists them.
  const near = useMemo(() => nearLimit(view.sessions, teams.later, teams.near), [view.sessions, teams.later, teams.near]);
  const given = teams.tasks.filter(x => x.giver === LEDGE_GIVER && (!taskClosed(x) || isToday(x.updatedAt)));
  const live = teams.teams ?? [];
  const state = (x: Task) => t.chat.task.state[x.state];
  return (
    <section className="le-point" aria-label={p.title}>
      <div className="lp-head">
        <strong>{p.title}</strong>
        <span className="st-fill" />
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => onAsk(p.summarizeQuestion)}>{p.summarize}</Button>
      </div>
      <div className="lp-cols">
        <div className="lp-col" aria-label={p.yours}>
          <h3>{p.yours} {attn.length + closed.length + near.length > 0 && <b className="st-badge">{attn.length + closed.length + near.length}</b>}</h3>
          {attn.length + closed.length + near.length === 0 && <p className="lp-none">{p.nothingYours}</p>}
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
          {closed.map(x => (
            <div key={x.id} className="lp-row lp-task-closed" data-task={x.id}>
              <span className={cls('lp-mark', `lp-${x.state}`)} aria-hidden>{x.state === 'done' ? '✓' : '!'}</span>
              <span className="lp-text">{p.closed(x.ownerName, x.title, x.state as 'done' | 'refused' | 'dropped')} <small>· {p.ofLedge}</small></span>
              <button type="button" className="st-qa" onClick={() => onShowTask(x.id)}>{p.see}</button>
              <button type="button" className="st-qa" onClick={() => teams.seen(x.id)}>{p.dismiss}</button>
            </div>
          ))}
          {near.map(s => {
            const failed = s.handover?.state === 'failed';
            const pct = Math.round((contextShare(s.context) ?? 0) * 100);
            return (
              <div key={`near:${s.id}`} className="lp-row lp-near" data-near={s.id}>
                <span className={cls('lp-mark', failed ? 'lp-refused' : 'lp-near-mark')} aria-hidden>{failed ? '!' : '◔'}</span>
                <span className="lp-text" title={failed ? s.handover?.reason : t.handover.nearHint}>{failed ? t.handover.failedShort(s.name) : t.handover.nearShort(s.name, pct)}</span>
                <button type="button" className="st-qa pri" title={t.handover.passTitle} onClick={() => { void teams.handover(s.id); }}>{failed ? t.handover.retry : t.handover.pass}</button>
              </div>
            );
          })}
        </div>
        <div className="lp-col" aria-label={p.teams}>
          <h3>{p.teams}</h3>
          {live.length === 0 && <p className="lp-none">{p.noTeam}</p>}
          {live.map(team => <TeamLine key={team.id} team={team} teams={teams} projects={projects} dispatch={dispatch} />)}
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

/** A live team in one line: its name, project and seats, the progress of Ledge's tasks, and « Table » or « Reprendre ». */
function TeamLine({ team, teams, projects, dispatch }: { team: Team; teams: TeamsApi; projects: Projects | null; dispatch: (a: NavAction) => void }): JSX.Element {
  const { t } = useI18n();
  const p = t.home.point;
  const { done, given } = ledgeProgress(teams.tasks, team.id);
  const room = teamProject(team, projects);
  const name = room ? projects?.projects.find(x => x.id === room)?.name : undefined;
  return (
    <div className={cls('lp-row lp-team', team.state === 'resting' && 'lp-resting')} data-team={team.id}>
      <span className="team-flag" aria-hidden>⚑</span>
      <span className="lp-text"><strong>{team.name}</strong> <small>{[name, p.seats(team.seats.filter(s => s.sessionId).length), team.state === 'resting' ? p.resting : null].filter(Boolean).join(' · ')}</small></span>
      <span className="lp-progress" title={p.progress(done, given)} aria-label={p.progress(done, given)}><i style={{ width: `${given ? Math.round((done / given) * 100) : 0}%` }} /></span>
      <small className="lp-count">{done}/{given}</small>
      {team.state === 'resting'
        ? <button type="button" className="st-qa" onClick={() => teams.resume(team.id)}>{p.resume}</button>
        : <button type="button" className="st-qa" onClick={() => dispatch({ type: 'home', ...(room ? { project: room } : {}) })}>{p.table}</button>}
    </div>
  );
}

/** « Équipes »: the same live teams as « Le point », each with its seats and their sessions. */
function TeamsTab({ teams, sessions, projects, dispatch }: { teams: TeamsApi; sessions: readonly Session[]; projects: Projects | null; dispatch: (a: NavAction) => void }): JSX.Element {
  const { t } = useI18n();
  const live = teams.teams ?? [];
  const byId = new Map(sessions.map(s => [s.id, s]));
  return (
    <div className="home-list" role="tabpanel" aria-label={t.home.tabs.teams(live.length)}>
      {live.length === 0 && <p className="lp-none">{t.home.teams.none}</p>}
      {live.map(team => (
        <section key={team.id} className="home-team">
          <TeamLine team={team} teams={teams} projects={projects} dispatch={dispatch} />
          <ul>
            {team.seats.map(seat => {
              const s = seat.sessionId ? byId.get(seat.sessionId) : undefined;
              return (
                <li key={seat.role}>
                  <span className="role-pill">@{seat.role}</span>
                  {s ? <button type="button" className="st-name" onClick={() => dispatch({ type: 'open', id: s.id })}>{s.name}</button> : <span className="lp-none">—</span>}
                  {s && <small>{t.stateLabel[s.state === 'waiting_permission' ? 'approval' : s.state === 'waiting_input' ? 'question' : s.state === 'exited' ? 'done' : s.state === 'idle' ? 'idle' : s.state === 'error' ? 'error' : 'working']}</small>}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

type StateFilter = 'all' | 'open' | 'closed';
type GiverFilter = 'all' | 'ledge' | 'seats';

/** « Tâches »: Ledge's tasks and the teams' own, with filters (team, state, giver); a task opens on its detail and history. */
function TasksTab({ teams, shown, onShow }: { teams: TeamsApi; shown: string | null; onShow(id: string | null): void }): JSX.Element {
  const { t } = useI18n();
  const c = t.home.tasks;
  const [state, setState] = useState<StateFilter>('all');
  const [giver, setGiver] = useState<GiverFilter>('all');
  const [team, setTeam] = useState<string>('all');
  const list = teams.tasks.filter(x => (state === 'all' || (state === 'open') !== taskClosed(x))
    && (giver === 'all' || (giver === 'ledge') === (x.giver === LEDGE_GIVER)) && (team === 'all' || x.team === team)).slice().reverse();
  const detail = shown ? teams.tasks.find(x => x.id === shown) : undefined;
  return (
    <div className="home-list" role="tabpanel" aria-label={t.home.tabs.tasks(teams.tasks.length)}>
      <div className="home-filters" role="group" aria-label={c.filters}>
        <select aria-label={c.filters} value={state} onChange={e => setState(e.target.value as StateFilter)}>
          <option value="all">{c.all}</option><option value="open">{c.open}</option><option value="closed">{c.closed}</option>
        </select>
        <select aria-label={c.giver} value={giver} onChange={e => setGiver(e.target.value as GiverFilter)}>
          <option value="all">{c.anyGiver}</option><option value="ledge">{c.ledge}</option><option value="seats">{c.seats}</option>
        </select>
        <select aria-label={c.team} value={team} onChange={e => setTeam(e.target.value)}>
          <option value="all">{c.anyTeam}</option>
          {(teams.teams ?? []).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
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
          {turn.team && <span className="team-flag" aria-hidden>⚑</span>}
        </button>
      ))}
    </div>
  );
}

/** The word being typed when it starts with `@` (a session) or `#` (a team): what the mention list completes. */
export function mentionAt(text: string): { sigil: '@' | '#'; query: string; start: number } | null {
  const m = /(^|\s)([@#])([^\s@#]*)$/.exec(text);
  return m ? { sigil: m[2] as '@' | '#', query: m[3]!.toLowerCase(), start: m.index + m[1]!.length } : null;
}

/**
 * Ledge's home view (ledge home spec §2.2), where the app opens: the header, the tabs, « Le point » pinned over the
 * conversation, the cards (sessions, relays, closes, projects, teams, tasks), and a richer composer: suggestions, several
 * lines, `@` a session and `#` a team, and the reminder that Ledge does nothing without a click.
 */
export function LedgeHome(p: LedgeHomeProps): JSX.Element {
  const { client, view, teams, tab, dispatch } = p;
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
  const actionCards = useActionCards({ send, chat, errors: view.errors, turnReady });
  const teamCards = useTeamCards({ send, onMessage, chat });
  const project = useProjectReview({ chat, projects: p.projects, machines: view.machines, notify: p.notify, onProposal: p.onProposal });
  const [hovered, setHovered] = useState<string | null>(null);
  useAgentHighlight(hovered);
  const [draft, setDraft] = useState('');
  const [shownTask, setShownTask] = useState<string | null>(p.task ?? null);
  useEffect(() => { if (p.task) setShownTask(p.task); }, [p.task]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  useEffect(() => { if (tab === 'conversation') inputRef.current?.focus({ preventScroll: true }); }, [p.focus, tab]);
  const busy = chat.some(x => x.answeredAt === undefined && x.error === undefined);
  const live = teams.teams ?? [];

  const ask = (text: string) => {
    if (offline) return;
    const qid = `q-${crypto.randomUUID()}`;
    daemonStore.beginTurn({ qid, question: text, askedAt: new Date().toISOString(), steps: [] });
    send({ type: 'chat.ask', qid, text, tool });
    if (tab !== 'conversation') dispatch({ type: 'ledge', tab: 'conversation' });
  };
  const open = (id: string) => { setHovered(null); dispatch({ type: 'open', id }); };
  const showTask = (id: string | null) => { setShownTask(id); if (id && tab !== 'tasks') dispatch({ type: 'ledge', tab: 'tasks' }); };
  const openTable = (teamId: string) => {
    const team = live.find(x => x.id === teamId);
    const room = team ? teamProject(team, p.projects) : null;
    dispatch({ type: 'home', ...(room ? { project: room } : {}) });
  };

  // `@` names a session, `#` a team: the list completes the word being typed, inserted as the name the context folder knows.
  const mention = mentionAt(draft);
  const choices = mention ? (mention.sigil === '@'
    ? view.sessions.filter(s => s.name.toLowerCase().startsWith(mention.query)).slice(0, 6).map(s => ({ key: s.id, label: t.home.mentionSession(s.name), insert: `@${s.name}` }))
    : live.filter(x => x.name.toLowerCase().startsWith(mention.query) || x.id.startsWith(mention.query)).slice(0, 6).map(x => ({ key: x.id, label: t.home.mentionTeam(x.name), insert: `#${x.name}` }))) : [];
  useEffect(() => setMentionIndex(0), [mention?.query, mention?.sigil]);
  const insert = (value: string) => { if (!mention) return; setDraft(`${draft.slice(0, mention.start)}${value} `); inputRef.current?.focus(); };
  const onFieldKey = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): boolean => {
    if (!choices.length) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => (i + (e.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(choices[mentionIndex]!.insert); return true; }
    return false;
  };
  const suggestions = t.home.suggestions(live[0]?.name);
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
        <span className="home-sub">{t.home.operator(view.sessions.length, live.filter(x => x.state === 'active').length, machines)}</span>
      </div>
      <span className="st-fill" />
      <Button variant="ghost" size="icon" aria-label={t.chat.reset} title={t.chat.reset} disabled={busy || !!offline || chat.length === 0} onClick={() => send({ type: 'chat.reset' })}><Icon {...ICONS.plus} /></Button>
      <Button variant="ghost" size="icon" aria-label={t.home.toAtelier} title={t.home.toAtelier} onClick={() => dispatch({ type: 'escape' })}><Icon {...ICONS.close} /></Button>
    </div>
  );
  const counts: Record<HomeTab, string> = { conversation: t.home.tabs.conversation, teams: t.home.tabs.teams(live.length), tasks: t.home.tabs.tasks(teams.tasks.filter(x => !taskClosed(x)).length), history: t.home.tabs.history };
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
              <ChatView docked visible hideHeader multiline turns={chat} live={chatLive} sessions={view.sessions} offline={offline}
                pinned={<LePoint view={view} teams={teams} decisions={p.decisions} waits={p.waits} projects={p.projects} dispatch={dispatch} onAsk={ask} onShowTask={showTask} busy={busy || !!offline} />}
                above={above} footnote={<small className="home-readonly">{t.home.readOnly}</small>}
                draft={draft} onDraft={setDraft} onFieldKey={onFieldKey}
                onAsk={ask} onCancel={qid => send({ type: 'chat.cancel', qid })} onReset={() => send({ type: 'chat.reset' })} onClose={() => dispatch({ type: 'escape' })}
                onOpenSession={open} onTerminal={id => { setHovered(null); p.onTerminal(id); }} turnAvailable={turnReady}
                launchingQid={cards.launchingQid} launchingRows={cards.launchingRows} onLaunchProposal={cards.launch}
                closingQid={cards.closingQid} closingRows={cards.closingRows} onCloseSessions={cards.close}
                onAct={actionCards.act} actingQid={actionCards.actingQid} actingRows={actionCards.actingRows} onIgnoreCards={actionCards.ignore} onDenyAction={actionCards.deny}
                renderModel={(qid, agent, b) => <CardModelPick client={client} machine={turnMachine(qid)} tool={agent} pick={cards.pick(qid)} disabled={b} onPick={next => cards.setPick(qid, next)} />}
                relayingQid={cards.relayingQid} onRelay={cards.relay} onRelayCancel={cards.cancelRelay}
                onProject={project.review} projectNamed={project.projectNamed}
                onLaunchTeam={teamCards.launchTeam} onSaveTeam={teamCards.saveTeam} onOpenTeam={openTable} onGiveTask={teamCards.giveTask}
                teamBusy={teamCards.teamBusy} taskBusy={teamCards.taskBusy} clock={clock}
                onAgentHover={setHovered} inputRef={inputRef}
                theme={theme} frozen={offline !== null} reducedMotion={p.paused || reduced} />
            </ChatCopyProvider>
          )}
          {tab === 'teams' && <TeamsTab teams={teams} sessions={view.sessions} projects={p.projects} dispatch={dispatch} />}
          {tab === 'tasks' && <TasksTab teams={teams} shown={shownTask} onShow={setShownTask} />}
          {tab === 'history' && <HistoryTab chat={chat} onOpen={qid => {
            dispatch({ type: 'ledge', tab: 'conversation' });
            requestAnimationFrame(() => [...document.querySelectorAll<HTMLElement>('[data-turn]')][chat.findIndex(x => x.qid === qid)]?.scrollIntoView({ block: 'start' }));
          }} />}
        </div>
      </div>
    </section>
  );
}
