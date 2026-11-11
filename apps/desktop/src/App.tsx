import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { canBroadcast, daemonStore, prOfSession, prsFailing, prsWaitingForYou, sessionForge, projectOf, splitId, type BroadcastTo, type FleetPullRequest, useIsland, useMobile, useMobileError, useProjects, useTokenMissing, type DaemonClient } from '@ledge/fleet';
import { isOmpSeat, type Project, type Projects, type Session } from '@ledge/protocol';
import { LangProvider, loadLang, messagesFor, saveLang, useI18n, type Lang } from './i18n/lang';
import { loadMessages } from './i18n/messages';
import { useFleet } from './fleet/useFleet';
import { useDecisions } from './fleet/decisions';
import { useWaits } from './fleet/waits';
import { useAlerts, usePairingAlerts, useUsageNotify } from './notify/useAlerts';
import { watchedTab } from './notify/watching';
import { getDnd, setDnd, useDnd } from './notify/prefs';
import { MarkdownLinks } from '@ledge/ui/documents/links';
// The reader's styles stay in the first bundle, before app.css (as when the reader itself was there): session.css overrides them.
import '@ledge/ui/documents/markdown.css';
import { DaemonOutdated } from './shell/DaemonOutdated';
import { daemonTokenSource, onOpenTarget, shellsAvailable, onTrayAction, openUrl, setTrayLabels } from './tauri/bridge';
import { parseTarget, targetAction } from './open/target';
import { useAppearance } from './shell/theme';
import { initialNav, navReducer, reconcile, type HomeTab, type NavAction, type NavState, type OpenRigSection, type SectionId } from './nav/state';
import { sessionOfAsk } from './asks/model';
import { loadOverview, saveOverview } from './nav/overview';
import { ScreenKeysContext, type ScreenKeys } from './nav/screenKeys';
import { dotOf, mainOrder } from './nav/agents';
import { focusFrontTab, focusThread, useKeys, type IdeKeys } from './nav/useKeys';
import { Sidebar } from './shell/Sidebar';
import { waitingSessions } from './shell/waiting';
import { Footer } from './shell/Footer';
import { UsageFooter } from './usage/UsageFooter';
import { useUsageView } from './usage/useUsageView';
import { resetIsDate, resetLong, resetShort } from './usage/model';
import { useUsageTold } from './ide/usageTold';
import { alertWindowName } from './usage/alertName';
import { LaunchModalPlace } from './launch/lazy';
import type { LaunchWhere } from './launch/LaunchModal';
import { openWhere } from './launch/modalModel';
import { ChatPlace } from './chat/lazy';
import { SettingsPlace } from './settings/lazy';
import type { SettingsContext } from './settings/SettingsPage';
import { daemonTarget, useDaemonUpdates } from './update/daemon';
import { useUpdate } from './update/store';
import { takeWhatsNew } from './update/notes';
import { openWhatsNew, useWhatsNew } from './update/whatsNewView';
import { WhatsNew } from './update/WhatsNew';
import { useLaunch } from './launch/useLaunch';
import { useTasksApi } from './tasks/useTasksApi';
import { Atelier } from './atelier/Atelier';
import { useOpenRigAsks } from '@ledge/fleet/openrigAsks';
import { readOpenRigOnce, rigGone } from '@ledge/fleet/openrig';
import { createRigOutput, useRigOutput } from './openrig/rigOutput';
import { useSidebarOpenRig } from './openrig/sidebarState';
import { offersRigs, setGrouping, useGrouping } from './openrig/grouping';
import { Modal } from './shell/Modal';
import { ShortcutsHelp } from './shell/ShortcutsHelp';
import { Toast, useToast } from './shell/Toast';
import { preloadPlaces } from './shell/preload';
import { useFiling } from './atelier/filing';
import { useSessionActions, type SessionActions } from './manage/useSessionActions';
import { useContextMenu } from './manage/useContextMenu';
import { SessionMenuHost, type SessionMenuIde } from './manage/SessionMenu';
import { ConfirmDialog } from './manage/ConfirmDialog';
import { BroadcastDialog } from './broadcast/BroadcastDialog';
import { AgentTerminalPlace, ChangesPlace, FreeShellPlace, loadedWorkspace, loadWorkspace, SessionPlace } from './session/lazy';
import { createSessionMemory } from './session/memory';
import { loadSessionPrefs, saveSessionPrefs, viewShown, type SessionPrefs, type SessionView } from './session/prefs';
import { useStored } from './state/useStored';
import { ptyBackend } from './term/backend';
import { paintScreen } from './term/paint';
import { TermStore } from './term/store';
import { agentRoute, createAgentStream, createShellStream } from './term/stream';
import { focusAgentView } from './session/agentFocus';
import { termTheme } from './term/theme';
import { TermStoreContext } from './term/useTerms';
import { defaultShell, loadLastShell, menuDir, saveLastShell, sessionShell, shellLaunch, shellMenu, type ShellKind, type ShellsAvailable } from './term/shells';
import { ProjectDialog } from './projects/ProjectDialog';
import { PairingDialog, usePairingDialogState } from './settings/PairingDialog';
import { requestDeviceView, useRecoveryToast } from './settings/recovery';
import { useResumeOnStart, useRigsMachine, useShowUsage } from './workspace/prefs';
import { liveTabs, loadLiveTabs, machineOf, nextMemo, saveLiveTabs, toResume } from './workspace/resume';
import { useOpenSession } from './workspace/openPrefs';
import { useWebglMax } from './term/webglPrefs';
import { ATELIER_TAB, SETTINGS_TAB, createWorkspaceStore, loadWorkspace as loadIdeWorkspace, openrigTab, rigTab, useWorkspace } from './workspace/store';
import { bootWorkspace, capture, loadBoot, loadDispositions, plan, saveCurrent, saveDispositions, signature, upsert, useCurrentDisposition, useDispositions } from './workspace/dispositions';
import { layoutFor, loadLayout, saveLayout, type LayoutAction } from './workspace/layout';
import { agentTerminalTab, beside, changesBeside, close as dropTab, closeGroup, cycleTab, emptyProposals, find as findTab, focusGroup, focusNth, focused, keyOf, MAIN, move as moveTab, moveActive, moveTo as moveTabTo, open as openTab, parseRigRef, sessionOf, reconcile as reconcileTabs, setView, split as splitGroup, windowOf, type Tab } from './workspace/model';
import { hasTerminal, projectLabel, providerOf, tabAlert, tabView } from './workspace/sessionTab';
import { ChangesTabLabel, SessionTabLabel } from './ide/SessionTabLabel';
import { TabMenu } from './ide/TabMenu';
import { EDITOR_NAMES, openSessionInEditor, useEditor } from './ide/openIn';
import { createTabExtras, TabExtrasContext, useTabExtras } from './ide/tabExtras';
import { openSessionTerminal } from './session/terminal';
import { IdeWelcome, recentSessions, type EmptyPick } from './ide/IdeWelcome';
import { routeNav, tabNav } from './workspace/route';
import { tabTitle, type TabBody } from './ide/tabs';
import { IdeAtelierBar, IdeAtoi, IdeBottom, IdeDock, IdeOutput, IdePaletteHost, IdePlace, IdeOpenRig, IdePr, IdePrs, IdePrsStatus, IdePrTabLabel, IdeRigLaunch, IdeRigs, IdeRigView } from './ide/lazy';
import { useForge } from './forge/useForge';
import { AtoiTabLabel } from './ide/atoi/AtoiTabLabel';
import { forgeLines, noForgeReadable, reachOf } from './forge/states';
import type { PaletteCommand, PaletteSession } from './ide/palette/model';
import { tileToDock } from './ide/termDrag';
import { addTerm, besideTerm, joinTerm, createPanelStore, isTerminalRef, openTerm, panelViewer, removeTerm, stackTerm, usePanel } from './workspace/panel';

const NO_PROJECTS: readonly Project[] = [];
const NO_SHELLS: ShellsAvailable = { wsl: null, powershell: false, cmd: false, gitBash: false };

/** Ledge's terminal colours as the root's tokens give them now. */
const rootTermTheme = () => termTheme(getComputedStyle(document.documentElement));

/** One log of the `rig` commands this Desktop ran per client, made once and disposed on unmount (the bottom panel's Output reads it). */
/** How long applying a disposition waits for a machine's OpenRig to say which rigs it still has. */
const RIG_READ_MS = 3_000;

function useRigOutputLog(client: DaemonClient) {
  const [log] = useState(() => createRigOutput(client));
  useEffect(() => () => log.dispose(), [log]);
  return log;
}

/** The IDE's keys typed inside an xterm (set by Shell once the layout is known): whether the IDE is on, Ctrl+J, Ctrl+1…9. */
type TermIdeKeys = { on(): boolean; toggle(): void; group(n: number): void };

