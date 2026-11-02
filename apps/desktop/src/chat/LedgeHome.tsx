import { useMemo, useState, type JSX } from 'react';
import { useDaemon, useOpenRig, useRigs, type DaemonClient } from '@ledge/fleet';
import type { Projects, Session } from '@ledge/protocol';
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
import { useEngine } from '../rigs/engine';
import type { Relief } from '../session/useRelief';
import type { TeamsApi } from '../teams/useTeamsApi';
import { CatalogView, ScopePicker, useCatalog, useScope, type CatalogMachine, type CatalogPick, type TeamsView } from '../teams/Catalog';
import type { Wait } from '../list/time';
import { LedgeConversation } from './LedgeConversation';
import { MandateTab } from './mandate/MandateTab';

/** `decisions` and `waits` feed the rail (« À toi »). */
export interface LedgeHomeProps {
  client: DaemonClient; view: FleetView; relief: Relief; teams: TeamsApi; decisions: Decisions; waits: ReadonlyMap<string, Wait>;
  tab: HomeTab; nav: NavState; dispatch: (a: NavAction) => void;
  /** The session open in the atelier, and the atelier's project filter: where « Modèles »' catalog reads first (#97), on its machine (#99). */
  open?: Pick<Session, 'cwd' | 'machineId'>; atelierProject?: string;
  paused: boolean; focus: number;
  projects: Projects | null;
  onLaunched(id: string): void; onTerminal(id: string): void; notify(text: string): void; onProposal(pid: string): void;
}

/**
 * « Modèles » (#97, lot F): main's catalog of a folder, its templates and its roles, and the files skipped; read from the folder's machine
 * at the view's opening and for each folder chosen. The live teams are the « Équipes » tab's, whatever the engine.
 */
function ModelsTab({ client, teams, sessions, projects, machines, dispatch, notify, open, atelierProject }: {
  client: DaemonClient; teams: TeamsApi; sessions: readonly Session[]; projects: Projects | null; machines: readonly CatalogMachine[]; dispatch: (a: NavAction) => void; notify(text: string): void;
  open?: Pick<Session, 'cwd' | 'machineId'>; atelierProject?: string;
}): JSX.Element {
  const { t } = useI18n();
  const c = t.home.catalog;
  const [view, setView] = useState<TeamsView>('templates');
  const [pick, setPick] = useState<CatalogPick>({});
  const [query, setQuery] = useState('');
  const [tick, setTick] = useState(0);
  const scope = useScope(projects, open?.cwd, atelierProject, open?.machineId);
  const listing = useCatalog(teams, scope.cwd, tick, scope.machine);
  const show = (next: TeamsView, nextPick: CatalogPick = { ...pick, problems: false }) => {
    setPick(nextPick);
    if (next !== view) setTick(n => n + 1);
    setView(next);
  };
  const known = listing && !listing.silent && !listing.error ? listing : null;
  const counts = { templates: known?.templates.length, roles: known?.roles.length };
  const ids = tabIds('home-models', view);
  return (
    <div className="home-list home-teams" role="tabpanel" aria-label={t.home.tabs.models}>
      <div className="cat-toolbar">
        <Tabs id="home-models" fit label={c.views} value={view} onChange={v => show(v)} tabs={(['templates', 'roles'] as const).map(v => ({ value: v, label: c[v](counts[v]) }))} />
        <ScopePicker scope={scope} machines={machines} onChoose={(cwd, machine) => { scope.choose(cwd, true, machine); setPick({}); }} />
        {view === 'roles' && <input type="search" className="cat-search" aria-label={c.filterLabel} placeholder={c.filter} value={query} onChange={e => setQuery(e.target.value)} />}
      </div>
      <div className="cat-panel" role="tabpanel" id={ids.panelId} aria-labelledby={ids.tabId}>
        <CatalogView ctx={{ client, teams, sessions, projects, machines, dispatch, notify }} view={view} cwd={scope.cwd} machine={scope.machine} listing={listing} pick={pick} query={view === 'roles' ? query : ''}
          onPick={(next, to) => { if (!to) return setPick(next); setQuery(''); show(to, next); }} onRetry={() => setTick(n => n + 1)} />
      </div>
    </div>
  );
}

/**
 * The Ledge screen (spec §8, `c-A.png`), where the app opens: « Ledge. » and what it orchestrates, the tabs « Conversation · Équipes · n ·
 * Modèles · Mandat » (lot F), then the tab: Ledge's thread and its composer, the teams of either engine (the Rigs tab of lot 3), main's
 * catalog of templates and roles, or the Mandat tab (lot 7).
 */
export function LedgeHome(p: LedgeHomeProps): JSX.Element {
  const { client, view, teams, tab, dispatch } = p;
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
  // What Ledge orchestrates: OpenRig's rigs while OpenRig runs, or Ledge's own teams once there is one.
  const ledge = useEngine(client) === 'ledge';
  const orchestrating = ledge ? rigs > 0 : openrig.some(s => s.state === 'running');
  const labels: Record<HomeTab, string> = { conversation: t.home.tabs.conversation, rigs: t.home.rigsCount(rigs), models: t.home.tabs.models, mandat: t.home.tabs.mandat };
  return (
    <section className="ledge-home" aria-label={t.side.ledgeHome}>
      <div className="home-column" data-tab={tab}>
        <div className="home-head">
          <ResidentMascot size={30} theme={theme} paused={p.paused} reducedMotion={p.paused || reduced} />
          <div className="home-title">
            <span data-brand className="home-brand">Ledge<span className="brand-dot">.</span></span>
            <span className="home-sub">{!orchestrating ? t.home.solo(solo) : ledge ? t.home.headerLedge(rigs, agents, solo) : t.home.header(rigs, agents, solo)}</span>
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
          {tab === 'models' && <ModelsTab client={client} teams={teams} sessions={view.sessions} projects={p.projects} machines={view.machines} dispatch={dispatch} notify={p.notify} open={p.open} atelierProject={p.atelierProject} />}
          {tab === 'mandat' && <MandateTab client={client} view={view} />}
        </div>
      </div>
    </section>
  );
}
