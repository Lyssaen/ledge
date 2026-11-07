import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { canBroadcast, daemonStore, projectOf, splitId, useDaemon, type BroadcastTo, useIsland, useMobile, useMobileError, useProjects, useTokenMissing, type DaemonClient } from '@ledge/fleet';
import { isOmpSeat, type Project, type Projects, type Session } from '@ledge/protocol';
import { LangProvider, loadLang, messagesFor, saveLang, useI18n, type Lang } from './i18n/lang';
import { loadMessages } from './i18n/messages';
import { useFleet } from './fleet/useFleet';
import { useDecisions } from './fleet/decisions';
import { useWaits } from './fleet/waits';
import { useAlerts, usePairingAlerts, useUsageNotify } from './notify/useAlerts';
import { watchedSession, watchedTab } from './notify/watching';
import { getDnd, setDnd, useDnd } from './notify/prefs';
import { MarkdownLinks } from '@ledge/ui/documents/links';
// The reader's styles stay in the first bundle, before app.css (as when the reader itself was there): session.css overrides them.
import '@ledge/ui/documents/markdown.css';
import { DaemonOutdated } from './shell/DaemonOutdated';
import { daemonTokenSource, onOpenTarget, onTrayAction, openUrl, setTrayLabels } from './tauri/bridge';
import { parseTarget, targetAction } from './open/target';
import { useAppearance } from './shell/theme';
import { initialNav, navReducer, reconcile, type NavAction, type NavState, type SectionId } from './nav/state';
import { loadOverview, saveOverview } from './nav/overview';
import { ScreenKeysContext, type ScreenKeys } from './nav/screenKeys';
import { dotOf, mainOrder } from './nav/agents';
import { focusThread, useKeys, type IdeKeys } from './nav/useKeys';
import { Sidebar } from './shell/Sidebar';
import { TitleBar, waitingSessions } from './shell/TitleBar';
import { TopBar } from './shell/TopBar';
import { Footer } from './shell/Footer';
import { UsageFooter } from './usage/UsageFooter';
import { useUsageView } from './usage/useUsageView';
import { resetLong } from './usage/model';
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
import { closedLedgeTasks, useTasksApi } from './tasks/useTasksApi';
import { Atelier } from './atelier/Atelier';
import { OpenRigPage } from './openrig/OpenRigPage';
import { useOpenRigAsks } from '@ledge/fleet/openrigAsks';
import { useSidebarOpenRig } from './openrig/sidebarState';
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
import { useContextMenu } from './manage/useContextMenu';
import { SessionMenuHost, type SessionMenuIde } from './manage/SessionMenu';
import { ConfirmDialog } from './manage/ConfirmDialog';
import { BroadcastDialog } from './broadcast/BroadcastDialog';
import { AgentTerminalPlace, ChangesPlace, loadedWorkspace, SessionPlace } from './session/lazy';
import { createSessionMemory } from './session/memory';
import { loadSessionPrefs, saveSessionPrefs, viewShown, type SessionPrefs, type SessionView } from './session/prefs';
import { subagentOf } from './session/exchanges';
import { useStored } from './state/useStored';
import { ptyBackend } from './term/backend';
import { paintScreen } from './term/paint';
import { TermStore } from './term/store';
import { agentRoute, createAgentStream, createShellStream } from './term/stream';
import { focusAgentView } from './session/agentFocus';
import { termTheme } from './term/theme';
import { TermStoreContext } from './term/useTerms';
import { ProjectDialog } from './projects/ProjectDialog';
import { PairingDialog, usePairingDialogState } from './settings/PairingDialog';
import { useIdeEnabled } from './workspace/prefs';
import { useOpenSession } from './workspace/openPrefs';
import { ATELIER_TAB, SETTINGS_TAB, createWorkspaceStore, openrigTab, useWorkspace } from './workspace/store';
import { layoutFor, loadLayout, saveLayout, type LayoutAction } from './workspace/layout';
import { agentTerminalTab, beside, changesBeside, closeGroup, cycleTab, emptyProposals, find as findTab, focusGroup, focusNth, focused, keyOf, moveActive, open as openTab, sessionOf, reconcile as reconcileTabs, setView, split as splitGroup, type Tab } from './workspace/model';
import { hasTerminal, projectLabel, tabAlert, tabView } from './workspace/sessionTab';
import { ChangesTabLabel, SessionTabLabel } from './ide/SessionTabLabel';
import { TabMenu } from './ide/TabMenu';
import { EmptyGroup, type EmptyPick } from './ide/EmptyGroup';
import { routeNav, tabNav } from './workspace/route';
import { tabTitle, type TabBody } from './ide/tabs';
import { IdeDock, IdePlace } from './ide/lazy';

const NO_PROJECTS: readonly Project[] = [];

/** Ledge's terminal colours as the root's tokens give them now. */
const rootTermTheme = () => termTheme(getComputedStyle(document.documentElement));

/** The app's one terminal store: its shells and the agent's screen live as long as the window, whatever the place. Its xterms
 *  follow the theme once the root has taken it (`data-theme`, set by useAppearance after this component's own effects). */