/** Ctrl+Shift+² inside a terminal: the keyboard goes to its group's front tab, no view changing; with no tab to take it (an
 *  empty group), the terminal only lets it go. */
function leaveTerminal(from: HTMLElement): void {
  if (focusFrontTab(from)) return;
  const at = from.ownerDocument.activeElement;
  if (at instanceof HTMLElement && from.contains(at)) at.blur();
}

/** The app's one terminal store: its shells and the agent's screen live as long as the window, whatever the place. Its xterms
 *  follow the theme once the root has taken it (`data-theme`, set by useAppearance after this component's own effects). */
function useTermStore(client: DaemonClient, onThread: () => void, avail: ShellsAvailable | null, panel: TermIdeKeys): TermStore {
  const { t } = useI18n();
  // The store is made once: it reads the menu's inputs as they are when a shell opens.
  const titling = useRef({ avail, t });
  titling.current = { avail, t };
  const [store] = useState(() => new TermStore({
    backend: ptyBackend(),
    freeLaunch: (kind, dir) => shellLaunch(kind, { dir, machines: client.fleet?.machines() ?? [] }),
    freeTitle: (kind, n) => {
      const { avail: a, t: msgs } = titling.current;
      const row = a ? shellMenu(a, client.fleet?.machines() ?? [], kind, msgs).find(r => r.kind === kind) : undefined;
      const sh = msgs.ide.panel.shells;
      const machine = kind.startsWith('ssh:') ? client.fleet?.machines().find(m => `ssh:${m.id}` === kind) : undefined;
      const fallback = { wsl: sh.wsl, powershell: sh.powershell, cmd: sh.cmd, gitbash: sh.gitBash, ledge: sh.ledge }[kind as 'wsl'] ?? `${sh.ssh} · ${machine?.label ?? kind.slice(4)}`;
      const label = row?.label ?? fallback;
      return `${label} ${n}`;
    },
    // xterm comes with the session page's chunk (out of the first bundle): only its pane and Workspace make the store draw, so
    // the chunk is there by then. Its Ctrl + ² gives the keyboard back to the session's left view (App's termThread).
    surface: () => {
      const chunk = loadedWorkspace();
      if (!chunk) throw new Error('a terminal is drawn only once the session page has loaded');
      // The callbacks are read when the key arrives: a surface outlives the render that drew it, and the IDE switch can change after that.
      return chunk.createSurface({ theme: rootTermTheme(), onThread, openUrl, panelKey: () => panel.on(), onPanel: () => panel.toggle(), onLeave: from => leaveTerminal(from), onGroup: n => panel.group(n) });
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
  // The WebGL budget: the setting (Settings › Workspace), app-wide.
  const [webglMax] = useWebglMax();
  useEffect(() => { store.setWebglMax(webglMax); }, [store, webglMax]);
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
  // The shells this computer has (the bottom panel's « + ▾ », its shells' titles), asked once.
  const [avail, setAvail] = useState<ShellsAvailable | null>(null);
  useEffect(() => { void shellsAvailable().then(setAvail, () => setAvail(NO_SHELLS)); }, []);
  // Ctrl + J inside an xterm toggles the bottom panel while the IDE is on (set below, with the layout).
  const termPanel = useRef<TermIdeKeys>({ on: () => false, toggle: () => {}, group: () => {} });
  const termStore = useTermStore(fleetClient, () => termThread.current(), avail, termPanel.current);
  // The bottom panel's Sortie: the rig commands this Desktop ran.
  const rigOutput = useRigOutputLog(fleetClient);
  const projects = useProjects(fleetClient);
  const tasksApi = useTasksApi(fleetClient);
  // « À toi »: what OpenRig's rigs ask the person, on this computer (lot 1: one machine), once its daemon reads them.
  const localMachine = machines.find(m => m.id === 'local');
  const asks = useOpenRigAsks(fleetClient, localMachine?.ready && localMachine.daemon?.openrigAsks ? 'local' : null);
  const [askFocus, setAskFocus] = useState<{ id: string; n: number } | null>(null);
  // Never counts down: « À toi » forgets `askFocus` once taken in, and the next « Voir » must still be new to it.
  const askSeq = useRef(0);
  // The same for « Résumer la journée »: the right panel forgets `ask` once sent, and stays mounted with the last `n` it sent.
  const summarizeSeq = useRef(0);
  const island = useIsland(fleetClient);
  const usage = useUsageView(fleetClient, machines);
  const footMachines = useMemo(() => machines.map(m => ({ id: m.id, label: m.label, offline: m.status === 'unreachable', count: sessions.filter(s => (s.machineId ?? 'local') === m.id).length })), [machines, sessions]);
  const mobile = useMobile(fleetClient);
  const mobileError = useMobileError(fleetClient);
  const sidebarOpenRig = useSidebarOpenRig(fleetClient, machines);
  const grouping = useGrouping();
  const tokenMissing = useTokenMissing(daemonTokenSource());
  const { t, lang } = useI18n();
  const [nav, navDispatch] = useReducer(shellReducer, undefined, () => initialNav(loadOverview()));
  // The machine the Rigs view shows (the rig launch modal opens on it). No « ! » on Rigs any more (the user, 2026-11-09).
  const [rigsMachine, setRigsMachine] = useRigsMachine(machines);
  // Read (and re-rendered on) only while the IDE shows the panel's Sortie.
  const rigEntries = useRigOutput(rigOutput, true);
  // « Au démarrage » (Settings › Workspace): the last workspace, a fixed disposition (its panels too; App applies it below, which
  // opens its shells again), or the atelier alone.
  const [boot] = useState(() => bootWorkspace(loadBoot(), loadIdeWorkspace(), loadDispositions(), ATELIER_TAB));
  // A bottom-panel shell's tab closed by the user (its ×, middle click, Ctrl+W, the menu) kills the shell (R9); a tab the model
  // drops by itself (reconcile, a move, a disposition applied) does not.
  const [wsStore] = useState(() => createWorkspaceStore(boot.ws, { closed: key => { if (key.startsWith('terminal:shell:')) termStore.closeFree(key.slice('terminal:'.length)); } }));
  const ws = useWorkspace(wsStore);
  const [layout, setLayout] = useStored(() => ({ ...loadLayout(), ...boot.panels }), saveLayout);
  // « Dispositions »: the status bar's menu, the palette, Settings › Workspace (applied and saved below, once the panel is known).
  const dispositions = useDispositions();
  const [saveAsk, setSaveAsk] = useState(0);
  const currentDisposition = useCurrentDisposition();
  // Asking for the right panel folds the sidebar when that is what gives it room (layoutFor).
  const onLayout = useCallback((a: LayoutAction) => setLayout(l => layoutFor(l, a, window.innerWidth)), [setLayout]);
  termPanel.current.on = () => true;
  termPanel.current.toggle = () => onLayout({ type: 'toggle', panel: 'bottom' });
  const [openSession] = useOpenSession();
  const ideNow = useRef({ nav, openSession });
  ideNow.current = { nav, openSession };
  // The IDE's right panel is there from the start: its field takes the focus only once asked (/, Ctrl+/, an open button), never by
  // itself when the app starts (a single key such as N would land in it). `chatFocus` counted from there.
  const ideChatFrom = useRef<number>(nav.chatFocus);
  // The IDE's right panel tabs (lot 12, docs/mockups/ledge-ide-tasks-history.html), kept for the window's life: Conversation at
  // the start; `seen` counts the « Voir » that brought a task (the filters go back to All / Anyone); `ask` a question from « À toi ».
  const [rightTab, setRightTab] = useState<{ tab: HomeTab; task: string | null; seen: number; ask?: { text: string; n: number } }>({ tab: 'conversation', task: null, seen: 0 });
  // What every child dispatches: the action routed (routeNav) to the navigation, the tabs and the panels. Stable, as the
  // reducer's own dispatch.
  // The section the Settings tab was last left on (set below, as the place changes): where Ctrl+, and the tab bring it back.
  const lastSettings = useRef<SectionId>('general');
  const dispatch = useCallback((a: NavAction) => {
    const r = routeNav(a, { isSeat: id => knownNow.current.find(s => s.id === id)?.rig != null, modalOpen: ideNow.current.nav.modal !== null, openSession: ideNow.current.openSession, lastSettings: lastSettings.current });
    if (r.nav) navDispatch(r.nav);
    // The right panel is `layout.right`, never `nav.chat`: asking for the chat only bumps `chatFocus` (its field takes the
    // focus), and `nav.chat` goes straight back to false, or the single keys, Alt + 1…9 and the screen's Escape would stay off.
    if (r.nav?.type === 'chat' && r.nav.open !== false) navDispatch({ type: 'chat', open: false });
    if (r.ws) wsStore.update(r.ws);
    if (r.layout) onLayout(r.layout);
    if (r.chat) { const c = r.chat; setRightTab(x => ({ ...x, tab: c.tab, ...(c.task !== undefined ? { task: c.task, seen: x.seen + 1 } : {}) })); }
  }, [wsStore, onLayout]);
  // The bottom panel: its terminals and its tab, for this run only (R15).
  const [panelStore] = useState(() => createPanelStore());
  const panel = usePanel(panelStore);
  // « par défaut » (R7): the shell last chosen in « + ▾ », while the menu still offers it.
  const [lastShell, setLastShell] = useState(loadLastShell);
  const shellRows = useMemo(() => shellMenu(avail ?? NO_SHELLS, machines, lastShell, t), [avail, machines, lastShell, t]);
  // Archives unfold and scroll on each change of this (0 never counts): nothing in the IDE asks for it yet.
  const revealArchives = 0;
  // The session page's « N sous-agents » bumps this; the tree unfolds that session and scrolls to it (0 never counts).
  const [revealCurrent, setRevealCurrent] = useState(0);
  // « Toutes les modifications »: the file each session's Changes tab is asked to show (its `n` grows at each ask).
  const [changesWant, setChangesWant] = useState<Record<string, { path: string; n: number }>>({});
  // The IDE's tab right-click menu: which tab, and where.
  const [tabMenu, setTabMenu] = useState<{ tab: Tab; at: { x: number; y: number } } | null>(null);
  // Its tab gone (closed, its session deleted), the menu goes, and does not come back with a new tab of the same key.
  useEffect(() => { if (tabMenu && !findTab(ws, keyOf(tabMenu.tab))) setTabMenu(null); }, [ws, tabMenu]);
  // What a session tab's page publishes for its menu (it has no heading row): the external terminal, the Story / Objectif.
  const [tabExtras] = useState(createTabExtras);
  const menuExtras = useTabExtras(tabExtras, tabMenu ? keyOf(tabMenu.tab) : null);
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
    const window = alertWindowName(u, a.harness, w);
    return { title: u.notifyTitle(u.harness[a.harness] ?? a.harness), body: u.notifyBody(window, w.resetsAt ? resetLong(w.resetsAt, Date.now(), lang) : null, !!w.resetsAt && resetIsDate(w.resetsAt, Date.now())) };
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
    const tab: Tab = { kind: s?.rig != null ? 'seat' : 'session', ref: id };
    if (hasTerminal(tab, s)) wsStore.update(w => setView(w, keyOf(tab), 'terminal'));
  }, [wsStore]);
  // « Open in Ledge » from the island: the shell has already brought the window forward; this shows what was asked.
  useEffect(() => onOpenTarget(raw => {
    const target = parseTarget(raw);
    if (target?.kind === 'terminal') showTerminal(target.id);
    else if (target) dispatch(targetAction(target));
  }), [showTerminal]);
  // The Atelier in its own window (#21): what it opens shows here, this window brought forward; its closing gives it back.
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
    // A bottom-panel shell's tab: while its shell is there (none survives a restart).
    if (tab.kind === 'terminal' && tab.ref.startsWith('shell:')) return termStore.free(tab.ref) !== undefined;
    const sid = sessionOf(tab);
    if (sid === null) return true;
    const machine = splitId(sid)?.machine;
    return !machine || !readyMachines.split('\n').includes(machine) || known.some(s => s.id === sid);
  }, [known, readyMachines, termStore]);
  const keepTabNow = useRef(keepTab);
  keepTabNow.current = keepTab;
  useEffect(() => {
    if (reconcile(nav, known, projects) !== nav) navDispatch({ type: 'reconcile', sessions: known, projects });
    wsStore.update(w => reconcileTabs(w, keepTab));
  }, [known, projects, keepTab]);
  // The sessions whose tab was open, alive (ledge.ide.liveTabs): the memo follows the run; the one read at start says what a stop
  // killed. Once a session's machine is ready, each one now ended is resumed in its tab, once per run (the setting can turn it off).
  const [resumeOnStart] = useResumeOnStart();
  // Settings › Workspace › « Limites d’usage des comptes »: the IDE's status bar only (the old interface and New session keep theirs).
  const [showUsage] = useShowUsage();
  const bootMemo = useRef<readonly string[] | null>(null);
  if (bootMemo.current === null) bootMemo.current = loadLiveTabs();
  const resumeSeen = useRef(new Set<string>());
  const resumeNow = useRef({ actions: null as SessionActions | null, notify: (_: string) => {} });
  useEffect(() => {
    const ready = new Set(readyMachines ? readyMachines.split('\n') : []);
    const before = loadLiveTabs();
    const memo = nextMemo(before, liveTabs(ws, known), ready);
    if (memo.join('\n') !== before.join('\n')) saveLiveTabs(memo);
    const { actions: acts, notify: say } = resumeNow.current;
    if (!acts) return;
    const due = bootMemo.current!.filter(id => ready.has(machineOf(id)) && !resumeSeen.current.has(id));
    const go = resumeOnStart ? toResume(due, known, acts.allowed) : [];
    // An ended session its machine cannot resume yet (its daemon's info not in) waits for it; every other one is settled.
    const later = resumeOnStart ? toResume(due, known, () => true).filter(id => !go.includes(id)) : [];
    for (const id of due) if (!later.includes(id)) resumeSeen.current.add(id);
    for (const id of go) acts.resume(id);
    if (go.length > 0) say(t.ide.resumed(go.length));
  }, [ws, known, machines, readyMachines, resumeOnStart, t]);
  // The tab in front is the NavState's place, so what reads the place (the shell's session state, N, Alt + ←/→, the sidebar's
  // highlight, the interface the switch falls back to) follows the tab: a session's page, the atelier (the overview, its filter
  // kept), Settings and the OpenRig page on the section and sub-place they were last left on.
  const front: Tab | undefined = focused(ws).tabs[focused(ws).active];
  const frontKey = front ? keyOf(front) : null;
  const lastOpenRig = useRef(new Map<string, { section?: OpenRigSection; role?: string; seat?: string }>());
  if (place.kind === 'settings') lastSettings.current = place.section;
  if (place.kind === 'openrig') lastOpenRig.current.set(place.machine ?? 'local', { ...(place.section ? { section: place.section } : {}), ...(place.role !== undefined ? { role: place.role } : {}), ...(place.seat !== undefined ? { seat: place.seat } : {}) });
  /** The NavAction that shows a non-agent tab where it was left. */
  const tabAction = useCallback((tab: Tab): NavAction | null => tab.kind === 'atelier' ? { type: 'home' }
    : tab.kind === 'settings' ? { type: 'settings', section: lastSettings.current }
    : tab.kind === 'openrig' ? { type: 'openrig', machine: tab.ref, section: 'overview', ...lastOpenRig.current.get(tab.ref) } : null, []);
  useEffect(() => {
    if (!front) return;
    const p = ideNow.current.nav.place;
    // Following the front tab never closes a dialog: a group's « + » focuses that group (its front tab changes) and opens
    // New session in the same click.
    const modal = ideNow.current.nav.modal;
    const go = (a: NavAction) => { navDispatch(a); if (modal) navDispatch({ type: 'modal', modal }); };
    if (front.kind === 'session' || front.kind === 'seat') {
      if (known.some(s => s.id === front.ref) && (p.kind !== 'session' || p.id !== front.ref)) go({ type: 'open', id: front.ref });
    } else if (front.kind === 'atelier') {
      if (p.kind !== 'overview') go({ type: 'home', project: (p.kind === 'settings' ? p.back : p).project });
    } else if (front.kind === 'settings') {
      if (p.kind !== 'settings') go(tabAction(front)!);
    } else if (front.kind === 'openrig') {
      if (p.kind !== 'openrig' || (p.machine ?? 'local') !== front.ref) go(tabAction(front)!);
    }
  }, [frontKey, known, place, tabAction]);

  const projectIdOf = useCallback((s: Session) => (projects ? projectOf(s, projects) : null), [projects]);
  const projectName = useCallback((s: Session) => {
    const id = projectIdOf(s);
    return (id && projects?.projects.find(p => p.id === id)?.name) || t.side.unassigned;
  }, [projectIdOf, projects, t]);
  const waits = useWaits(sessions);
  const order = useMemo(() => mainOrder(sessions, projects), [sessions, projects]);
  // Putting an agent away: drag and drop or « Ranger dans… » write a folder rule; the toast says how it went.
  const { notice, action: noticeAction, notify, act: toastAct, undo } = useToast();
  // A device back with its passkey, or an attempt refused (docs/mockups/ledge-mobile-passkey, 5): « Voir » opens its row in Settings.
  useRecoveryToast(fleet, notify, id => { dispatch({ type: 'settings', section: 'mobile' }); requestDeviceView(id); });
  // Applying a disposition (docs/mockups/ledge-ide-layouts-palette.html, « Appliquer »): its tabs whose session, rig or machine is
  // gone are left out and counted, its shells gone open again (same type, same folder), the shells open that it does not hold go
  // to the bottom panel (none is killed). Its name is shown from then on, with a « • » once the workspace changes.
  const machinesNow = useRef(machines);
  machinesNow.current = machines;
  const applyDisposition = useCallback(async (name: string): Promise<number | null> => {
    const d = loadDispositions().find(x => x.name === name);
    if (!d) return null;
    // A shell needs the terminals' chunk (openShell waits for it the same way).
    if (!loadedWorkspace()) { try { await loadWorkspace(); } catch { /* No shell then: ChunkBoundary says so where it is drawn. */ } }
    const machineIds = machinesNow.current.map(m => m.id);
    // A rig deleted on a machine still there is gone too (the board): each machine with a rig tab is read once, a few seconds at
    // most; one that does not answer, or whose OpenRig is stopped, keeps its tabs (nobody knows).
    const rigMachines = [...new Set(d.ws.groups.flatMap(g => g.tabs).filter(t => t.kind === 'rig').map(t => parseRigRef(t.ref)?.machine).filter((m): m is string => m !== undefined && machineIds.includes(m)))];
    const rigsSeen = new Map(await Promise.all(rigMachines.map(async m => [m, await readOpenRigOnce(fleetClient, m, RIG_READ_MS)] as const)));
    const keep = (tab: Tab) => {
      if (!keepTabNow.current(tab)) return false;
      // A rig or OpenRig tab of a machine removed (the machines known, it is not among them): gone.
      const rig = tab.kind === 'rig' ? parseRigRef(tab.ref) : null;
      const machine = rig ? rig.machine : tab.kind === 'openrig' ? tab.ref : undefined;
      if (machine !== undefined && machineIds.length > 0 && !machineIds.includes(machine)) return false;
      const seen = rig && rigsSeen.get(rig.machine);
      return !(rig && seen && rigGone(seen, rig.rig));
    };
    const r = plan(d, { keep, live: ref => { const f = termStore.free(ref); return f && { kind: f.kind, dir: f.dir }; }, spawn: spec => termStore.openFree(spec.kind, spec.dir), open: termStore.freeIds() });
    wsStore.update(() => r.ws);
    panelStore.update(p => ({ tab: p.tab, terms: r.panel }));
    const panels = { bottom: d.bottom, right: d.right };
    setLayout(l => ({ ...l, ...panels }));
    saveCurrent({ name: d.name, sig: signature(r.ws, panels) });
    return r.dropped;
  }, [wsStore, panelStore, termStore, setLayout, fleetClient]);
  const applyAndTell = useCallback((name: string) => {
    void applyDisposition(name).then(n => { if (n !== null) notify(n > 0 ? t.ide.dispositions.gone(name, n) : t.ide.dispositions.applied(name)); });
  }, [applyDisposition, notify, t]);
  // A fixed disposition at start: applied once, quietly (its shells open again).
  const bootApplied = useRef(false);
  useEffect(() => {
    if (bootApplied.current) return;
    bootApplied.current = true;
    if (boot.current === null) saveCurrent(null);
    else if (boot.current !== undefined) void applyDisposition(boot.current);
  }, [boot, applyDisposition]);
  const saveDisposition = useCallback((name: string) => {
    const list = loadDispositions();
    const panels = { bottom: layout.bottom, right: layout.right };
    const shellOf = (ref: string) => { const f = termStore.free(ref); return f && { kind: f.kind, dir: f.dir }; };
    saveDispositions(upsert(list, capture(name, wsStore.get(), panels, panelStore.get().terms, shellOf)));
    saveCurrent({ name, sig: signature(wsStore.get(), panels) });
    notify(list.some(x => x.name === name) ? t.ide.dispositions.replaced(name) : t.ide.dispositions.saved(name));
  }, [wsStore, panelStore, termStore, layout.bottom, layout.right, notify, t]);
  // The IDE's « À toi » has no usage card: each alert is told once, in a toast (the user, 2026-11-09).
  useUsageTold(true, usage.alerts, notify, a => {
    const u = t.usage, w = a.window;
    const at = w.resetsAt ? resetShort(w.resetsAt, Date.now(), lang) : null;
    const line = a.level === 'full' ? u.alertFull(at, !!w.resetsAt && resetIsDate(w.resetsAt, Date.now())) : u.alertThreshold(w.pct, at);
    return t.ide.usageOnce(u.harness[a.harness] ?? a.harness, alertWindowName(u, a.harness, w), line);
  });
  const filing = useFiling({ fleet, projects, sessions, projectIdOf, notify });
  // Allow / Deny from the session (and the sidebar): one send per request; a refusal or a silence is said in the toast.
  // End, archive, resume, restore, delete (lot 8): the confirmation below; the atelier and the session page hand it their menus.
  const actions = useSessionActions({ client: fleetClient, sessions, archived: fleetView.archived, machines, errors, notify });
  resumeNow.current = { actions, notify };
  // The session menu, from the atelier's seats and the session page's header « … » (one at a time).
  const sessionMenu = useContextMenu({ client: fleetClient, sessions, archived: fleetView.archived, projects: projects?.projects ?? NO_PROJECTS, onShowTerminal: showTerminal });
  const decisions = useDecisions({ client: fleetClient, sessions, errors, notify });
  // The sidebar's Ask Ledge, the same send as the chat panel: nothing goes out while the local daemon is offline (the chat still opens).
  const screenKeys = useRef<ScreenKeys>({ current: null }).current;
  // Drafts, reading positions and the last item seen, per session and subagent: they survive navigation, not a restart.
  const memory = useRef(createSessionMemory()).current;
  const session = place.kind === 'session' ? known.find(s => s.id === place.id) ?? null : null;
  // Ledge shows the agent's screen (focused window, pane open, agent tab active): that is the terminal in front, no sound.
  // In the IDE, the front tab of the focused group on its own view, never the stored preference.
  watching.current = () => watchedTab({ focused: document.hasFocus(), front, session: front && known.find(s => s.id === front.ref), helper: place.kind === 'session' && place.id === front?.ref ? place.helper : undefined });
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
    // The tab in front of the focused group, if it has a terminal view (else the key is not taken).
    const s = front && known.find(x => x.id === front.ref);
    if (!front || !s || !hasTerminal(front, s)) return false;
    // A flip, as the tab menu's: on the terminal already (the focus is outside it), back to the thread.
    const toThread = tabView(front, s) === 'terminal';
    wsStore.update(w => setView(w, keyOf(front), toThread ? 'thread' : 'terminal'));
    requestAnimationFrame(() => (toThread ? focusThread() : focusAgentView(termStore, s.id)));
    return true;
  };
  // Ctrl + ² inside a terminal. From the agent's screen: back to the thread, where the keyboard was left. From a shell of the
  // panel: the keyboard goes back to the left view, which does not change.
  termThread.current = () => {
    const fromAgent = document.activeElement?.closest('.agent-view') !== null;
    if (front && (front.kind === 'session' || front.kind === 'seat')) {
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
  // A bottom-panel shell (IDE lot 5), in `dir` (R6: see shellDir). Its xterm comes with the session page's chunk: the shell opens
  // once the chunk is there. The shell opened takes the keyboard once its view is in (`focusShell`, claimed by FreeShellView).
  const shellsNow = useRef({ rows: shellRows, avail, notify });
  shellsNow.current = { rows: shellRows, avail, notify };
  const opening = useRef(0);
  const layoutNow = useRef(layout);
  layoutNow.current = layout;
  const focusShell = useRef<string | null>(null);
  const claimFocus = useCallback((id: string) => { if (focusShell.current !== id) return false; focusShell.current = null; return true; }, []);
  /** R6: a WSL shell starts where the session of the focused group's front tab works, else at home. */
  const shellDir = useCallback((sid: string | null = sessionOf(focused(wsStore.get()).tabs[focused(wsStore.get()).active])) => {
    const s = sid === null ? undefined : knownNow.current.find(x => x.id === sid);
    return s ? s.workdir ?? s.cwd : '';
  }, [wsStore]);
  const openShell = useCallback((kind: ShellKind, dir: string, then: (id: string) => void, intro?: string) => {
    const run = () => {
      const id = termStore.openFree(kind, dir);
      if (intro && termStore.free(id)?.status === 'running') termStore.surface(id)?.write(`${intro}\r\n`);
      focusShell.current = id;
      then(id);
    };
    if (loadedWorkspace()) { run(); return; }
    opening.current += 1;
    // A chunk that fails to load: no shell (the places that need the chunk say so themselves, ChunkBoundary).
    void loadWorkspace().then(run).catch(() => {}).finally(() => { opening.current -= 1; });
  }, [termStore]);
  /** « par défaut » (R7): the shell last chosen while the menu offers it, else WSL; before the shells are known, the last chosen. */
  const pickDefault = useCallback((): ShellKind => (shellsNow.current.avail === null ? loadLastShell() : defaultShell(shellsNow.current.rows, loadLastShell())), []);
  /** A shell into the panel, on Terminaux, the panel shown. The default shell of a panel shown empty (`auto`) does not show it
   *  again if it was hidden while the shell opened. */
  const panelShell = useCallback((kind: ShellKind, auto = false, at?: { dir: string; intro: string }) => openShell(kind, at?.dir ?? menuDir(kind, shellDir()), id => {
    panelStore.update(p => openTerm(p, id));
    if (!auto || layoutNow.current.bottom) onLayout({ type: 'show', panel: 'bottom', on: true });
  }, at?.intro), [openShell, shellDir, panelStore, onLayout]);
  // The panel shown with no terminal (Ctrl+J, its button, a restart with it shown) opens the default shell (R7): once per showing,
  // and only once the shells are known (before, the default could not be told).
  const bottomWas = useRef(false);
  const wantDefault = useRef(false);
  const bottomOn = layout.bottom;
  useEffect(() => {
    const was = bottomWas.current;
    bottomWas.current = bottomOn;
    if (!bottomOn) { wantDefault.current = false; return; }
    if (!was) wantDefault.current = true;
    if (!wantDefault.current || avail === null) return;
    wantDefault.current = false;
    if (panelStore.get().terms.length > 0 || opening.current > 0) return;
    panelShell(pickDefault(), true);
  }, [bottomOn, avail, panelStore, panelShell, pickDefault]);
  const panelClose = useCallback((ref: string) => {
    if (ref.startsWith('shell:')) termStore.closeFree(ref);
    panelStore.update(p => removeTerm(p, ref));
    if (panelStore.get().terms.length > 0) return;
    onLayout({ type: 'show', panel: 'bottom', on: false });
    shellsNow.current.notify(t.ide.panel.lastClosed);
  }, [termStore, panelStore, onLayout, t]);
  // A tile dragged into the dock: its terminal tab where it was dropped, the same shell or agent screen (its view moves the
  // xterm, nothing is relaunched). The panel emptied so hides, without « Dernier terminal fermé » (nothing was closed).
  const panelToDock = useCallback((ref: string, to: { group: string; index?: number } | { rightOf: string } | { window: 'new' }) => {
    const r = tileToDock({ ws: wsStore, panel: panelStore, terms: termStore }, ref, to);
    if (r.moved && r.empty) onLayout({ type: 'show', panel: 'bottom', on: false });
  }, [termStore, panelStore, wsStore, onLayout]);
  // A dock tab dropped on the panel: a terminal leaves the model by `update`, not the store's `close` (no kill, R9; not
  // remembered for Ctrl+Shift+T), and comes back as a tile (BottomPanel refuses any other tab).
  const dockToPanel = useCallback((key: string, onto?: string, where?: 'beside' | 'end') => {
    if (!isTerminalRef(key)) return;
    const ref = key.slice('terminal:'.length);
    if (ref.startsWith('agent:')) termStore.handOver(ref.slice('agent:'.length), key, panelViewer(ref));
    wsStore.update(w => dropTab(w, key));
    panelStore.update(p => onto ? (where === 'beside' ? besideTerm(p, ref, onto) : where === 'end' ? joinTerm(p, ref, onto) : stackTerm(p, ref, onto)) : addTerm(p, ref));
    shellsNow.current.notify(t.ide.panel.broughtBack);
  }, [termStore, wsStore, panelStore, t]);
  // The pairing dialog, like a confirmation, owns the keyboard while it shows (it takes Escape itself, before this listener).
  // The tab keys (VS Code's): Ctrl W closes the focused group's active tab (remembered for Ctrl Shift T), or the group when empty.
  // Ctrl+/ (design-ux, 2026-11-10): the right panel hidden, it shows with the focus in the chat's field; shown, it hides and the
  // focus goes back to the front tab. The other panels only toggle.
  const ideKeys = useMemo((): IdeKeys => ({ toggle: (panel: 'side' | 'bottom' | 'right') => {
    if (panel !== 'right') { onLayout({ type: 'toggle', panel }); return; }
    if (!layoutNow.current.right) { dispatch({ type: 'chat', open: true }); return; }
    onLayout({ type: 'show', panel: 'right', on: false });
    requestAnimationFrame(() => focusFrontTab());
  }, split: () => wsStore.update(w => splitGroup(w, w.focus)), newSessionAnywhere: true as const,
    closeTab: () => { const g = focused(wsStore.get()); const tab = g.tabs[g.active]; if (tab) wsStore.close(keyOf(tab)); else wsStore.update(w => closeGroup(w, g.id)); },
    reopenTab: () => wsStore.reopen(t => keepTabNow.current(t)),
    cycleTab: step => wsStore.update(w => cycleTab(w, w.focus, step)),
    // Ctrl+Shift+² outside a terminal: back into the front tab's terminal, if it shows one (Ctrl+Shift+² inside left it).
    enterTerminal: () => {
      const g = focused(wsStore.get());
      const tab = g.tabs[g.active];
      const s = tab && knownNow.current.find(x => x.id === tab.ref);
      if (!tab || !s || !hasTerminal(tab, s) || tabView(tab, s) !== 'terminal') return false;
      focusAgentView(termStore, s.id);
      return true;
    },
    // The keyboard follows, onto the group's front tab: out of a terminal too (Ctrl+1…9 typed in one, `termPanel.group`).
    focusGroup: n => {
      if (!wsStore.get().groups.filter(g => g.window === MAIN)[n - 1]) return;
      wsStore.update(w => focusNth(w, n));
      requestAnimationFrame(() => focusFrontTab());
    },
    moveTab: step => wsStore.update(w => moveActive(w, step)) }), [onLayout, wsStore, termStore, dispatch]);
  termPanel.current.group = n => ideKeys.focusGroup?.(n);
  useKeys(dispatch, { state: nav, order, screen: screenKeys, undo, confirming: actions.pending ? { cancel: actions.cancel } : pairing ? { cancel: pairing.dismiss } : null, toTerminal, ide: ideKeys });
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
  // `where`: the IDE modal's « Ouvrir » (the old form has none).
  const launched = useRef<{ name: string; project: string; projectId: string; where?: LaunchWhere } | null>(null);
  const launcher = useLaunch(fleetView, id => {
    const preview = launched.current;
    // The table is the launched session's own, once listed (the daemon lists it before answering), or none (« Sans projet »: the
    // form's project is no table then, as for a chat card); the preview's until then.
    const s = sessions.find(x => x.id === id);
    const ownId = s ? projectIdOf(s) : null;
    const own = ownId ? projects?.projects.find(p => p.id === ownId) : undefined;
    const table = own ? { id: own.id, name: own.name } : s ? { id: 'none', name: null } : preview ? { id: preview.projectId, name: preview.project } : null;
    dispatch({ type: 'modal', modal: null });
    // In the IDE the session opens where the modal's « Ouvrir » said, and the overview's filter stays. No `where` in the preview
    // (`?? openSession`): a launch sent from the old form, answered after the IDE switch was turned on.
    dispatch({ type: 'open', id, where: preview?.where ?? ideNow.current.openSession });
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
    lang, setLang, paused: nav.paused, applyDisposition: applyAndTell
  };

  // A dialog over the application (a modal, a confirmation, the rename dialog): what lies behind it, the title bar's controls
  // included, takes neither clicks nor the focus.
  const blocked = nav.modal !== null || actions.pending !== null || sessionMenu.renaming !== null || whatsNew || pairing !== null;

  // The explorer's session menu in the IDE: open to the right, the agent's terminal tab beside the group that holds the session's
  // tab (linked; R3 for a seat; the session opened first where the setting says if it is not), a seat's message (the reply focused, R4).
  // « Ouvrir dans… » (lot 11, docs/mockups/ledge-ide-open-in.html): success shows nothing; the editor missing and Zed on a WSL
  // folder say so with a « Réglages » button (not an undo: no Ctrl Z); a failed launch says why.
  const [editor] = useEditor();
  const openInEditor = (s: Session) => {
    void openSessionInEditor(s, machines, editor, t.ide.openIn).then(n => {
      if (!n) return;
      notify(n.text, n.settings ? { label: t.ide.openIn.settings, run: () => dispatch({ type: 'settings', section: 'workspace' }), undo: false } : undefined);
    });
  };
  const editorEntry = { name: EDITOR_NAMES[editor], open: openInEditor };
  const ideSessionMenu: SessionMenuIde = {
    openRight: s => dispatch({ type: 'open', id: s.id, where: 'right' }),
    terminal: s => {
      const key = keyOf({ kind: s.rig != null ? 'seat' : 'session', ref: s.id });
      if (!findTab(wsStore.get(), key)) dispatch({ type: 'open', id: s.id });
      wsStore.update(w => { const hit = findTab(w, key); return hit ? beside(w, hit.group.id, 'terminal', s.id) : w; });
    },
    hasTerminal: s => hasTerminal({ kind: s.rig != null ? 'seat' : 'session', ref: s.id }, s),
    message: s => dispatch({ type: 'open', id: s.id, focus: 'reply' }),
    editor: editorEntry
  };
  // Lot 8b: every machine's pull and merge requests.
  // A machine down keeps its last read, dimmed; a reachable one shows what it sends (review P2, useForge).
  const forge = useForge(fleet);
  const prOf = (id: string) => forge.prs.find(p => p.id === id);
  const machineLabel = (id: string) => machines.find(m => m.id === id)?.label ?? id;
  /** A request's agent: the session or seat on its branch (the most recently active). */
  const prAgentOf = (p: FleetPullRequest) => p.sessions.map(id => known.find(s => s.id === id)).find((s): s is Session => !!s);
  const title = (tab: Tab) => tabTitle(tab, { session: id => known.find(s => s.id === id), t, machine: id => machines.find(m => m.id === id)?.label, shell: id => termStore.free(id)?.title, pr: id => prOf(id)?.ref });
  // The main window's active group, kept while the focus is in a detached window: where « Ramener » gives the atelier back.
  const mainFocus = useRef<string | null>(null);
  if (ws.groups.some(g => g.id === ws.focus && g.window === MAIN)) mainFocus.current = ws.focus;
  // « Détacher » (v27): the atelier tab, alone, in a new window; « Ramener », back to the main window's active group.
  const detachAtelier = () => wsStore.update(w => moveTab(w, keyOf(ATELIER_TAB), { window: 'new' }));
  const attachAtelier = () => wsStore.update(w => {
    const main = w.groups.find(g => g.id === mainFocus.current && g.window === MAIN) ?? w.groups.find(g => g.window === MAIN)!;
    return moveTabTo(w, keyOf(ATELIER_TAB), { group: main.id });
  });
  // A detached window's name (lot 9, v27): « Pim · ledge » for a session, « dev-front · ledge-dev » for a seat, else the tab's title.
  const windowTitle = (tab: Tab) => {
    const s = tab.kind === 'session' || tab.kind === 'seat' ? known.find(x => x.id === tab.ref) : undefined;
    return s ? `${s.name} · ${s.rig ? s.rig.name : projectName(s)}` : title(tab);
  };
  // The IDE shell: the pieces, in tabs and panels.
  const ideShell = (() => {
    const waiting = waitingSessions(sessions, waits);
    const badge = { perm: waiting.filter(s => dotOf(s) === 'approval').length, ask: waiting.filter(s => dotOf(s) === 'question').length };
    const label = (tab: Tab): ReactNode => (tab.kind === 'session' || tab.kind === 'seat'
      ? <SessionTabLabel session={known.find(s => s.id === tab.ref)} tab={tab} title={title(tab)} client={fleetClient}
        helper={nav.place.kind === 'session' && nav.place.id === tab.ref && nav.place.helper ? { id: nav.place.helper } : null} />
      : tab.kind === 'changes' || (tab.kind === 'terminal' && sessionOf(tab) !== null) ? <ChangesTabLabel session={known.find(s => s.id === sessionOf(tab))} title={title(tab)} />
      : tab.kind === 'pr' ? <IdePrTabLabel pr={prOf(tab.ref)} title={title(tab)} />
      // « À toi 2 » (mockup v27): the requests waiting, the tab's name staying its title.
      : tab.kind === 'atoi' ? <AtoiTabLabel title={title(tab)} waiting={waitingSessions(sessions, waits).length} /> : title(tab));
    const alert = (tab: Tab) => (tab.kind === 'session' || tab.kind === 'seat' ? tabAlert(known.find(s => s.id === tab.ref)) : null);
    const body: TabBody = tab => {
      const tnav = tabNav(nav, tab, lastSettings.current);
      if (tab.kind === 'session' || tab.kind === 'seat') {
        const s = known.find(x => x.id === tab.ref);
        if (!s) return null;
        const tp = prefsOfTab(tab, s);
        return <SessionPlace client={fleetClient} session={s} nav={tnav} dispatch={dispatch} decisions={decisions} waits={waits} memory={memory} notify={notify} actions={actions} tasksApi={tasksApi}
          prefs={tp.prefs} setPrefs={tp.set} onRevealCurrent={() => setRevealCurrent(n => n + 1)} ide onShell={(s, intro) => { const at = sessionShell(s, machines); panelShell(at.kind, false, { dir: at.dir, intro: intro(at) }); }}
          project={projectLabel(s, projectName)} besideLink={changesBeside(ws, keyOf(tab))}
          pr={prOfSession(forge.prs, s.id) ?? null} onPr={() => { const p = prOfSession(forge.prs, s.id); if (p) onTab({ kind: 'pr', ref: p.id }); }}
          prUnknown={sessionForge(forge.prs, forge.forges, forge.followed, s.id) ?? null} prMachine={machineLabel(s.machineId ?? 'local')}
          onPrUnknown={() => { if (!(layout.sideOpen && layout.sideView === 'prs')) onLayout({ type: 'view', view: 'prs' }); }}
          onChanges={path => {
            if (path) setChangesWant(m => ({ ...m, [s.id]: { path, n: (m[s.id]?.n ?? 0) + 1 } }));
            wsStore.update(w => { const hit = findTab(w, keyOf(tab)); return hit ? beside(w, hit.group.id, 'changes', s.id) : w; });
          }} />;
      }
      // « +N −N »'s tab: an action clicked there brings the session's tab forward (R10).
      if (tab.kind === 'changes') {
        const s = known.find(x => x.id === tab.ref);
        return s ? <ChangesPlace client={fleetClient} session={s} notify={notify} onTouch={() => dispatch({ type: 'open', id: s.id })} want={changesWant[s.id] ?? null} /> : null;
      }
      // A bottom-panel shell in a tab: the kind row (`shell`), then its xterm; closing the tab kills it (R9, wsStore's `closed`).
      if (tab.kind === 'terminal' && tab.ref.startsWith('shell:')) {
        return termStore.free(tab.ref) ? (
          <div className="ide-term"><div className="ide-term-kind"><span className="chip-k">{t.ide.panel.shellKind}</span></div><FreeShellPlace id={tab.ref} claimFocus={claimFocus} /></div>
        ) : null;
      }
      // An agent's terminal in a tab of its own; a seat's is a read-only capture (R3).
      if (tab.kind === 'terminal') {
        const s = known.find(x => x.id === sessionOf(tab));
        return s ? <AgentTerminalPlace client={fleetClient} session={s} notify={notify} readOnly={s.rig != null} onOpenSession={() => dispatch({ type: 'open', id: s.id })} /> : null;
      }
      // The atelier as it is, under the bar the old top bar gave it (lot 6): its filter, « Projets | Rigs », the subagents, the
      // animations, « Détacher ». Detached, the tab says where it went (no bar).
      if (tab.kind === 'atelier') {
        const pf = tnav.place.kind === 'settings' ? tnav.place.back.project : tnav.place.project;
        const fp = pf === 'all' || pf === 'none' ? null : projects?.projects.find(x => x.id === pf);
        return (
          <div className="ide-atelier">
            <IdeAtelierBar filter={pf === 'all' ? null : { name: fp?.name ?? t.side.unassigned, color: fp?.color ?? null }} onClearFilter={() => dispatch({ type: 'home', project: 'all' })}
              grouping={offersRigs(sessions, sidebarOpenRig?.installed) ? grouping : null} onGrouping={setGrouping}
              helpers={nav.helpers} onHelpers={() => dispatch({ type: 'helpers' })} paused={nav.paused} onPaused={() => dispatch({ type: 'paused' })}
              {...(windowOf(ws, keyOf(ATELIER_TAB)) === MAIN ? { onDetach: detachAtelier } : { onAttach: attachAtelier })} />
            <Atelier nav={tnav} dispatch={dispatch} sessions={sessions} projects={projects} order={order} projectIdOf={projectIdOf} filing={filing} actions={actions} menu={sessionMenu}
              tasks={tasksApi.tasks} broadcast={canBroadcast(machines)} />
          </div>
        );
      }
      if (tab.kind === 'settings') return tnav.place.kind === 'settings' ? <SettingsPlace section={tnav.place.section} ctx={settings} noBack /> : null;
      if (tab.kind === 'atoi') {
        return <IdeAtoi waiting={waitingSessions(sessions, waits)} sessions={sessions} where={s => (s.rig ? projectLabel(s, projectName) : [projectName(s), s.branch].filter(Boolean).join(' · '))}
          onOpen={id => dispatch({ type: 'open', id })} onDecide={(s, ok) => { decisions.decide(s, ok ? 'accept' : 'deny'); }} onAnswer={(s, o) => { decisions.reply(s, o); }}
          prs={prsWaitingForYou(forge.prs)} agentOf={p => prAgentOf(p) ?? null} onOpenPr={p => onTab({ kind: 'pr', ref: p.id })}
          onAskFix={p => { const a = prAgentOf(p); if (!a) return; fleet.prDetail(p.id, p.machineId).then(d => { const j = d.jobs.find(x => x.status === 'fail'); if (j && decisions.reply(a, t.forge.fixText(p.ref, j.name))) dispatch({ type: 'open', id: a.id, where: 'right' }); }, () => {}); }}
          fleet={fleet} machineLabel={machineLabel} notify={notify}
          tasks={tasksApi} onSeeTask={id => dispatch({ type: 'ledge', tab: 'tasks', task: id })} onHandover={id => { void tasksApi.handover(id); }} onLater={s => tasksApi.putLater(s)}
          onSummarize={() => { setRightTab(x => ({ ...x, tab: 'conversation', ask: { text: t.home.point.summarizeQuestion, n: ++summarizeSeq.current } })); onLayout({ type: 'show', panel: 'right', on: true }); }}
          summarizeOff={!localMachine?.ready} asks={asks} askFocus={askFocus} onAskFocused={() => setAskFocus(null)} asksMachine={localMachine?.label ?? 'local'}
          askSourceOf={ask => { const s = sessionOfAsk(ask, sessions); return s ? (path: string) => dispatch({ type: 'open', id: s.id, doc: path }) : null; }}
          onOpenSeat={id => dispatch({ type: 'open', id })} />;
      }
      if (tab.kind === 'pr') {
        const p = prOf(tab.ref);
        if (!p) return null;
        const a = prAgentOf(p);
        return <IdePr pr={p} fleet={fleet} notify={notify} onOpenUrl={openUrl}
          reach={reachOf(machines.find(m => m.id === p.machineId))} machine={machineLabel(p.machineId)} readAt={forge.readAt(p.machineId)}
          agent={a ? { name: a.name, provider: providerOf(a.tool) } : null}
          onAskAgent={text => (a ? decisions.reply(a, text) : false)}
          onOpenAgent={() => { if (a) dispatch({ type: 'open', id: a.id, where: 'right' }); }} />;
      }
      if (tab.kind === 'openrig') {
        const o = place.kind === 'openrig' && (place.machine ?? 'local') === tab.ref ? place : null;
        return <IdeOpenRig client={fleetClient} machines={machines} machine={tab.ref} section={o?.section ?? 'overview'} role={o?.role} seat={o?.seat} sessions={sessions} asks={asks.asks} output={rigEntries} dispatch={dispatch} onTab={onTab} onLaunch={m => dispatch({ type: 'modal', modal: { kind: 'rigLaunch', machine: m } })} />;
      }
      if (tab.kind === 'rig') {
        const r = parseRigRef(tab.ref);
        return r ? <IdeRigView client={fleetClient} machines={machines} sessions={sessions} asks={asks.asks} machine={r.machine} rig={r.rig} dispatch={dispatch} /> : <div className="ide-rigs-note" role="status">{t.ide.rigTab.badRef}</div>;
      }
      return null;
    };
    // An empty group shows the welcome; what it opens lands in that group: it is focused first, then the tab opened « active »
    // (or brought forward where it already is: a tab is never duplicated). « Terminal · X » (« Capture · X » for a seat) only
    // while X is still a known session.
    const emptyGroup = (gid: string): ReactNode => {
      const from = emptyProposals(ws, gid).terminalOf;
      const s = from === null ? undefined : known.find(x => x.id === from);
      const pick = (p: EmptyPick) => {
        wsStore.update(w => focusGroup(w, gid));
        if (p === 'terminal') { if (s) wsStore.update(w => openTab(w, agentTerminalTab(s.id), 'active')); return; }
        if (p === 'launch') { dispatch({ type: 'modal', modal: { kind: 'launch', from: 'plus' } }); return; }
        if (p === 'search') { dispatch({ type: 'modal', modal: { kind: 'search' } }); return; }
        if (p === 'ledge') { dispatch({ type: 'ledge' }); return; }
        if (p === 'next') { const first = waiting[0]; if (first) dispatch({ type: 'open', id: first.id, where: 'active' }); return; }
        // « Terminal »: the default shell (R7), in a tab of this group, in the folder of the session it was split from.
        if (p === 'shell') { const k = pickDefault(); openShell(k, menuDir(k, shellDir(from)), id => wsStore.update(w => openTab(focusGroup(w, gid), { kind: 'terminal', ref: id }, 'active'))); return; }
        dispatch(tabAction(p === 'atelier' ? ATELIER_TAB : p === 'settings' ? SETTINGS_TAB : openrigTab())!);
      };
      const where = (x: Session) => (x.rig ? projectLabel(x, projectName) : [projectName(x), x.branch].filter(Boolean).join(' · '));
      return <IdeWelcome terminal={s ? title({ kind: 'session', ref: s.id }) : null} seat={s?.rig != null} recent={recentSessions(sessions)} waiting={waiting.length > 0}
        where={where} onPick={pick} onOpen={id => { wsStore.update(w => focusGroup(w, gid)); dispatch({ type: 'open', id, where: 'active' }); }} />;
    };
    const onTab = (tab: Tab, where?: 'right') => { const a = tabAction(tab); if (a) dispatch(a); else wsStore.update(w => openTab(w, tab, where)); };
    return (
      <IdePlace layout={layout} onLayout={onLayout} blocked={blocked} readOnly={localDown} dragging={!!filing.dragging}
        onSearch={() => dispatch({ type: 'modal', modal: { kind: 'search' } })}
        onTab={onTab} activeTab={front ?? null} badge={badge}
        waiting={waiting} onNextWaiting={() => { const first = waiting[0]; if (first) dispatch({ type: 'open', id: first.id }); }}
        dispositions={{ list: dispositions,
          current: currentDisposition && { name: currentDisposition.name, modified: currentDisposition.sig !== signature(ws, { bottom: layout.bottom, right: layout.right }) },
          onApply: applyAndTell, onSave: saveDisposition,
          onManage: () => dispatch({ type: 'settings', section: 'workspace' }), saveAsk }}
        notice={tokenMissing && <DaemonOutdated />}
        prsFailing={prsFailing(forge.prs)} prsStatus={<IdePrsStatus prs={forge.prs} onShow={() => { if (!(layout.sideOpen && layout.sideView === 'prs')) onLayout({ type: 'view', view: 'prs' }); }} />}
        explorer={layout.sideView === 'prs'
          ? <IdePrs prs={forge.prs} agentOf={p => prAgentOf(p)?.name ?? null} current={front?.kind === 'pr' ? front.ref : null}
              lines={forgeLines(forge.forges, machines, forge.readAt)} noneReadable={noForgeReadable(forge.forges)} machineLabel={machineLabel}
              onCopy={cmd => { void navigator.clipboard.writeText(cmd).then(() => notify(t.forge.copied), () => {}); }}
              onOpen={(p, right) => onTab({ kind: 'pr', ref: p.id }, right ? 'right' : undefined)} />
          : layout.sideView === 'rigs'
          ? <IdeRigs client={fleetClient} machines={machines} sessions={sessions} asks={asks.asks} activeTab={front ?? null} dispatch={dispatch} onTab={onTab}
              onMenu={(id, at, opener) => sessionMenu.open(id, at, opener)} />
          : <Sidebar section={layout.sideView === 'atoi' ? 'atoi' : 'projects'} onAtoiPage={() => onTab({ kind: 'atoi', ref: 'main' })} nav={nav} dispatch={dispatch} sessions={sessions} archived={fleetView.archived} projects={projects} order={order} projectIdOf={projectIdOf} filing={filing}
            actions={actions} decisions={decisions} waits={waits} menu={sessionMenu} notify={notify}
            broadcast={canBroadcast(machines)} broadcastSent={broadcastSent}
            onTerminal={sessionMenu.terminal} revealArchives={revealArchives} revealCurrent={revealCurrent}
            tasksApi={tasksApi}
            // A rig's request is read and answered on the page « À toi » (lot 12, card 12): its card unfolded there, ringed a moment.
            asks={asks.asks} onSeeAsk={id => { setAskFocus({ id, n: ++askSeq.current }); onTab({ kind: 'atoi', ref: 'main' }); }} />
        }
        bottom={
          <IdeBottom panel={panel} onTab={tab => panelStore.update(p => (p.tab === tab ? p : { ...p, tab }))}
            outputCount={rigEntries.length} output={<IdeOutput entries={rigEntries} />}
            menu={shellRows} onNewShell={k => { saveLastShell(k); setLastShell(k); panelShell(k); }}
            tile={ref => {
              if (ref.startsWith('shell:')) return <FreeShellPlace id={ref} claimFocus={claimFocus} />;
              const s = known.find(x => x.id === sessionOf({ kind: 'terminal', ref }));
              return s ? <AgentTerminalPlace client={fleetClient} session={s} notify={notify} readOnly={s.rig != null} onOpenSession={() => dispatch({ type: 'open', id: s.id })} bare /> : null;
            }}
            tileTitle={ref => title({ kind: 'terminal', ref })}
            tileKind={ref => (ref.startsWith('shell:') ? t.ide.panel.shellKind : known.find(x => x.id === sessionOf({ kind: 'terminal', ref }))?.rig != null ? t.ide.termReadOnly : t.ide.termAttached)}
            onClose={panelClose} onHide={() => onLayout({ type: 'show', panel: 'bottom', on: false })}
            onDockDrop={dockToPanel} onArrange={next => panelStore.update(() => next)} onRefused={() => notify(t.ide.panel.onlyTerms)} />
        }
        editor={<IdeDock ws={ws} store={wsStore} title={title} body={body} label={label} alert={alert} onTabMenu={(tab, at) => setTabMenu({ tab, at })} onNewSession={gid => { wsStore.update(w => focusGroup(w, gid)); dispatch({ type: 'modal', modal: { kind: 'launch', from: 'plus' } }); }} emptyGroup={emptyGroup} onPanelDrop={panelToDock} windowTitle={windowTitle} onWindowClosed={n => notify(t.ide.windows.closed(n))} />}
        chat={
          <ChatPlace label={t.side.chat} client={fleetClient} view={fleetView} paused={nav.paused} focus={nav.chatFocus - (ideChatFrom.current ?? 0)} askedOnly
            onOpenSession={id => dispatch({ type: 'open', id })} onTerminal={showTerminal} onLaunched={chatLaunched}
            projects={projects} notify={notify} onProposal={openProposal}
            tabs={{ tasks: tasksApi, ...rightTab, onAsked: () => setRightTab(({ ask: _, ...x }) => x), onTab: (tab, task) => setRightTab(x => ({ ...x, tab, ...(task !== undefined ? { task } : {}) })) }} />
        }
        footer={<Footer dispatch={dispatch} localDown={localDown} island={island} machines={footMachines} />}
        // No amber in the IDE's status bar: the alert is told once, in a toast (red stays at 100 %).
        usage={showUsage ? <UsageFooter groups={usage.groups} threshold={Infinity} alertAt={usage.threshold} label={usage.label} now={usage.now} onSettings={() => dispatch({ type: 'settings', section: 'general' })} /> : undefined} />
    );
  })();
  return (
    <ScreenKeysContext.Provider value={screenKeys}><TermStoreContext.Provider value={termStore}><TabExtrasContext.Provider value={tabExtras}>
      {ideShell}
      {tabMenu && (() => {
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
        // Only the page's own view counts: published on Terminal, the external terminal is offered while it still shows it.
        const external = session && menuExtras?.external && view === 'terminal'
          ? () => { void openSessionTerminal(fleetClient, session).then(ok => { if (!ok) notify(t.session.terminal.openFailed(session.name)); }); }
          : undefined;
        return <TabMenu at={tabMenu.at} tab={tab} name={title(tab)} terminal={view === 'terminal'} others={hit.group.tabs.length > 1}
          {...(session && { session, editor: { name: editorEntry.name, open: () => openInEditor(session) } })} tags={menuExtras?.tags ?? null} {...(external && { onExternal: external })} onOpenSession={id => dispatch({ type: 'open', id })}
          {...(canSwitch && { onView: () => wsStore.update(w => setView(w, key, view === 'terminal' ? 'thread' : 'terminal')) })}
          {...(hit.group.window === MAIN && { onSplit: () => wsStore.update(w => { const h = findTab(w, key); return h ? splitGroup(w, h.group.id) : w; }) })}
          onClose={() => wsStore.close(key)} onCloseOthers={() => wsStore.closeOthers(key)} onDismiss={() => setTabMenu(null)} />;
      })()}
      {nav.modal?.kind === 'search' && (() => {
        // The IDE palette (lot 10, mockup `palItems`): the sessions and seats (`@`), the commands (`>`).
        const p = t.ide.palette.commands;
        const waitingIds = new Set(waitingSessions(sessions, waits).map(s => s.id));
        const rows = known.map((s): PaletteSession => ({ kind: 'session', id: s.id, label: s.name, waiting: waitingIds.has(s.id), run: () => dispatch({ type: 'open', id: s.id }),
          hint: s.rig ? s.rig.name : fleetView.archived.includes(s) ? t.ide.palette.archived(projectName(s)) : projectName(s) }));
        const cmd = (id: string, label: string, run: () => void, hint?: string): PaletteCommand => ({ kind: 'command', id, label, run, ...(hint ? { hint } : {}) });
        // Around OpenRig's (the palette makes them): « Nouvelle session » first; the dispositions, then « Enregistrer… », last.
        const before = [cmd('new-session', p.newSession, () => dispatch({ type: 'modal', modal: { kind: 'launch' } }))];
        const after: PaletteCommand[] = [
          cmd('atelier', p.atelier, () => dispatch(tabAction(ATELIER_TAB)!)),
          cmd('settings', p.settings, () => dispatch(tabAction(SETTINGS_TAB)!)),
          cmd('terminal', p.terminal, () => { const k = pickDefault(); openShell(k, menuDir(k, shellDir()), id => wsStore.update(w => openTab(w, { kind: 'terminal', ref: id }, 'active'))); }),
          cmd('split', p.split, () => wsStore.update(w => splitGroup(w, w.focus))),
          cmd('bottom', p.bottom, () => onLayout({ type: 'toggle', panel: 'bottom' })),
          ...dispositions.map(d => cmd(`disposition:${d.name}`, p.disposition(d.name), () => applyAndTell(d.name), d.name === currentDisposition?.name ? t.ide.palette.current : undefined)),
          cmd('save-disposition', p.saveDisposition, () => setSaveAsk(n => n + 1))
        ];
        // « MR et PR » and one row per open MR or PR come with the MR/PR view (lot 8b): `prs` is where they go.
        const rigs = { client: fleetClient, machines, shown: rigsMachine, act: {
          launch: () => dispatch({ type: 'modal', modal: { kind: 'rigLaunch', machine: rigsMachine } }),
          rigView: (m: string, rig: string) => wsStore.update(w => openTab(w, rigTab(m, rig))),
          section: (section: OpenRigSection) => dispatch({ type: 'openrig', machine: rigsMachine, section }),
          // The machine the Rigs view shows: the view comes forward with it.
          showMachine: (id: string) => { setRigsMachine(id); if (!layout.sideOpen || layout.sideView !== 'rigs') onLayout({ type: 'view', view: 'rigs' }); }
        } };
        return <IdePaletteHost sessions={rows} commands={{ before, after }} rigs={rigs} prs={[]} sessionOf={id => known.find(s => s.id === id)} onClose={close} />;
      })()}
      {nav.modal?.kind === 'shortcuts' && <ShortcutsHelp onClose={close} />}
      {nav.modal?.kind === 'launch' && (
        // No `wide`: the modal's own width (ide.css, `.modal:has(> .launch-modal)`), not the old form's 640 px.
        <Modal title={t.modalTitles.launch} onClose={close}>
          <LaunchModalPlace client={fleetClient} projects={projects?.projects ?? NO_PROJECTS} machines={machines} sessions={sessions} projectIdOf={projectIdOf}
            wanted={{ ...(nav.modal.project !== undefined && { project: nav.modal.project }), ...(filter && { filter }) }}
            usage={{ groups: usage.groups, threshold: usage.threshold, now: usage.now }} where={openWhere(openSession, nav.modal.from === 'plus' ? 'plus' : 'other')}
            onNewProject={() => dispatch({ type: 'modal', modal: { kind: 'project' } })}
            launch={launcher.state} onLaunch={(msg, preview, where) => { launched.current = { ...preview, where }; launcher.launch(msg); }} onCancel={close} />
        </Modal>
      )}
      {nav.modal?.kind === 'rigLaunch' && (
        // No `wide`: the modal's own width (ide-launch-rig.css, `.modal:has(> .ide-rl)`, 720 px). A launch closes it and opens the
        // rig's tab; the operator's request opens its session, or says where it went when Ledge does not follow that session yet (R6).
        <Modal title={t.ide.launchRig.title} onClose={close}>
          <IdeRigLaunch client={fleetClient} machines={machines} machine={nav.modal.machine ?? rigsMachine} projects={projects} sessions={sessions} onClose={close}
            onLaunched={(machine, rig) => { close(); wsStore.update(w => openTab(w, rigTab(machine, rig))); }}
            onOperator={id => { close(); if (id) dispatch({ type: 'open', id }); else notify(t.ide.launchRig.composing); }} />
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
        ide={ideSessionMenu} />
      <WhatsNew />
      {actions.pending && <ConfirmDialog c={actions.pending} onConfirm={actions.confirm} onCancel={actions.cancel} />}
      <PairingDialog shown={pairing} mobile={mobile} fleet={fleet} notify={notify} />
      <Toast notice={notice} action={noticeAction} onAction={toastAct} />
    </TabExtrasContext.Provider></TermStoreContext.Provider></ScreenKeysContext.Provider>
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
