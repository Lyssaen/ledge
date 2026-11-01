import { useMemo, useState, type JSX } from 'react';
import { useDaemon, useOpenRig, useRigs, type DaemonClient } from '@ledge/fleet';
import { LEDGE_GIVER, openDecision, taskClosed, type Projects, type Session, type Task, type Team } from '@ledge/protocol';
import { allSeats, isStandalone } from '@ledge/ui/rigs/model';
import { ResidentMascot } from '@ledge/ui/bots/ResidentMascot';
import { Button } from '@ledge/ui/ui/Button';
import { Tabs, tabIds } from '@ledge/ui/ui/Tabs';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import type { FleetView } from '../fleet/useFleet';
import type { Decisions } from '../fleet/decisions';
import { useI18n } from '../i18n/lang';
import { useMotionPreferences } from '../motionPreferences';
import { useTheme } from '../shell/theme';
import { cls } from '../shell/cls';
import { HOME_TABS, type HomeTab, type NavAction, type NavState } from '../nav/state';
import { RigsTab, rigsCount, visibleRigs } from '../rigs/RigsTab';
import type { Relief } from '../session/useRelief';
import { teamProject } from '../atelier/layout';
import { ledgeProgress, type TeamsApi } from '../teams/useTeamsApi';
import { DecisionAnswer } from '../teams/DecisionAnswer';
import { CatalogView, ScopePicker, stateKey, useCatalog, useScope, type CatalogMachine, type CatalogPick, type TeamsView } from '../teams/Catalog';
import type { Wait } from '../list/time';
import { LedgeConversation } from './LedgeConversation';
import { MandateTab } from './mandate/MandateTab';

