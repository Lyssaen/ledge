import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { daemonStore, projectOf, useDaemon, useIsland, useMobile, useMobileError, useProjects, useTokenMissing, type DaemonClient } from '@ledge/fleet';
import type { Project, Projects, Session } from '@ledge/protocol';
import { LangProvider, loadLang, messagesFor, saveLang, useI18n, type Lang } from './i18n/lang';
import { loadMessages } from './i18n/messages';
import { useFleet } from './fleet/useFleet';
import { useDecisions } from './fleet/decisions';
import { useWaits } from './fleet/waits';
import { useAlerts, usePairingAlerts } from './notify/useAlerts';
import { watchedSession } from './notify/watching';
import { getDnd, setDnd, useDnd } from './notify/prefs';
import { MarkdownLinks } from '@ledge/ui/documents/links';
// The reader's styles stay in the first bundle, before app.css (as when the reader itself was there): session.css overrides them.
import '@ledge/ui/documents/markdown.css';
import { DaemonOutdated } from './shell/DaemonOutdated';
import { daemonTokenSource, onOpenTarget, onTrayAction, openUrl, setTrayLabels } from './tauri/bridge';
import { parseTarget, targetAction } from './open/target';
import { useAppearance } from './shell/theme';
import { initialNav, navReducer, reconcile, type NavAction, type NavState } from './nav/state';
import { loadOverview, saveOverview } from './nav/overview';
import { ScreenKeysContext, type ScreenKeys } from './nav/screenKeys';
import { mainOrder } from './nav/agents';
import { focusThread, useKeys } from './nav/useKeys';
import { Sidebar } from './shell/Sidebar';
import { TitleBar } from './shell/TitleBar';
import { TopBar } from './shell/TopBar';
import { Footer } from './shell/Footer';
import { LaunchPlace } from './launch/lazy';
import { ChatPlace, HomePlace } from './chat/lazy';
import { SettingsPlace } from './settings/lazy';
import type { SettingsContext } from './settings/SettingsPage';
import { daemonTarget, useDaemonUpdates } from './update/daemon';
import { useUpdate } from './update/store';
import { takeWhatsNew } from './update/notes';
import { openWhatsNew, useWhatsNew } from './update/whatsNewView';
import { WhatsNew } from './update/WhatsNew';
import { useLaunch } from './launch/useLaunch';
import { TeamLaunch } from './launch/TeamLaunch';
import { closedLedgeTasks, useTeamsApi } from './teams/useTeamsApi';
import { Atelier } from './atelier/Atelier';
import { AtelierAway } from './atelier/Away';
import { atelierOpen, attachAtelier, canDetach, detachAtelier, onAtelier, showMainWindow } from './atelier/detach';
import { Modal } from './shell/Modal';
import { SearchPalette } from './shell/SearchPalette';
import { ShortcutsHelp } from './shell/ShortcutsHelp';
import { useWindowFullscreen } from './shell/useWindowFullscreen';
import { Toast, useToast } from './shell/Toast';
import { preloadPlaces } from './shell/preload';
import { useFiling } from './atelier/filing';
import { useSessionActions } from './manage/useSessionActions';
import { useSessionMenu } from './manage/useSessionMenu';
import { SessionMenuHost } from './manage/SessionMenu';
import { ConfirmDialog } from './manage/ConfirmDialog';
import { loadedWorkspace, SessionPlace } from './session/lazy';
import { createSessionMemory } from './session/memory';
import { loadSessionPrefs, saveSessionPrefs } from './session/prefs';
import { subagentOf } from './session/exchanges';
import { useStored } from './state/useStored';
import { ptyBackend } from './term/backend';
import { agentTabId, TermStore } from './term/store';
import { termTheme } from './term/theme';
import { TermStoreContext } from './term/useTerms';
import { isNative } from './term/mode';
import { ProjectDialog } from './projects/ProjectDialog';
import { useDefaultTool } from './settings/tool';
import { PairingDialog, usePairingDialogState } from './settings/PairingDialog';

const NO_PROJECTS: readonly Project[] = [];