function useTermStore(client: DaemonClient, onThread: () => void): TermStore {
  const [store] = useState(() => new TermStore({
    backend: ptyBackend(),
    // xterm comes with the session page's chunk (out of the first bundle): only its pane and Workspace make the store draw, so
    // the chunk is there by then. Its Ctrl + ² gives the keyboard back to the session's left view (App's termThread).
    surface: () => {
      const chunk = loadedWorkspace();
      if (!chunk) throw new Error('a terminal is drawn only once the session page has loaded');
      return chunk.createSurface({ theme: rootTermTheme(), onThread, openUrl });
    },
    agentArgv: (id, readOnly) => client.fleet?.terminal(id, { readOnly }) ?? null,
    // The harness pane, once the machine says it can stream it. Until the snapshot arrives, nothing attaches.
    agentRoute: id => {
      const { sessions, archived } = daemonStore.getState();
      const s = sessions.find(x => x.id === id) ?? archived.find(x => x.id === id);
      return agentRoute(s, client.fleet?.machines().find(m => m.id === (s?.machineId ?? 'local')));
    },
    stream: createAgentStream(client, paintScreen),
    shellStream: createShellStream(client, paintScreen),
    shellArgv: id => client.fleet?.shell(id) ?? null,
    // A first shell opens where the session works (its worktree, else its folder), over ssh when its machine is reached that way.
    shellPlace: id => {
      const { sessions, archived } = daemonStore.getState();
      const s = sessions.find(x => x.id === id) ?? archived.find(x => x.id === id);
      const machine = client.fleet?.machines().find(m => m.id === s?.machineId);
      return { dir: s ? s.workdir ?? s.cwd : '~', remote: !!machine?.ssh };
    }
  }));
  useEffect(() => {
    const root = document.documentElement;
    const mo = new MutationObserver(() => store.setTheme(rootTermTheme()));
    mo.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, [store]);
  useEffect(() => client.fleet?.subscribe(() => store.refreshAgent()), [client, store]);
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
  // Ctrl + ² inside an xterm, set below once the place is known (the store's surfaces are made once).
  const termThread = useRef<() => void>(focusThread);
  const termStore = useTermStore(fleetClient, () => termThread.current());
  const projects = useProjects(fleetClient);
  const tasksApi = useTasksApi(fleetClient);
  // « À toi »: what OpenRig's rigs ask the person, on this computer (lot 1: one machine), once its daemon reads them.
  const localMachine = machines.find(m => m.id === 'local');
  const asks = useOpenRigAsks(fleetClient, localMachine?.ready && localMachine.daemon?.openrigAsks ? 'local' : null);
  const [askFocus, setAskFocus] = useState<{ id: string; n: number } | null>(null);
  const island = useIsland(fleetClient);
  const usage = useUsageView(fleetClient, machines);
  const footMachines = useMemo(() => machines.map(m => ({ id: m.id, label: m.label, offline: m.status === 'unreachable', count: sessions.filter(s => (s.machineId ?? 'local') === m.id).length })), [machines, sessions]);
  const mobile = useMobile(fleetClient);
  const mobileError = useMobileError(fleetClient);
  const sidebarOpenRig = useSidebarOpenRig(fleetClient, machines);
  const tokenMissing = useTokenMissing(daemonTokenSource());
  const { t, lang } = useI18n();
  const [nav, navDispatch] = useReducer(shellReducer, undefined, () => initialNav(loadOverview()));
  // « Interface IDE (aperçu) » (Settings › General): its tabs (`ledge.ide.workspace`) and panels (`ledge.ide.layout`).
  const [ide] = useIdeEnabled();
  const [wsStore] = useState(() => createWorkspaceStore());
  const ws = useWorkspace(wsStore);
  const [layout, setLayout] = useStored(loadLayout, saveLayout);
  // Asking for the right panel folds the sidebar when that is what gives it room (layoutFor).
  const onLayout = useCallback((a: LayoutAction) => setLayout(l => layoutFor(l, a, window.innerWidth)), [setLayout]);
  const [openSession] = useOpenSession();
  const ideNow = useRef({ ide, nav, openSession });
  ideNow.current = { ide, nav, openSession };
  // What every child dispatches. Switch off: the navigation reducer, as ever. On: the action routed (routeNav) to the
  // navigation, the tabs and the panels; the NavState stays up to date, so turning the IDE off lands on the same place.
  // Stable, as the reducer's own dispatch: effects that keep it from their first render see the switch as it is now.
  const dispatch = useCallback((a: NavAction) => {
    if (!ideNow.current.ide) { navDispatch(a); return; }
    const r = routeNav(a, { isSeat: id => knownNow.current.find(s => s.id === id)?.rig != null, modalOpen: ideNow.current.nav.modal !== null, openSession: ideNow.current.openSession });
    if (r.nav) navDispatch(r.nav);
    // The right panel is `layout.right`, never `nav.chat`: asking for the chat only bumps `chatFocus` (its field takes the
    // focus), and `nav.chat` goes straight back to false, or the single keys, Alt + 1…9 and the screen's Escape would stay off.
    if (r.nav?.type === 'chat' && r.nav.open !== false) navDispatch({ type: 'chat', open: false });
    if (r.ws) wsStore.update(r.ws);
    if (r.layout) onLayout(r.layout);
  }, [wsStore, onLayout]);
  // The header's Archived pill bumps this; Archives unfolds and scrolls on each change (0 never counts).
  const [revealArchives, setRevealArchives] = useState(0);
  // The session page's « N sous-agents » bumps this; the tree unfolds that session and scrolls to it (0 never counts).
  const [revealCurrent, setRevealCurrent] = useState(0);
  // The IDE's tab right-click menu: which tab, and where.
  const [tabMenu, setTabMenu] = useState<{ tab: Tab; at: { x: number; y: number } } | null>(null);
  // Its tab gone (closed, its session deleted), the menu goes, and does not come back with a new tab of the same key.
  useEffect(() => { if (tabMenu && !findTab(ws, keyOf(tabMenu.tab))) setTabMenu(null); }, [ws, tabMenu]);
  // Every machine's daemon follows Desktop on its own, or from Settings › About (#48); while one updates, its restart is expected and silent.
  const update = useUpdate();
  const daemonUpdates = useDaemonUpdates(fleet, machines, daemonTarget(update), update.app);
  // The first launch on a new version shows its notes, once (#26).
  useEffect(() => { const w = takeWhatsNew(update.app); if (w) openWhatsNew({ mode: 'updated', ...w }); }, [update.app]);
  const whatsNew = useWhatsNew() !== null;
  // Toasts and sounds from session changes (spec 2026-10-14 §10); `test()` is the Sounds section's Test.
  // Read at the moment an alert fires, never captured: set below once the place and the prefs are known.
  const watching = useRef<() => string | null>(() => null);
  const alerts = useAlerts({ sessions, machines, status, daemonUpdating: daemonUpdates.updating.has('local'), tasks: tasksApi.tasks }, { watching: () => watching.current() });
  // A device asking to be linked: the dialog below opens on any screen, the notification only while Desktop is behind.
  usePairingAlerts(mobile);
  useUsageNotify(usage.alerts, a => {
    const u = t.usage;
    const w = a.window;
    const window = w.kind === 'five_hour' ? u.alertFive : w.kind === 'seven_day' ? u.alertWeek : u.alertModel(w.model ?? '');
    return { title: u.notifyTitle(u.harness[a.harness] ?? a.harness), body: u.notifyBody(window, w.resetsAt ? resetLong(w.resetsAt, Date.now(), lang) : null) };
  });
  // Decided here, at render: the dialog and the `inert` below change in one commit, so the Modal's focus return is not refused.
  const pairing = usePairingDialogState(mobile);
  // The tray's « Nouvelle session » opens its dialog; « Ne pas déranger » switches without showing the window.
  useEffect(() => onTrayAction(action => {
    if (action === 'dnd') setDnd(!getDnd());
    else if (action === 'new') dispatch({ type: 'modal', modal: { kind: 'launch' } });
  }), []);
  // Whether the terminal shows beside a session: it follows from one agent to the next and survives a restart.
  const [sessionPrefs, setSessionPrefs] = useStored(loadSessionPrefs, saveSessionPrefs);
  // The sessions as last rendered: whether a « Terminal » asked by id is an OMP seat's.
  const knownNow = useRef<readonly Session[]>([]);
  // The view an OMP seat's visit chose (viewShown): « Fil » holds while its page stays open, the preference left alone.
  const [seatView, setSeatView] = useState<{ id: string; view: SessionView } | null>(null);
  // Every « Terminal » (the session menu, a chat card, the island) opens the session's page on its Terminal view, the agent's screen.
  // An OMP seat opens on it anyway, the preference left alone. In the IDE, the tab just opened turns to its terminal view (if it
  // has one: a stopped OMP seat does not), the preference left alone too.
  const showTerminal = useCallback((id: string) => {
    dispatch({ type: 'open', id });
    const s = knownNow.current.find(x => x.id === id);
    if (ideNow.current.ide) {
      const tab: Tab = { kind: s?.rig != null ? 'seat' : 'session', ref: id };
      if (hasTerminal(tab, s)) wsStore.update(w => setView(w, keyOf(tab), 'terminal'));
      return;
    }
    if (s && isOmpSeat(s)) setSeatView(null);
    else setSessionPrefs(x => ({ ...x, view: 'terminal' }));
  }, [setSessionPrefs, wsStore]);
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
  knownNow.current = known;
  // The IDE's tabs follow (Review Focus 1): a session tab goes with its session, an archived one stays. Only a machine that has
  // said what it holds (`ready`) can close one: a tab kept from the last run stays while its machine connects, or while it is offline.
  const readyMachines = machines.filter(m => m.ready).map(m => m.id).join('\n');
  // Whether a tab may stay (or come back with Ctrl+Shift+T): a session's tab, its Changes and its Terminal go with it.
  const keepTab = useCallback((tab: Tab): boolean => {
    const sid = sessionOf(tab);
    if (sid === null) return true;
    const machine = splitId(sid)?.machine;
    return !machine || !readyMachines.split('\n').includes(machine) || known.some(s => s.id === sid);
  }, [known, readyMachines]);
  const keepTabNow = useRef(keepTab);
  keepTabNow.current = keepTab;
  useEffect(() => {
    if (reconcile(nav, known, projects) !== nav) navDispatch({ type: 'reconcile', sessions: known, projects });
    if (!ide) return;
    wsStore.update(w => reconcileTabs(w, keepTab));
  }, [known, projects, ide, keepTab]);
  // Turning the IDE on from a session page opens that session's tab (Review Focus 3); from Settings (where its switch is) or
  // the OpenRig page, theirs.
  useEffect(() => {
    if (!ide) return;
    if (ideNow.current.nav.chat) navDispatch({ type: 'chat', open: false });
    const a: NavAction | null = place.kind === 'session' ? { type: 'open', id: place.id, where: 'active' }
      : place.kind === 'settings' ? { type: 'settings', section: place.section }
      : place.kind === 'openrig' ? { type: 'openrig', ...(place.machine !== undefined ? { machine: place.machine } : {}) } : null;
    const r = a && routeNav(a, { isSeat: id => knownNow.current.find(s => s.id === id)?.rig != null, modalOpen: false, openSession: ideNow.current.openSession });
    if (r?.ws) wsStore.update(r.ws);
  }, [ide]);
  // The tab in front is the NavState's place, so what reads the place (the shell's session state, N, Alt + ←/→, the sidebar's
  // highlight, the interface the switch falls back to) follows the tab: a session's page, the atelier (the overview, its filter
  // kept), Settings and the OpenRig page on the section and sub-place they were last left on.
  const front: Tab | undefined = focused(ws).tabs[focused(ws).active];
  const frontKey = front ? keyOf(front) : null;
  const lastSettings = useRef<SectionId>('general');
  const lastOpenRig = useRef(new Map<string, { section?: 'rigs' | 'roles'; role?: string; seat?: string }>());
  if (place.kind === 'settings') lastSettings.current = place.section;
  if (place.kind === 'openrig') lastOpenRig.current.set(place.machine ?? 'local', { ...(place.section ? { section: place.section } : {}), ...(place.role !== undefined ? { role: place.role } : {}), ...(place.seat !== undefined ? { seat: place.seat } : {}) });
  /** The NavAction that shows a non-agent tab where it was left. */
  const tabAction = useCallback((tab: Tab): NavAction | null => tab.kind === 'atelier' ? { type: 'home' }
    : tab.kind === 'settings' ? { type: 'settings', section: lastSettings.current }
    : tab.kind === 'openrig' ? { type: 'openrig', machine: tab.ref, section: 'rigs', ...lastOpenRig.current.get(tab.ref) } : null, []);
  useEffect(() => {
    if (!ide || !front) return;
    const p = ideNow.current.nav.place;
    if (front.kind === 'session' || front.kind === 'seat') {
      if (known.some(s => s.id === front.ref) && (p.kind !== 'session' || p.id !== front.ref)) navDispatch({ type: 'open', id: front.ref });
    } else if (front.kind === 'atelier') {
      if (p.kind !== 'overview') navDispatch({ type: 'home', project: (p.kind === 'settings' ? p.back : p).project });
    } else if (front.kind === 'settings') {
      if (p.kind !== 'settings') navDispatch(tabAction(front)!);
    } else if (front.kind === 'openrig') {
      if (p.kind !== 'openrig' || (p.machine ?? 'local') !== front.ref) navDispatch(tabAction(front)!);
    }
  }, [ide, frontKey, known, place, tabAction]);

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
  const sessionMenu = useContextMenu({ client: fleetClient, sessions, archived: fleetView.archived, projects: projects?.projects ?? NO_PROJECTS, onShowTerminal: showTerminal });
  const decisions = useDecisions({ client: fleetClient, sessions, errors, notify });
  // The sidebar's Ask Ledge, the same send as the chat panel: nothing goes out while the local daemon is offline (the chat still opens).
  const screenKeys = useRef<ScreenKeys>({ current: null }).current;
  // Drafts, reading positions and the last item seen, per session and subagent: they survive navigation, not a restart.
  const memory = useRef(createSessionMemory()).current;
  useWindowFullscreen(nav.fullscreen, () => dispatch({ type: 'fullscreen', on: false }));
  const session = place.kind === 'session' ? known.find(s => s.id === place.id) ?? null : null;
  // Ledge shows the agent's screen (focused window, pane open, agent tab active): that is the terminal in front, no sound.
  // In the IDE, the front tab of the focused group on its own view, never the stored preference.
  watching.current = () => (ide ? watchedTab({ focused: document.hasFocus(), front, session: front && known.find(s => s.id === front.ref), helper: place.kind === 'session' && place.id === front?.ref ? place.helper : undefined })
    : place.kind === 'session' && session ? watchedSession({ focused: document.hasFocus(), agentView: sessionView === 'terminal', placeId: place.id, helper: place.helper }) : null);
  // The subagent whose page is open, found as the Workspace finds it (live, else its thread row), for the top bar.
  const { threads } = useDaemon();
  const helper = session && place.kind === 'session' && place.helper !== undefined ? subagentOf(session, threads.get(session.id), place.helper, t.session.subagent) : null;
  useEffect(preloadPlaces, []);
  // An OMP seat of OpenRig (design-ux, 2026-11-03 12:23Z): running, always on its Terminal view, « Fil » for the visit only;
  // stopped, on « Fil ». Its view changes never touch the preference.
  const ompSeat = session !== null && isOmpSeat(session);
  const sessionView = viewShown(session, sessionPrefs.view, seatView);
  const placeId = place.kind === 'session' ? place.id : null;
  useEffect(() => { setSeatView(v => (v && v.id !== placeId ? null : v)); }, [placeId]);
  // Any other session gets the preference itself, and both stay stable across renders: the page renders only for what it shows.
  const shownPrefs = useMemo(() => (sessionView === sessionPrefs.view ? sessionPrefs : { ...sessionPrefs, view: sessionView }), [sessionPrefs, sessionView]);
  const shown = useRef({ prefs: shownPrefs, seat: null as string | null });
  shown.current = { prefs: shownPrefs, seat: ompSeat ? session.id : null };
  const setShownPrefs = useCallback((fn: (p: SessionPrefs) => SessionPrefs) => {
    const { prefs, seat } = shown.current;
    if (seat === null) { setSessionPrefs(fn); return; }
    const { view, ...rest } = fn(prefs);
    if (view !== prefs.view) setSeatView({ id: seat, view });
    if ((Object.keys(rest) as (keyof typeof rest)[]).some(k => rest[k] !== prefs[k])) setSessionPrefs(x => ({ ...x, ...rest }));
  }, [setSessionPrefs]);
  const toggleTerminal = useCallback(() => setSessionPrefs(p => ({ ...p, terminal: !p.terminal })), [setSessionPrefs]);
  // An IDE session tab's prefs (R6): its own view, from the model (a change goes there, never to desktop.session), no right
  // panel, the rest shared. Kept per tab key, the same objects while nothing they hold changes, so what depends on their
  // identity (the Workspace's callbacks and effects on setPrefs) does not start over at each render. The page itself still
  // renders with the Shell (no memo boundary). A closed tab's entry goes with it.
  const tabPrefs = useRef(new Map<string, { base: SessionPrefs; prefs: SessionPrefs; set(fn: (p: SessionPrefs) => SessionPrefs): void }>());
  useEffect(() => {
    const open = new Set(ws.groups.flatMap(g => g.tabs.map(keyOf)));
    for (const k of tabPrefs.current.keys()) if (!open.has(k)) tabPrefs.current.delete(k);
  }, [ws]);
  const prefsOfTab = (tab: Tab, s: Session) => {
    const key = keyOf(tab);
    const view = tabView(tab, s);
    let e = tabPrefs.current.get(key);
    if (!e) {
      const set = (fn: (p: SessionPrefs) => SessionPrefs) => {
        const cur = tabPrefs.current.get(key)?.prefs;
        if (!cur) return;
        const { view: v, terminal: _, ...rest } = fn(cur);
        if (v !== cur.view) wsStore.update(w => setView(w, key, v));
        if ((Object.keys(rest) as (keyof typeof rest)[]).some(k => rest[k] !== cur[k])) setSessionPrefs(x => ({ ...x, ...rest }));
      };
      e = { base: sessionPrefs, prefs: { ...sessionPrefs, view, terminal: false }, set };
      tabPrefs.current.set(key, e);
    } else if (e.base !== sessionPrefs || e.prefs.view !== view) {
      e.base = sessionPrefs;
      e.prefs = { ...sessionPrefs, view, terminal: false };
    }
    return e;
  };
  // Ctrl + ² from outside a terminal (the thread, the reply, the panel's Modifications): the Terminal view, and the keyboard
  // into the agent's screen (or its banner's button when it cannot be typed into). A view just asked for draws its xterm in
  // the renders this key starts, so the focus waits for the next frame.
  const toTerminal = () => {
    if (ide) {
      // The IDE: the tab in front of the focused group, if it has a terminal view (else the key is not taken).
      const s = front && known.find(x => x.id === front.ref);
      if (!front || !s || !hasTerminal(front, s)) return false;
      // A flip, as the tab menu's: on the terminal already (the focus is outside it), back to the thread.
      const toThread = tabView(front, s) === 'terminal';
      wsStore.update(w => setView(w, keyOf(front), toThread ? 'thread' : 'terminal'));
      requestAnimationFrame(() => (toThread ? focusThread() : focusAgentView(termStore, s.id)));
      return true;
    }
    if (place.kind !== 'session' || !session) return false;
    if (sessionView !== 'terminal') setShownPrefs(p => ({ ...p, view: 'terminal' }));
    requestAnimationFrame(() => focusAgentView(termStore, session.id));
    return true;
  };
  // Ctrl + ² inside a terminal. From the agent's screen: back to the thread, where the keyboard was left. From a shell of the
  // panel: the keyboard goes back to the left view, which does not change.
  termThread.current = () => {
    const fromAgent = document.activeElement?.closest('.agent-view') !== null;
    if (ide && front && (front.kind === 'session' || front.kind === 'seat')) {
      // The IDE: the view is the front tab's own; from the agent's screen it goes back to the thread, else the focus returns to the left view.
      const s = known.find(x => x.id === front.ref);
      if (fromAgent && s && tabView(front, s) === 'terminal') {
        wsStore.update(w => setView(w, keyOf(front), 'thread'));
        requestAnimationFrame(focusThread);
      } else if (s && tabView(front, s) === 'terminal') focusAgentView(termStore, s.id);
      else focusThread();
      return;
    }
    if (fromAgent && sessionView === 'terminal') {
      setShownPrefs(p => ({ ...p, view: 'thread' }));
      requestAnimationFrame(focusThread);
    } else if (sessionView === 'terminal' && session) focusAgentView(termStore, session.id);
    else focusThread();
  };
  // The pairing dialog, like a confirmation, owns the keyboard while it shows (it takes Escape itself, before this listener).
  // The tab keys (VS Code's): Ctrl W closes the focused group's active tab (remembered for Ctrl Shift T), or the group when empty.
  const ideKeys = useMemo((): IdeKeys => ({ toggle: (panel: 'side' | 'bottom' | 'right') => onLayout({ type: 'toggle', panel }), split: () => wsStore.update(w => splitGroup(w, w.focus)), newSessionAnywhere: true as const,
    closeTab: () => { const g = focused(wsStore.get()); const tab = g.tabs[g.active]; if (tab) wsStore.close(keyOf(tab)); else wsStore.update(w => closeGroup(w, g.id)); },
    reopenTab: () => wsStore.reopen(t => keepTabNow.current(t)),
    cycleTab: step => wsStore.update(w => cycleTab(w, w.focus, step)),
    focusGroup: n => wsStore.update(w => focusNth(w, n)),
    moveTab: step => wsStore.update(w => moveActive(w, step)) }), [onLayout, wsStore]);
  useKeys(dispatch, { state: nav, order, screen: screenKeys, undo, confirming: actions.pending ? { cancel: actions.cancel } : pairing ? { cancel: pairing.dismiss } : null, toTerminal, ...(ide ? { ide: ideKeys } : {}) });
  const close = () => dispatch({ type: 'modal', modal: null });
  // Bumped by each broadcast that reached someone: the sidebar's selection, kept until then, is emptied.
  const [broadcastSent, setBroadcastSent] = useState(0);
  // Whom a broadcast dialog writes to, as its title names them: the project's name, or the picked sessions' names.
  const addressees = (to: BroadcastTo) => ('project' in to ? projects?.projects.find(x => x.id === to.project)?.name ?? to.project
    : to.sessions.map(id => sessions.find(s => s.id === id)?.name ?? id).join(', '));
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

  // The explorer's session menu in the IDE: open to the right, the agent's terminal tab beside the group that holds the session's
  // tab (linked; R3 for a seat; the session opened first where the setting says if it is not), a seat's message (the reply focused, R4).
  const ideSessionMenu: SessionMenuIde = {
    openRight: s => dispatch({ type: 'open', id: s.id, where: 'right' }),
    terminal: s => {
      const key = keyOf({ kind: s.rig != null ? 'seat' : 'session', ref: s.id });
      if (!findTab(wsStore.get(), key)) dispatch({ type: 'open', id: s.id });
      wsStore.update(w => { const hit = findTab(w, key); return hit ? beside(w, hit.group.id, 'terminal', s.id) : w; });
    },
    hasTerminal: s => hasTerminal({ kind: s.rig != null ? 'seat' : 'session', ref: s.id }, s),
    message: s => dispatch({ type: 'open', id: s.id, focus: 'reply' })
  };
  const title = (tab: Tab) => tabTitle(tab, { session: id => known.find(s => s.id === id), t, machine: id => machines.find(m => m.id === id)?.label });
  // The IDE shell (switch on): the same pieces, in tabs and panels. Its chunk is fetched only then.
  const ideShell = (() => {
    if (!ide) return null;
    const waiting = waitingSessions(sessions, waits);
    const badge = { perm: waiting.filter(s => dotOf(s) === 'approval').length, ask: waiting.filter(s => dotOf(s) === 'question').length };
    const label = (tab: Tab): ReactNode => (tab.kind === 'session' || tab.kind === 'seat'
      ? <SessionTabLabel session={known.find(s => s.id === tab.ref)} tab={tab} title={title(tab)} />
      : tab.kind === 'changes' || (tab.kind === 'terminal' && sessionOf(tab) !== null) ? <ChangesTabLabel session={known.find(s => s.id === sessionOf(tab))} title={title(tab)} /> : title(tab));
    const alert = (tab: Tab) => (tab.kind === 'session' || tab.kind === 'seat' ? tabAlert(known.find(s => s.id === tab.ref)) : null);
    const body: TabBody = tab => {
      const tnav = tabNav(nav, tab);
      if (tab.kind === 'session' || tab.kind === 'seat') {
        const s = known.find(x => x.id === tab.ref);
        if (!s) return null;
        const tp = prefsOfTab(tab, s);
        return <SessionPlace client={fleetClient} session={s} nav={tnav} dispatch={dispatch} decisions={decisions} waits={waits} memory={memory} notify={notify} actions={actions} tasksApi={tasksApi}
          prefs={tp.prefs} setPrefs={tp.set} onRevealCurrent={() => setRevealCurrent(n => n + 1)} ide
          project={projectLabel(s, projectName)} besideLink={changesBeside(ws, keyOf(tab))}
          onChanges={() => wsStore.update(w => { const hit = findTab(w, keyOf(tab)); return hit ? beside(w, hit.group.id, 'changes', s.id) : w; })} />;
      }
      // « +N −N »'s tab: an action clicked there brings the session's tab forward (R10).
      if (tab.kind === 'changes') {
        const s = known.find(x => x.id === tab.ref);
        return s ? <ChangesPlace client={fleetClient} session={s} notify={notify} onTouch={() => dispatch({ type: 'open', id: s.id })} /> : null;
      }
      // An agent's terminal in a tab of its own; a seat's is a read-only capture (R3).
      if (tab.kind === 'terminal') {
        const s = known.find(x => x.id === sessionOf(tab));
        return s ? <AgentTerminalPlace client={fleetClient} session={s} notify={notify} readOnly={s.rig != null} onOpenSession={() => dispatch({ type: 'open', id: s.id })} /> : null;
      }
      if (tab.kind === 'atelier') {
        return detached ? <AtelierAway onShow={detach} onAttach={attach} />
          : <Atelier nav={tnav} dispatch={dispatch} sessions={sessions} projects={projects} order={order} projectIdOf={projectIdOf} filing={filing} actions={actions} menu={sessionMenu}
              tasks={tasksApi.tasks} broadcast={canBroadcast(machines)} />;
      }
      if (tab.kind === 'settings') return tnav.place.kind === 'settings' ? <SettingsPlace section={tnav.place.section} ctx={settings} noBack /> : null;
      if (tab.kind === 'openrig') {
        const o = place.kind === 'openrig' && (place.machine ?? 'local') === tab.ref ? place : null;
        return <OpenRigPage client={fleetClient} machines={machines} machine={tab.ref} section={o?.section ?? 'rigs'} role={o?.role} seat={o?.seat} open={o?.open} projects={projects} sessions={sessions} dispatch={dispatch} />;
      }
      return null;
    };
    // An empty group's proposals open in it: it is focused first, then the tab opened « active » (or brought forward where it
    // already is: a tab is never duplicated). « Terminal · X » (« Capture · X » for a seat) only while X is still a known session.
    const emptyGroup = (gid: string): ReactNode => {
      const from = emptyProposals(ws, gid).terminalOf;
      const s = from === null ? undefined : known.find(x => x.id === from);
      const pick = (p: EmptyPick) => {
        wsStore.update(w => focusGroup(w, gid));
        if (p === 'terminal') { if (s) wsStore.update(w => openTab(w, agentTerminalTab(s.id), 'active')); return; }
        if (p === 'launch') { dispatch({ type: 'modal', modal: { kind: 'launch' } }); return; }
        dispatch(tabAction(p === 'atelier' ? ATELIER_TAB : p === 'settings' ? SETTINGS_TAB : openrigTab())!);
      };
      return <EmptyGroup terminal={s ? title({ kind: 'session', ref: s.id }) : null} seat={s?.rig != null} onPick={pick} />;
    };
    return (
      <IdePlace layout={layout} onLayout={onLayout} blocked={blocked} readOnly={localDown} dragging={!!filing.dragging}
        onSearch={() => dispatch({ type: 'modal', modal: { kind: 'search' } })}
        onTab={tab => { const a = tabAction(tab); if (a) dispatch(a); else wsStore.update(w => openTab(w, tab)); }} activeTab={front ?? null} badge={badge}
        waiting={waiting} onNextWaiting={() => { const first = waiting[0]; if (first) dispatch({ type: 'open', id: first.id }); }}
        notice={tokenMissing && <DaemonOutdated />}
        explorer={
          <Sidebar section={layout.sideView} nav={nav} dispatch={dispatch} sessions={sessions} archived={fleetView.archived} machines={machines} updating={daemonUpdates.updating} projects={projects} order={order} projectIdOf={projectIdOf} filing={filing}
            actions={actions} decisions={decisions} waits={waits} menu={sessionMenu} notify={notify}
            broadcast={canBroadcast(machines)} broadcastSent={broadcastSent}
            openrig={sidebarOpenRig} onTerminal={sessionMenu.terminal} revealArchives={revealArchives} revealCurrent={revealCurrent}
            ledge={{ closedTasks: closedLedgeTasks(tasksApi.tasks).length }} tasksApi={tasksApi}
            usageAlerts={usage.alerts} onAckUsage={id => fleet.ackUsage(id)}
            asks={asks.asks} onSeeAsk={id => { setAskFocus(f => ({ id, n: (f?.n ?? 0) + 1 })); dispatch({ type: 'ledge', tab: 'conversation' }); }} />
        }
        editor={<IdeDock ws={ws} store={wsStore} title={title} body={body} label={label} alert={alert} onTabMenu={(tab, at) => setTabMenu({ tab, at })} onNewSession={() => dispatch({ type: 'modal', modal: { kind: 'launch' } })} emptyGroup={emptyGroup} />}
        chat={
          <ChatPlace label={t.side.chat} client={fleetClient} view={fleetView} paused={nav.paused} focus={nav.chatFocus}
            onOpenSession={id => dispatch({ type: 'open', id })} onTerminal={showTerminal} onLaunched={chatLaunched}
            projects={projects} notify={notify} onProposal={openProposal} />
        }
        footer={
          <Footer dispatch={dispatch} localDown={localDown} island={island} machines={footMachines}
            usage={<UsageFooter groups={usage.groups} threshold={usage.threshold} label={usage.label} now={usage.now} onSettings={() => dispatch({ type: 'settings', section: 'general' })} />} />
        } />
    );
  })();
  return (
    <ScreenKeysContext.Provider value={screenKeys}><TermStoreContext.Provider value={termStore}>
      {ideShell ?? <>
      {!nav.fullscreen && <TitleBar dispatch={dispatch} sessions={sessions} waits={waits} blocked={blocked} />}
      <div className={`application ${nav.fullscreen ? 'immersive' : ''} ${filing.dragging ? 'is-dragging' : ''}`} data-readonly={localDown ? 'true' : undefined} inert={blocked}>
        <Sidebar nav={nav} dispatch={dispatch} sessions={sessions} archived={fleetView.archived} machines={machines} updating={daemonUpdates.updating} projects={projects} order={order} projectIdOf={projectIdOf} filing={filing}
          actions={actions} decisions={decisions} waits={waits} menu={sessionMenu} notify={notify}
          broadcast={canBroadcast(machines)} broadcastSent={broadcastSent}
          openrig={sidebarOpenRig} onTerminal={sessionMenu.terminal} revealArchives={revealArchives} revealCurrent={revealCurrent}
          ledge={{ closedTasks: closedLedgeTasks(tasksApi.tasks).length }} tasksApi={tasksApi}
          usageAlerts={usage.alerts} onAckUsage={id => fleet.ackUsage(id)}
          asks={asks.asks} onSeeAsk={id => { setAskFocus(f => ({ id, n: (f?.n ?? 0) + 1 })); dispatch({ type: 'ledge', tab: 'conversation' }); }} />
        <section className="workspace">
          {tokenMissing && <DaemonOutdated />}
          <TopBar nav={nav} dispatch={dispatch} session={session} helper={helper} projects={projects} projectIdOf={projectIdOf} terminal={sessionPrefs.terminal} onTerminal={toggleTerminal}
            onRevealArchives={() => setRevealArchives(n => n + 1)} onDetach={canDetach() && !detached ? detach : undefined}
            manage={{ open: sessionMenu.menu?.target.kind === 'session' && sessionMenu.menu.target.id === session?.id, onOpen: (at, opener) => session && sessionMenu.open(session.id, at, opener) }} />
          {place.kind === 'settings' ? <SettingsPlace section={place.section} ctx={settings} />
            : place.kind === 'home' ? <HomePlace label={t.side.ledgeHome} client={fleetClient} view={fleetView} tasks={tasksApi} decisions={decisions} waits={waits} tab={place.tab} task={place.task} dispatch={dispatch}
                asks={asks} askFocus={askFocus} machineLabel={localMachine?.label ?? 'local'}
                paused={nav.paused} focus={nav.chatFocus} projects={projects} onLaunched={chatLaunched} onTerminal={showTerminal} notify={notify} onProposal={openProposal} />
            : place.kind === 'openrig' ? <OpenRigPage client={fleetClient} machines={machines} machine={place.machine} section={place.section ?? 'rigs'} role={place.role} seat={place.seat} open={place.open} projects={projects} sessions={sessions} dispatch={dispatch} />
            : session && place.kind === 'session' ? <SessionPlace client={fleetClient} session={session} nav={nav} dispatch={dispatch} decisions={decisions} waits={waits} memory={memory} notify={notify} actions={actions} tasksApi={tasksApi}
                prefs={shownPrefs} setPrefs={setShownPrefs} onRevealCurrent={() => setRevealCurrent(n => n + 1)} />
            : detached ? <AtelierAway onShow={detach} onAttach={attach} />
            : <Atelier nav={nav} dispatch={dispatch} sessions={sessions} projects={projects} order={order} projectIdOf={projectIdOf} filing={filing} actions={actions} menu={sessionMenu}
                tasks={tasksApi.tasks} broadcast={canBroadcast(machines)} />}
          <Footer dispatch={dispatch} localDown={localDown} island={island} machines={footMachines}
            usage={<UsageFooter groups={usage.groups} threshold={usage.threshold} label={usage.label} now={usage.now} onSettings={() => dispatch({ type: 'settings', section: 'general' })} />} />
        </section>
        {nav.chat && (
          <ChatPlace label={t.side.chat} client={fleetClient} view={fleetView} paused={nav.paused} focus={nav.chatFocus} onClose={() => dispatch({ type: 'chat', open: false })}
            onOpenSession={id => dispatch({ type: 'open', id })} onTerminal={showTerminal} onLaunched={chatLaunched}
            projects={projects} notify={notify} onProposal={openProposal} />
        )}
      </div>
      </>}
      {ide && tabMenu && (() => {
        const key = keyOf(tabMenu.tab);
        const hit = findTab(ws, key);
        if (!hit) return null;
        // The tab as it is now (its view may have changed since the right click), not the one the click caught.
        const tab = hit.group.tabs[hit.index]!;
        const session = known.find(x => x.id === tab.ref);
        const agent = tab.kind === 'session' || tab.kind === 'seat';
        const view = agent ? tabView(tab, session) : 'thread';
        // A seat stopped has only its thread (tabView says so): nothing to switch to.
        const canSwitch = hasTerminal(tab, session);
        return <TabMenu at={tabMenu.at} tab={tab} name={title(tab)} terminal={view === 'terminal'} others={hit.group.tabs.length > 1}
          {...(canSwitch && { onView: () => wsStore.update(w => setView(w, key, view === 'terminal' ? 'thread' : 'terminal')) })}
          onSplit={() => wsStore.update(w => { const h = findTab(w, key); return h ? splitGroup(w, h.group.id) : w; })}
          onClose={() => wsStore.close(key)} onCloseOthers={() => wsStore.closeOthers(key)} onDismiss={() => setTabMenu(null)} />;
      })()}
      {nav.modal?.kind === 'search' && <SearchPalette sessions={sessions} projectName={projectName} order={order} onOpen={id => dispatch({ type: 'open', id })} onClose={close} />}
      {nav.modal?.kind === 'shortcuts' && <ShortcutsHelp onClose={close} />}
      {nav.modal?.kind === 'launch' && (
        <Modal title={t.modalTitles.launch} wide onClose={close}>
          <LaunchPlace client={fleetClient} projects={projects?.projects ?? NO_PROJECTS} machines={machines} sessions={sessions} projectIdOf={projectIdOf}
            wanted={{ ...(nav.modal.project !== undefined && { project: nav.modal.project }), ...(filter && { filter }) }}
            onEditProject={id => dispatch({ type: 'modal', modal: { kind: 'project', edit: id } })} onNewProject={() => dispatch({ type: 'modal', modal: { kind: 'project' } })}
            launch={launcher.state} onLaunch={(msg, preview) => { launched.current = preview; launcher.launch(msg); }} onCancel={close} paused={nav.paused} />
        </Modal>
      )}
      {nav.modal?.kind === 'project' && (
        <ProjectDialog key={`${nav.modal.edit ?? ''}|${nav.modal.file ?? ''}|${nav.modal.delete ? 'delete' : ''}|${nav.modal.proposal ?? ''}|${nav.modal.addFolder ? 'add' : ''}`} edit={nav.modal.edit} file={nav.modal.file} startDeleting={nav.modal.delete} addFolder={nav.modal.addFolder}
          proposal={nav.modal.proposal} projects={projects} sessions={sessions} machines={machines} client={fleetClient} fleet={fleet} projectIdOf={projectIdOf} paused={nav.paused}
          notify={notify} onClose={close} onSaved={projectSaved} onDeleted={projectDeleted} />
      )}
      {nav.modal?.kind === 'broadcast' && (
        <BroadcastDialog to={nav.modal.to} fleet={fleet} onClose={close} onSent={report => { close(); notify(report); setBroadcastSent(n => n + 1); }}
          label={addressees(nav.modal.to)} />
      )}
      <SessionMenuHost state={sessionMenu} actions={actions} filing={filing} projects={projects?.projects ?? NO_PROJECTS} currentOf={projectIdOf} onOpen={s => dispatch({ type: 'open', id: s.id })} onHandover={s => { void tasksApi.handover(s.id); }}
        {...(ide ? { ide: ideSessionMenu } : {})} />
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