/** `decisions` and `waits` feed the rail (« À toi »). */
export interface LedgeHomeProps {
  client: DaemonClient; view: FleetView; relief: Relief; teams: TeamsApi; decisions: Decisions; waits: ReadonlyMap<string, Wait>;
  tab: HomeTab; nav: NavState; dispatch: (a: NavAction) => void;
  /** The task « Tâches » opens on (the sidebar's « Voir »). */
  task?: string;
  /** The session open in the atelier, and the atelier's project filter: where « Équipes »' catalog reads first (#97), on its machine (#99). */
  open?: Pick<Session, 'cwd' | 'machineId'>; atelierProject?: string;
  paused: boolean; focus: number;
  projects: Projects | null;
  onLaunched(id: string): void; onTerminal(id: string): void; notify(text: string): void; onProposal(pid: string): void;
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** A live team in one line: its name, project and seats, the progress of Ledge's tasks, and « Table » or « Reprendre »; with
 *  `onTemplate`, the template it was born of, a link to the catalog. */
function TeamLine({ team, teams, projects, dispatch, onTemplate }: { team: Team; teams: TeamsApi; projects: Projects | null; dispatch: (a: NavAction) => void; onTemplate?(id: string): void }): JSX.Element {
  const { t } = useI18n();
  const p = t.home.point;
  const { done, given } = ledgeProgress(teams.tasks, team.id);
  const room = teamProject(team, projects);
  const name = room ? projects?.projects.find(x => x.id === room)?.name : undefined;
  return (
    <div className={cls('lp-row lp-team', team.state === 'resting' && 'lp-resting')} data-team={team.id}>
      <span className="team-flag" aria-hidden>⚑</span>
      <span className="lp-text"><strong>{team.name}</strong> <small>{[name, p.seats(team.seats.filter(s => s.sessionId).length), team.state === 'resting' ? p.resting : null].filter(Boolean).join(' · ')}</small>
        {onTemplate && team.template && <small> · {t.home.catalog.fromTemplate} <button type="button" className="cat-goto" onClick={() => onTemplate(team.template!)}>{team.template}</button></small>}</span>
      <span className="lp-progress" title={p.progress(done, given)} aria-label={p.progress(done, given)}><i style={{ width: `${given ? Math.round((done / given) * 100) : 0}%` }} /></span>
      <small className="lp-count">{done}/{given}</small>
      {team.state === 'resting'
        ? <button type="button" className="st-qa" onClick={() => teams.resume(team.id)}>{p.resume}</button>
        : <button type="button" className="st-qa" onClick={() => dispatch({ type: 'home', ...(room ? { project: room } : {}) })}>{p.table}</button>}
    </div>
  );
}

/**
 * « Équipes » (#97): the live teams, as « Le point » shows them, and the catalog of a folder, its templates and its roles, read
 * from the local daemon at the view's opening and for each folder chosen. A live team's template and each `@role` lead there.
 */
function TeamsTab({ client, teams, sessions, projects, machines, dispatch, notify, open, atelierProject }: {
  client: DaemonClient; teams: TeamsApi; sessions: readonly Session[]; projects: Projects | null; machines: readonly CatalogMachine[]; dispatch: (a: NavAction) => void; notify(text: string): void;
  open?: Pick<Session, 'cwd' | 'machineId'>; atelierProject?: string;
}): JSX.Element {
  const { t } = useI18n();
  const c = t.home.catalog;
  const live = teams.teams ?? [];
  const byId = new Map(sessions.map(s => [s.id, s]));
  const [view, setView] = useState<TeamsView>('live');
  const [pick, setPick] = useState<CatalogPick>({});
  const [query, setQuery] = useState('');
  const [tick, setTick] = useState(0);
  const scope = useScope(projects, open?.cwd, atelierProject, open?.machineId);
  const listing = useCatalog(teams, scope.cwd, tick, scope.machine);
  const show = (next: TeamsView, nextPick: CatalogPick = { ...pick, problems: false }) => {
    setPick(nextPick);
    if (next !== view && next !== 'live') setTick(n => n + 1);
    setView(next);
  };
  // From a live team: its folder's catalog, on its template or one of its roles.
  const goto = (team: Team, next: 'roles' | 'templates', id: string) => {
    scope.choose(team.cwd, false, team.machine);
    setQuery('');
    show(next, next === 'roles' ? { role: id } : { template: id });
  };
  const known = listing && !listing.silent && !listing.error ? listing : null;
  const counts = { live: live.length, templates: known?.templates.length, roles: known?.roles.length };
  const ids = tabIds('home-teams', view);
  return (
    <div className="home-list home-teams" role="tabpanel" aria-label={t.home.tabs.teams(live.length)}>
      <div className="cat-toolbar">
        <Tabs id="home-teams" fit label={c.views} value={view} onChange={v => show(v)} tabs={(['live', 'templates', 'roles'] as const).map(v => ({ value: v, label: c[v](counts[v]) }))} />
        {view !== 'live' && <ScopePicker scope={scope} machines={machines} onChoose={(cwd, machine) => { scope.choose(cwd, true, machine); setPick({}); }} />}
        {view === 'roles' && <input type="search" className="cat-search" aria-label={c.filterLabel} placeholder={c.filter} value={query} onChange={e => setQuery(e.target.value)} />}
      </div>
      <div className="cat-panel" role="tabpanel" id={ids.panelId} aria-labelledby={ids.tabId}>
      {view === 'live' ? <>
        {live.length === 0 && <p className="lp-none">{t.home.teams.none}</p>}
        {live.map(team => (
          <section key={team.id} className="home-team">
            <TeamLine team={team} teams={teams} projects={projects} dispatch={dispatch} onTemplate={id => goto(team, 'templates', id)} />
            <ul>
              {team.seats.map(seat => {
                const s = seat.sessionId ? byId.get(seat.sessionId) : undefined;
                return (
                  <li key={seat.role}>
                    <button type="button" className="role-pill" title={c.seeRole(seat.role)} onClick={() => goto(team, 'roles', seat.role)}>@{seat.role}</button>
                    {s ? <button type="button" className="st-name" onClick={() => dispatch({ type: 'open', id: s.id })}>{s.name}</button> : <span className="lp-none">—</span>}
                    {s && <small>{t.stateLabel[stateKey(s)]}</small>}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </> : (
        <CatalogView ctx={{ client, teams, sessions, projects, machines, dispatch, notify }} view={view} cwd={scope.cwd} machine={scope.machine} listing={listing} pick={pick} query={view === 'roles' ? query : ''}
          onPick={(next, to) => { if (!to) return setPick(next); setQuery(''); show(to, next); }} onRetry={() => setTick(n => n + 1)} />
      )}
      </div>
    </div>
  );
}

type StateFilter = 'all' | 'open' | 'closed';
type GiverFilter = 'all' | 'ledge' | 'seats' | 'decisions';
/** Who a task comes from: Ledge, a seat for another, or a session asking the user (a decision, owner Ledge). */
const giverOf = (x: Task): Exclude<GiverFilter, 'all'> => x.owner === LEDGE_GIVER ? 'decisions' : x.giver === LEDGE_GIVER ? 'ledge' : 'seats';

/** « Tâches »: Ledge's tasks, the teams' own and the decisions put to the user, with filters (team, state, giver); a task opens
 *  on its detail and history, an open decision with « Répondre » too. */
function TasksTab({ teams, shown, onShow }: { teams: TeamsApi; shown: string | null; onShow(id: string | null): void }): JSX.Element {
  const { t } = useI18n();
  const c = t.home.tasks;
  const [state, setState] = useState<StateFilter>('all');
  const [giver, setGiver] = useState<GiverFilter>('all');
  const [team, setTeam] = useState<string>('all');
  const [answering, setAnswering] = useState<string | null>(null);
  const list = teams.tasks.filter(x => (state === 'all' || (state === 'open') !== taskClosed(x))
    && (giver === 'all' || giver === giverOf(x)) && (team === 'all' || x.team === team)).slice().reverse();
  const detail = shown ? teams.tasks.find(x => x.id === shown) : undefined;
  return (
    <div className="home-list" role="tabpanel" aria-label={t.home.tabs.tasks(teams.tasks.length)}>
      <div className="home-filters" role="group" aria-label={c.filters}>
        <select aria-label={c.filters} value={state} onChange={e => setState(e.target.value as StateFilter)}>
          <option value="all">{c.all}</option><option value="open">{c.open}</option><option value="closed">{c.closed}</option>
        </select>
        <select aria-label={c.giver} value={giver} onChange={e => setGiver(e.target.value as GiverFilter)}>
          <option value="all">{c.anyGiver}</option><option value="ledge">{c.ledge}</option><option value="seats">{c.seats}</option><option value="decisions">{c.decisions}</option>
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
          {openDecision(detail) && (answering === detail.id
            ? <DecisionAnswer task={detail} teams={teams} onClose={() => setAnswering(null)} />
            : <Button variant="primary" size="sm" onClick={() => setAnswering(detail.id)}>{t.decision.answer}</Button>)}
          <h4>{c.log}</h4>
          <ul>{detail.log.map((l, i) => <li key={i}><small>{clock(l.at)}</small> {l.by} : {l.what}</li>)}</ul>
          <Button variant="ghost" size="sm" onClick={() => onShow(null)}>{c.close}</Button>
        </section>
      )}
    </div>
  );
}

/**
 * The Ledge screen (spec §8, `c-A.png`), where the app opens: « Ledge. » and what it orchestrates, the tabs « Conversation · Rigs · n ·
 * Équipes · Tâches · Mandat », then the tab: Ledge's thread and its composer, the Rigs tab of lot 3, the Ledge teams and their
 * tasks (roles spec §3.9), or the Mandat tab (lot 7).
 */
export function LedgeHome(p: LedgeHomeProps): JSX.Element {
  const { client, view, teams, tab, dispatch } = p;
  const [shownTask, setShownTask] = useState<string | null>(p.task ?? null);
  const live = teams.teams ?? [];
  const { t } = useI18n();
  const theme = useTheme();
  const { reduced } = useMotionPreferences();
  const { chat } = useDaemon();
  const offline = !view.machines.find(m => m.id === 'local')?.ready;
  const allRigs = useRigs(client);
  const openrig = useOpenRig(client);
  const rigs = rigsCount(allRigs, openrig);
  const agents = useMemo(() => allSeats(visibleRigs(allRigs, openrig)).length, [allRigs, openrig]);
  const solo = useMemo(() => view.sessions.filter(s => isStandalone(s, allRigs)).length, [view.sessions, allRigs]);
  const orchestrating = openrig.some(s => s.state === 'running');
  const labels: Record<HomeTab, string> = { conversation: t.home.tabs.conversation, rigs: t.home.rigsCount(rigs), teams: t.home.tabs.teams(live.length),
    tasks: t.home.tabs.tasks(teams.tasks.filter(x => !taskClosed(x)).length), mandat: t.home.tabs.mandat };
  return (
    <section className="ledge-home" aria-label={t.side.ledgeHome}>
      <div className="home-column" data-tab={tab}>
        <div className="home-head">
          <ResidentMascot size={30} theme={theme} paused={p.paused} reducedMotion={p.paused || reduced} />
          <div className="home-title">
            <span data-brand className="home-brand">Ledge<span className="brand-dot">.</span></span>
            <span className="home-sub">{orchestrating ? t.home.header(rigs, agents, solo) : t.home.solo(solo)}</span>
          </div>
          <span className="st-fill" />
          <Button variant="ghost" size="icon" aria-label={t.chat.reset} title={t.chat.reset} disabled={offline || chat.length === 0} onClick={() => client.send({ type: 'chat.reset' })}><Icon {...ICONS.plus} /></Button>
          <Button variant="ghost" size="icon" aria-label={t.home.toAtelier} title={t.home.toAtelier} onClick={() => dispatch({ type: 'escape' })}><Icon {...ICONS.close} /></Button>
        </div>
        <div className="home-tabs" role="tablist" aria-label={t.home.tabsLabel}>
          {HOME_TABS.map(x => <button key={x} type="button" role="tab" aria-selected={tab === x} className={cls(tab === x && 'on')} onClick={() => dispatch({ type: 'ledge', tab: x })}>{labels[x]}</button>)}
        </div>
        <div className="home-body">
          {tab === 'conversation' && <LedgeConversation client={client} view={view} dispatch={dispatch} focus={p.focus} projects={p.projects} paused={p.paused} waits={p.waits} decisions={p.decisions}
            focusCard={p.nav.place.kind === 'home' ? p.nav.place.focus : undefined} onFocused={() => dispatch({ type: 'ledge-focused' })}
            onLaunched={p.onLaunched} onTerminal={p.onTerminal} notify={p.notify} onProposal={p.onProposal} />}
          {tab === 'rigs' && <RigsTab nav={p.nav} dispatch={dispatch} client={client} sessions={view.sessions} projects={p.projects} notify={p.notify} />}
          {tab === 'teams' && <TeamsTab client={client} teams={teams} sessions={view.sessions} projects={p.projects} machines={view.machines} dispatch={dispatch} notify={p.notify} open={p.open} atelierProject={p.atelierProject} />}
          {tab === 'tasks' && <TasksTab teams={teams} shown={shownTask} onShow={setShownTask} />}
          {tab === 'mandat' && <MandateTab client={client} view={view} />}
        </div>
      </div>
    </section>
  );
}