/** Ledge's terminal colours as the root's tokens give them now. */
const rootTermTheme = () => termTheme(getComputedStyle(document.documentElement));

/** The app's one terminal store: its shells and the agent's screen live as long as the window, whatever the place. Its xterms
 *  follow the theme once the root has taken it (`data-theme`, set by useAppearance after this component's own effects). */
function useTermStore(client: DaemonClient): TermStore {
  const [store] = useState(() => new TermStore({
    backend: ptyBackend(),
    // xterm comes with the session page's chunk (out of the first bundle): only its pane and Workspace make the store draw, so
    // the chunk is there by then. Its Ctrl + ² gives the keyboard back to the thread.
    surface: () => {
      const chunk = loadedWorkspace();
      if (!chunk) throw new Error('a terminal is drawn only once the session page has loaded');
      return chunk.createSurface({ theme: rootTermTheme(), onThread: focusThread, openUrl });
    },
    agentArgv: (id, readOnly) => client.fleet?.terminal(id, { readOnly }) ?? null,
    shellArgv: id => client.fleet?.shell(id) ?? null,
    // Shell 1 opens where the session works (its worktree, else its folder), over ssh when its machine is reached that way.
    shellPlace: id => {
      const { sessions, archived } = daemonStore.getState();
      const s = sessions.find(x => x.id === id) ?? archived.find(x => x.id === id);
      const machine = client.fleet?.machines().find(m => m.id === s?.machineId);
      return { dir: s ? s.workdir ?? s.cwd : '~', remote: !!machine?.ssh, native: !!s && isNative(s) };
    }
  }));
  useEffect(() => {
    const root = document.documentElement;
    const mo = new MutationObserver(() => store.setTheme(rootTermTheme()));
    mo.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, [store]);
  return store;
}

/** The navigation reducer, plus the fleet's corrections: a place naming a session or a project that is gone falls back. */
type ShellAction = NavAction | { type: 'reconcile'; sessions: readonly Session[]; projects: Projects | null };
const shellReducer = (s: NavState, a: ShellAction): NavState => (a.type === 'reconcile' ? reconcile(s, a.sessions, a.projects) : navReducer(s, a));

/** The Atelier's shell: sidebar, top bar, the current place (the atelier, a session, Settings), footer, chat and dialogs;
 *  the real fleet, toasts and sounds, and the tray. */
function Shell({ client, setLang }: { client?: DaemonClient; setLang(l: Lang): Promise<'ok' | 'failed'> }) {
  const fleetView = useFleet(client);
  const { sessions, machines, status, localDown, fleet, client: fleetClient, errors } = fleetView;
  const termStore = useTermStore(fleetClient);
  const projects = useProjects(fleetClient);
  const teams = useTeamsApi(fleetClient);
  const island = useIsland(fleetClient);
  const mobile = useMobile(fleetClient);
  const mobileError = useMobileError(fleetClient);
  const tokenMissing = useTokenMissing(daemonTokenSource());
  const { t, lang } = useI18n();
  const [nav, dispatch] = useReducer(shellReducer, undefined, () => initialNav(loadOverview()));
  // The header's Archived pill bumps this; Archives unfolds and scrolls on each change (0 never counts).
  const [revealArchives, setRevealArchives] = useState(0);
  // The session page's « N sous-agents » bumps this; the tree unfolds that session and scrolls to it (0 never counts).
  const [revealCurrent, setRevealCurrent] = useState(0);
  // Every machine's daemon follows Desktop on its own, or from Settings › About (#48); while one updates, its restart is expected and silent.
  const update = useUpdate();
  const daemonUpdates = useDaemonUpdates(fleet, machines, daemonTarget(update), update.app);
  // The first launch on a new version shows its notes, once (#26).
  useEffect(() => { const w = takeWhatsNew(update.app); if (w) openWhatsNew({ mode: 'updated', ...w }); }, [update.app]);
  const whatsNew = useWhatsNew() !== null;
  // Toasts and sounds from session changes (spec 2026-10-14 §10); `test()` is the Sounds section's Test.
  // Read at the moment an alert fires, never captured: set below once the place and the prefs are known.
  const watching = useRef<() => string | null>(() => null);
  const alerts = useAlerts({ sessions, machines, status, daemonUpdating: daemonUpdates.updating.has('local') }, { watching: () => watching.current() });
  // A device asking to be linked: the dialog below opens on any screen, the notification only while Desktop is behind.
  usePairingAlerts(mobile);
  // Decided here, at render: the dialog and the `inert` below change in one commit, so the Modal's focus return is not refused.
  const pairing = usePairingDialogState(mobile);
  // The tray's « Nouvelle session » opens its dialog; « Ne pas déranger » switches without showing the window.
  useEffect(() => onTrayAction(action => {
    if (action === 'dnd') setDnd(!getDnd());
    else if (action === 'new') dispatch({ type: 'modal', modal: { kind: 'launch' } });
  }), []);
  // Whether the terminal shows beside a session: it follows from one agent to the next and survives a restart.
  const [sessionPrefs, setSessionPrefs] = useStored(loadSessionPrefs, saveSessionPrefs);
  // Every « Terminal » (the session menu, a chat card, the island) opens the session's page with its pane, on the agent's tab.
  const showTerminal = useCallback((id: string) => {
    dispatch({ type: 'open', id });
    setSessionPrefs(x => ({ ...x, terminal: true }));
    termStore.select(id, agentTabId(id));
  }, [setSessionPrefs, termStore]);
  // « Open in Ledge » from the island: the shell has already brought the window forward; this shows what was asked.
  useEffect(() => onOpenTarget(raw => {
    const target = parseTarget(raw);
    if (target?.kind === 'terminal') showTerminal(target.id);
    else if (target) dispatch(targetAction(target));
  }), [showTerminal]);
  // The Atelier in its own window (#21): what it opens shows here, this window brought forward; its closing gives it back.
  const [detached, setDetached] = useState(false);
  useEffect(() => {
    void atelierOpen().then(open => { if (open) setDetached(true); });
    return onAtelier({ action: a => { dispatch(a); showMainWindow(); }, terminal: id => { showTerminal(id); showMainWindow(); }, closed: () => setDetached(false) });
  }, [showTerminal]);
  const detach = () => { void detachAtelier().then(ok => { if (ok) setDetached(true); }); };
  const attach = () => { attachAtelier(); setDetached(false); };
  // The tray speaks the app's language and names the way back from do not disturb.
  const [dnd] = useDnd();
  useEffect(() => {
    setTrayLabels({ open: t.tray.open, newSession: t.tray.newSession, dnd: dnd ? t.tray.dndOff : t.tray.dnd, quit: t.tray.quit });
  }, [t, dnd]);

  const { place } = nav;
  const view = place.kind === 'settings' ? place.back.view : place.view;
  // Only the overview preferences survive a restart, never the place.
  useEffect(() => { saveOverview({ view, helpers: nav.helpers, paused: nav.paused }); }, [view, nav.helpers, nav.paused]);
  // A session or a project that went away takes the place back to what still exists (only a fleet change can make it
  // stale, hence the dependencies); reconcile returns the same state when nothing changes, and then nothing is dispatched.
  // An archived session keeps its page (it reads, read-only): only a session the daemon no longer lists at all takes the place away.
  const known = useMemo(() => [...sessions, ...fleetView.archived], [sessions, fleetView.archived]);
  useEffect(() => { if (reconcile(nav, known, projects) !== nav) dispatch({ type: 'reconcile', sessions: known, projects }); }, [known, projects]);

  const projectIdOf = useCallback((s: Session) => (projects ? projectOf(s, projects) : null), [projects]);
  const projectName = useCallback((s: Session) => {
    const id = projectIdOf(s);
    return (id && projects?.projects.find(p => p.id === id)?.name) || t.side.unassigned;
  }, [projectIdOf, projects, t]);
  const waits = useWaits(sessions);
  const order = useMemo(() => mainOrder(sessions, projects), [sessions, projects]);
  // Putting an agent away: drag and drop or « Ranger dans… » write a folder rule; the toast says how it went.
  const { notice, action: noticeAction, notify, undo } = useToast();
  const filing = useFiling({ fleet, projects, sessions, projectIdOf, notify });
  // Allow / Deny from the session (and the sidebar): one send per request; a refusal or a silence is said in the toast.
  // End, archive, resume, restore, delete (lot 8): the confirmation below; the atelier and the session page hand it their menus.
  const actions = useSessionActions({ client: fleetClient, sessions, archived: fleetView.archived, machines, errors, notify });
  // The session menu, from the atelier's seats and the session page's header « … » (one at a time).
  const sessionMenu = useSessionMenu({ client: fleetClient, sessions, onShowTerminal: showTerminal });
  const decisions = useDecisions({ client: fleetClient, sessions, errors, notify });
  // The sidebar's Ask Ledge, the same send as the chat panel: nothing goes out while the local daemon is offline (the chat still opens).
  const [tool] = useDefaultTool();
  const askLedge = (text: string) => {
    if (!fleetView.machines.find(m => m.id === 'local')?.ready) { dispatch({ type: 'ledge', tab: 'conversation' }); return; }
    const qid = `q-${crypto.randomUUID()}`;
    daemonStore.beginTurn({ qid, question: text, askedAt: new Date().toISOString(), steps: [] });
    fleetClient.send({ type: 'chat.ask', qid, text, tool });
  };
  const screenKeys = useRef<ScreenKeys>({ current: null }).current;
  // Drafts, reading positions and the last item seen, per session and subagent: they survive navigation, not a restart.
  const memory = useRef(createSessionMemory()).current;
  useWindowFullscreen(nav.fullscreen, () => dispatch({ type: 'fullscreen', on: false }));
  const session = place.kind === 'session' ? known.find(s => s.id === place.id) ?? null : null;
  // Ledge shows the agent's screen (focused window, pane open, agent tab active): that is the terminal in front, no sound.
  watching.current = () => (place.kind === 'session' && session ? watchedSession({ focused: document.hasFocus(), terminal: sessionPrefs.terminal, placeId: place.id, helper: place.helper, active: termStore.active(place.id), agentTab: agentTabId(place.id) }) : null);
  // The subagent whose page is open, found as the Workspace finds it (live, else its thread row), for the top bar.
  const { threads } = useDaemon();
  const helper = session && place.kind === 'session' && place.helper !== undefined ? subagentOf(session, threads.get(session.id), place.helper, t.session.subagent) : null;
  useEffect(preloadPlaces, []);
  const toggleTerminal = useCallback(() => setSessionPrefs(p => ({ ...p, terminal: !p.terminal })), [setSessionPrefs]);
  // Ctrl + ² from outside the terminal: it shows if hidden, then its open tab takes the keyboard. A pane just asked for draws
  // its xterm in the renders this key starts, so the focus waits for the next frame.
  const toTerminal = () => {
    if (place.kind !== 'session' || !session) return false;
    const id = place.id;
    if (!sessionPrefs.terminal) setSessionPrefs(p => ({ ...p, terminal: true }));
    requestAnimationFrame(() => termStore.surface(termStore.active(id))?.focus());
    return true;
  };
  // The pairing dialog, like a confirmation, owns the keyboard while it shows (it takes Escape itself, before this listener).
  useKeys(dispatch, { state: nav, order, screen: screenKeys, undo, confirming: actions.pending ? { cancel: actions.cancel } : pairing ? { cancel: pairing.dismiss } : null, toTerminal });
  const close = () => dispatch({ type: 'modal', modal: null });
  const onOverview = place.kind === 'overview' || (place.kind === 'session' && !session);
  // The New session form starts on the overview's project filter (a project id, not « all » nor « none »).
  const base = place.kind === 'settings' ? place.back : place;
  const filter = base.project !== 'all' && base.project !== 'none' ? base.project : undefined;
  // Launching from the form: one at a time, nothing optimistic. Once the daemon says launched, the form closes, the filter
  // shows the launch's table, the seat lights and the notice names who starts where.
  const launched = useRef<{ name: string; project: string; projectId: string } | null>(null);
  const launcher = useLaunch(fleetView, id => {
    const preview = launched.current;
    // The table is the launched session's own, once listed (the daemon lists it before answering), or none (« Sans projet »: the
    // form's project is no table then, as for a chat card); the preview's until then.
    const s = sessions.find(x => x.id === id);
    const ownId = s ? projectIdOf(s) : null;
    const own = ownId ? projects?.projects.find(p => p.id === ownId) : undefined;
    const table = own ? { id: own.id, name: own.name } : s ? { id: 'none', name: null } : preview ? { id: preview.projectId, name: preview.project } : null;
    dispatch({ type: 'modal', modal: null });
    // Only the overview's filter follows; a session page (the sidebar's « New session in … ») stays where it is.
    if (place.kind === 'overview' && place.project !== 'all' && place.project !== table?.id) dispatch({ type: 'home', project: 'all' });
    filing.markSeated(id);
    const name = s?.name ?? preview?.name ?? '';
    if (table) notify(table.name !== null ? t.launch.started(name, table.name) : t.launch.startedNoTable(name));
  });
  // A chat card's session started (the daemon listed it before answering): the chat stays open; if the current filter hides its
  // table, the filter goes back to All without leaving the page; the seat lights and the notice names who starts where (lot 7's words),
  // or says it starts with no project (not mapped yet, or « Sans projet »: the proposal's folder name is no table). Not listed: nothing
  // to show, so the filter stays and there is no notice.
  const chatLaunched = (id: string) => {
    const s = sessions.find(x => x.id === id);
    filing.markSeated(id);
    if (!s) return;
    const table = projectIdOf(s) ?? 'none';
    if (base.project !== 'all' && base.project !== table) dispatch({ type: 'filter', project: 'all' });
    const own = projects?.projects.find(p => p.id === table)?.name;
    notify(own ? t.launch.started(s.name, own) : t.launch.startedNoTable(s.name));
  };
  // The form closed (Escape, Cancel, another dialog): nothing is waited for any more; a late answer is not announced.
  const { reset: resetLaunch } = launcher;
  useEffect(() => { if (nav.modal?.kind !== 'launch') resetLaunch(); }, [nav.modal?.kind, resetLaunch]);
  // A chat card's project proposal (lot 11): the editor opens on it, as Settings › Projects' « Review » does; nothing is written before its button.
  const openProposal = useCallback((pid: string) => dispatch({ type: 'modal', modal: { kind: 'project', proposal: pid } }), []);
  // A project the daemon confirmed: the editor closes and the notice says what happened (with the agents filed, for a new one).
  const projectSaved = (id: string, created: boolean, filed: Session[]) => {
    dispatch({ type: 'modal', modal: null });
    const name = projects?.projects.find(p => p.id === id)?.name ?? id;
    notify(!created ? t.projects.saved(name)
      : filed.length > 0 ? t.projects.createdWith(name, filed.map(s => s.name))
      : t.projects.created(name));
  };

  // A deletion the daemon confirmed: the editor closes; a filter on the deleted project goes back to All, wherever we are
  // (a session page stays open, its agent now elsewhere); the notice says where its agents went.
  const projectDeleted = (id: string, name: string, moveTo: string | null, agents: number) => {
    dispatch({ type: 'modal', modal: null });
    if (base.project === id) dispatch({ type: 'filter', project: 'all' });
    const d = t.projects.delete;
    const to = moveTo === null ? null : projects?.projects.find(p => p.id === moveTo)?.name ?? moveTo;
    notify(d.done(name) + (agents === 0 ? '' : to === null ? d.doneNone(agents) : d.doneMoved(agents, to)));
  };

  // What the Settings page's sections receive; « Setting saved · … » goes through the app's toast, once per accepted change
  // (in the language just chosen, for the language itself: the render that speaks it has not happened yet).
  const settings: SettingsContext = {
    notify, saved: (what, l) => notify((l ? messagesFor(l) : t).settings.saved(what)), fleet, client: fleetClient, machines, projects, island, mobile, mobileError, projectIdOf, sessions, dispatch, alerts, daemonUpdates,
    lang, setLang, paused: nav.paused
  };

  // A dialog over the application (a modal, a confirmation, the rename dialog): what lies behind it, the title bar's controls
  // included, takes neither clicks nor the focus.
  const blocked = nav.modal !== null || actions.pending !== null || sessionMenu.renaming !== null || whatsNew || pairing !== null;
  return (
    <ScreenKeysContext.Provider value={screenKeys}><TermStoreContext.Provider value={termStore}>
      {!nav.fullscreen && <TitleBar dispatch={dispatch} sessions={sessions} waits={waits} blocked={blocked} />}
      <div className={`application ${nav.fullscreen ? 'immersive' : ''} ${filing.dragging ? 'is-dragging' : ''}`} data-readonly={localDown ? 'true' : undefined} inert={blocked}>
        <Sidebar nav={nav} dispatch={dispatch} sessions={sessions} archived={fleetView.archived} machines={machines} updating={daemonUpdates.updating} projects={projects} order={order} projectIdOf={projectIdOf} filing={filing}
          actions={actions} decisions={decisions} waits={waits} menu={{ open: (id, at, opener) => sessionMenu.open(id, at, opener ?? null) }}
          onAsk={askLedge} onTerminal={sessionMenu.terminal} revealArchives={revealArchives} revealCurrent={revealCurrent}
          ledge={{ closedTasks: closedLedgeTasks(teams.tasks).length, activeTeams: (teams.teams ?? []).filter(x => x.state === 'active').length }} teams={teams} />
        <section className="workspace">
          {tokenMissing && <DaemonOutdated />}
          <TopBar nav={nav} dispatch={dispatch} session={session} helper={helper} projects={projects} projectIdOf={projectIdOf} terminal={sessionPrefs.terminal} onTerminal={toggleTerminal}
            onRevealArchives={() => setRevealArchives(n => n + 1)} onDetach={canDetach() && !detached ? detach : undefined} teamOf={teams.teamOf}
            manage={{ open: sessionMenu.menu?.id === session?.id && sessionMenu.menu !== null, onOpen: (at, opener) => session && sessionMenu.open(session.id, at, opener) }} />
          {place.kind === 'settings' ? <SettingsPlace section={place.section} ctx={settings} />
            : place.kind === 'home' ? <HomePlace label={t.side.ledgeHome} client={fleetClient} view={fleetView} teams={teams} decisions={decisions} waits={waits} tab={place.tab} task={place.task} dispatch={dispatch}
                paused={nav.paused} focus={nav.chatFocus} projects={projects} onLaunched={chatLaunched} onTerminal={showTerminal} notify={notify} onProposal={openProposal} />
            : session && place.kind === 'session' ? <SessionPlace client={fleetClient} session={session} nav={nav} dispatch={dispatch} decisions={decisions} waits={waits} memory={memory} notify={notify} actions={actions} teams={teams}
                prefs={sessionPrefs} setPrefs={setSessionPrefs} onRevealCurrent={() => setRevealCurrent(n => n + 1)} />
            : detached ? <AtelierAway onShow={detach} onAttach={attach} />
            : <Atelier nav={nav} dispatch={dispatch} sessions={sessions} projects={projects} order={order} projectIdOf={projectIdOf} filing={filing} actions={actions} menu={sessionMenu}
                teams={teams} archived={fleetView.archived} notify={notify} />}
          {(onOverview || place.kind === 'home') && <Footer dispatch={dispatch} localDown={localDown} island={island} />}
        </section>
        {nav.chat && (
          <ChatPlace label={t.side.chat} client={fleetClient} view={fleetView} paused={nav.paused} focus={nav.chatFocus} onClose={() => dispatch({ type: 'chat', open: false })}
            onOpenSession={id => dispatch({ type: 'open', id })} onTerminal={showTerminal} onLaunched={chatLaunched}
            projects={projects} notify={notify} onProposal={openProposal} onOpenTeam={room => dispatch({ type: 'home', ...(room ? { project: room } : {}) })} />
        )}
      </div>
      {nav.modal?.kind === 'search' && <SearchPalette sessions={sessions} projectName={projectName} order={order} onOpen={id => dispatch({ type: 'open', id })} onClose={close} />}
      {nav.modal?.kind === 'shortcuts' && <ShortcutsHelp onClose={close} />}
      {nav.modal?.kind === 'launch' && nav.modal.team && projects?.projects.find(x => x.id === (nav.modal as { project?: string }).project) && (() => {
        const room = projects.projects.find(x => x.id === (nav.modal as { project?: string }).project)!;
        return (
          <Modal title={t.teamLaunch.title(room.name)} wide onClose={close}>
            <TeamLaunch client={fleetClient} teams={teams} project={room} onCancel={close}
              onLaunched={team => { close(); dispatch({ type: 'home', project: room.id }); notify(t.teamLaunch.launched(team.name, room.name)); }} />
          </Modal>
        );
      })()}
      {nav.modal?.kind === 'launch' && !nav.modal.team && (
        <Modal title={t.modalTitles.launch} wide onClose={close}>
          <LaunchPlace client={fleetClient} projects={projects?.projects ?? NO_PROJECTS} machines={machines} sessions={sessions} projectIdOf={projectIdOf}
            wanted={{ ...(nav.modal.project !== undefined && { project: nav.modal.project }), ...(filter && { filter }) }}
            onEditProject={id => dispatch({ type: 'modal', modal: { kind: 'project', edit: id } })} onNewProject={() => dispatch({ type: 'modal', modal: { kind: 'project' } })}
            launch={launcher.state} onLaunch={(msg, preview) => { launched.current = preview; launcher.launch(msg); }} onCancel={close} paused={nav.paused} />
        </Modal>
      )}
      {nav.modal?.kind === 'project' && (
        <ProjectDialog key={`${nav.modal.edit ?? ''}|${nav.modal.file ?? ''}|${nav.modal.delete ? 'delete' : ''}|${nav.modal.proposal ?? ''}`} edit={nav.modal.edit} file={nav.modal.file} startDeleting={nav.modal.delete}
          proposal={nav.modal.proposal} projects={projects} sessions={sessions} machines={machines} client={fleetClient} fleet={fleet} projectIdOf={projectIdOf} paused={nav.paused}
          notify={notify} onClose={close} onSaved={projectSaved} onDeleted={projectDeleted} />
      )}
      <SessionMenuHost state={sessionMenu} actions={actions} filing={filing} projects={projects?.projects ?? NO_PROJECTS} currentOf={projectIdOf} onOpen={s => dispatch({ type: 'open', id: s.id })} onHandover={s => { void teams.handover(s.id); }} />
      <WhatsNew />
      {actions.pending && <ConfirmDialog c={actions.pending} onConfirm={actions.confirm} onCancel={actions.cancel} />}
      <PairingDialog shown={pairing} mobile={mobile} fleet={fleet} notify={notify} />
      <Toast notice={notice} action={noticeAction} onAction={undo} />
    </TermStoreContext.Provider></ScreenKeysContext.Provider>
  );
}

/** `lang` is the language the entry point's boot settled on (French when the stored one's strings did not load); else the stored one. */
export function App({ client, lang: booted }: { client?: DaemonClient; lang?: Lang } = {}) {
  const [lang, setLangState] = useState<Lang>(() => booted ?? loadLang());
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useAppearance();
  // Settings › General: the language's strings load first (messages.ts serves French under a language not loaded yet); if they
  // do not, the language stays as it is. Then it is kept and the whole app, <html lang> and the tray follow.
  const setLang = useCallback(async (l: Lang): Promise<'ok' | 'failed'> => {
    try { await loadMessages(l); } catch { return 'failed'; }
    saveLang(l);
    setLangState(l);
    return 'ok';
  }, []);
  return <LangProvider lang={lang}><MarkdownLinks.Provider value={openUrl}><Shell client={client} setLang={setLang} /></MarkdownLinks.Provider></LangProvider>;
}
