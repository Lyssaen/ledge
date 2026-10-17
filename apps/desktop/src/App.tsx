import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { projectOf, useDaemon, useProjects, type DaemonClient, type Fleet, type MachineState } from '@ledge/fleet';
import type { Project, Projects, Session } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { LangProvider, loadLang, useI18n, type Lang } from './i18n/lang';
import { useFleet } from './fleet/useFleet';
import { useDecisions } from './fleet/decisions';
import { useWaits } from './fleet/waits';
import { useAlerts } from './notify/useAlerts';
import { getDnd, setDnd, useDnd } from './notify/prefs';
import { MarkdownLinks } from '@ledge/ui/documents/links';
// The reader's styles stay in the first bundle, before app.css (as when the reader itself was there): session.css overrides them.
import '@ledge/ui/documents/markdown.css';
import { onTrayAction, openUrl, setTrayLabels } from './tauri/bridge';
import { useAppearance } from './shell/theme';
import { initialNav, navReducer, reconcile, type NavAction, type NavState } from './nav/state';
import { loadOverview, saveOverview } from './nav/overview';
import { ScreenKeysContext, type ScreenKeys } from './nav/screenKeys';
import { mainOrder } from './nav/agents';
import { useKeys } from './nav/useKeys';
import { Sidebar } from './shell/Sidebar';
import { TopBar } from './shell/TopBar';
import { Footer } from './shell/Footer';
import { Pending } from './shell/Pending';
import { LaunchPlace, loadComposer } from './launch/lazy';
import { useLaunch } from './launch/useLaunch';
import { Atelier } from './atelier/Atelier';
import { List } from './list/List';
import { Modal } from './shell/Modal';
import { SearchPalette } from './shell/SearchPalette';
import { ShortcutsHelp } from './shell/ShortcutsHelp';
import { onFullscreenLeft, setWindowFullscreen } from './shell/fullscreen';
import { Toast, useToast } from './shell/Toast';
import { useFiling } from './atelier/filing';
import { loadWorkspace, SessionPlace } from './session/lazy';
import { createSessionMemory } from './session/memory';
import { loadSessionPrefs, saveSessionPrefs } from './session/prefs';
import { subagentOf } from './session/thread';
import { useStored } from './state/useStored';
import { draftOf, newDraft } from './projects/draft';
import { EditorPlace, loadEditor } from './projects/lazy';

const NO_PROJECTS: readonly Project[] = [];
const NO_STATE: Projects = { projects: [], rules: [] };

/** The navigation reducer, plus the fleet's corrections: a place naming a session or a project that is gone falls back. */
type ShellAction = NavAction | { type: 'reconcile'; sessions: readonly Session[]; projects: Projects | null };
const shellReducer = (s: NavState, a: ShellAction): NavState => (a.type === 'reconcile' ? reconcile(s, a.sessions, a.projects) : navReducer(s, a));

/** The Atelier's shell: sidebar, top bar, the current place (the atelier, the List, a session; the other screens wait for their lot), footer, chat and dialogs;
 *  the real fleet, toasts and sounds, and the tray. */
function Shell({ client }: { client?: DaemonClient }) {
  const fleetView = useFleet(client);
  const { sessions, machines, status, localDown, fleet, client: fleetClient, errors } = fleetView;
  const projects = useProjects(fleetClient);
  const { t, lang } = useI18n();
  const [nav, dispatch] = useReducer(shellReducer, undefined, () => initialNav(loadOverview()));
  // Toasts and sounds from session changes (spec 2026-10-14 §10); no daemon update can start before the settings (lot 10).
  useAlerts({ sessions, machines, status });
  // The tray's « Nouvelle session » opens its dialog; « Ne pas déranger » switches without showing the window.
  useEffect(() => onTrayAction(action => {
    if (action === 'dnd') setDnd(!getDnd());
    else if (action === 'new') dispatch({ type: 'modal', modal: { kind: 'launch' } });
  }), []);
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
  useEffect(() => { if (reconcile(nav, sessions, projects) !== nav) dispatch({ type: 'reconcile', sessions, projects }); }, [sessions, projects]);

  const projectIdOf = useCallback((s: Session) => (projects ? projectOf(s, projects) : null), [projects]);
  const projectName = useCallback((s: Session) => {
    const id = projectIdOf(s);
    return (id && projects?.projects.find(p => p.id === id)?.name) || t.side.unassigned;
  }, [projectIdOf, projects, t]);
  const waits = useWaits(sessions);
  const order = useMemo(() => mainOrder(sessions, projects), [sessions, projects]);
  // Putting an agent away: drag and drop or « Ranger dans… » write a folder rule; the toast says how it went.
  const { notice, notify } = useToast();
  const filing = useFiling({ fleet, projects, sessions, projectIdOf, notify });
  // Allow / Deny from the List (and, lot 6, the session): one send per request; a refusal or a silence is said in the toast.
  const decisions = useDecisions({ client: fleetClient, sessions, errors, notify });
  const screenKeys = useRef<ScreenKeys>({ current: null }).current;
  // Drafts, reading positions and the last item seen, per session and subagent: they survive navigation, not a restart.
  const memory = useRef(createSessionMemory()).current;
  useKeys(dispatch, { state: nav, order, screen: screenKeys });
  // The window may leave full screen by itself (Escape in a browser, the OS): the layout follows.
  useEffect(() => onFullscreenLeft(() => dispatch({ type: 'fullscreen', on: false })), []);
  // The window follows the full screen state (not at mount: nothing was asked yet).
  const fullscreenSeen = useRef(nav.fullscreen);
  useEffect(() => {
    if (fullscreenSeen.current === nav.fullscreen) return;
    fullscreenSeen.current = nav.fullscreen;
    void setWindowFullscreen(nav.fullscreen);
  }, [nav.fullscreen]);
  const session = place.kind === 'session' ? sessions.find(s => s.id === place.id) ?? null : null;
  // The subagent whose page is open, found as the Workspace finds it (live, else its thread row), for the top bar.
  const { threads } = useDaemon();
  const helper = session && place.kind === 'session' && place.helper !== undefined ? subagentOf(session, threads.get(session.id), place.helper, t.session.subagent) : null;
  // Whether the terminal shows beside a session: it follows from one agent to the next and survives a restart.
  const [sessionPrefs, setSessionPrefs] = useStored(loadSessionPrefs, saveSessionPrefs);
  // The session page's, the New session form's and the project editor's chunks are fetched once the shell is up, so a first opening rarely waits for them.
  useEffect(() => { void loadWorkspace(); void loadComposer(); void loadEditor(); }, []);
  const toggleTerminal = useCallback(() => setSessionPrefs(p => ({ ...p, terminal: !p.terminal })), [setSessionPrefs]);
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
    // The table is the launched session's own, once listed (the daemon lists it before answering); the preview's until then.
    const s = sessions.find(x => x.id === id);
    const own = s ? projects?.projects.find(p => p.id === projectIdOf(s)) : undefined;
    const table = own ? { id: own.id, name: own.name } : preview ? { id: preview.projectId, name: preview.project } : null;
    dispatch({ type: 'modal', modal: null });
    // Only the overview's filter follows; a session page (its rail's « New session here ») stays where it is.
    if (place.kind === 'overview' && place.project !== 'all' && place.project !== table?.id) dispatch({ type: 'home', project: 'all' });
    filing.markSeated(id);
    if (table) notify(t.launch.started(s?.name ?? preview?.name ?? '', table.name));
  });
  // The form closed (Escape, Cancel, another dialog): nothing is waited for any more; a late answer is not announced.
  const { reset: resetLaunch } = launcher;
  useEffect(() => { if (nav.modal?.kind !== 'launch') resetLaunch(); }, [nav.modal?.kind, resetLaunch]);
  // A project the daemon confirmed: the editor closes and the notice says what happened (with the agents filed, for a new one).
  const projectSaved = (id: string, created: boolean, filed: Session[]) => {
    dispatch({ type: 'modal', modal: null });
    const name = projects?.projects.find(p => p.id === id)?.name ?? id;
    notify(!created ? t.projects.saved(name)
      : filed.length > 0 ? t.projects.createdWith(name, new Intl.ListFormat(lang, { type: 'conjunction' }).format(filed.map(s => s.name)))
      : t.projects.created(name));
  };

  return (
    <ScreenKeysContext.Provider value={screenKeys}>
      <div className={`application ${nav.fullscreen ? 'immersive' : ''} ${filing.dragging ? 'is-dragging' : ''}`} data-readonly={localDown ? 'true' : undefined} inert={nav.modal !== null}>
        <Sidebar nav={nav} dispatch={dispatch} sessions={sessions} machines={machines} projects={projects} order={order} projectIdOf={projectIdOf} filing={filing} />
        <section className="workspace">
          <TopBar nav={nav} dispatch={dispatch} session={session} helper={helper} projects={projects} projectIdOf={projectIdOf} terminal={sessionPrefs.terminal} onTerminal={toggleTerminal} />
          {place.kind === 'settings' ? <Pending title={t.sections[place.section]} />
            : session && place.kind === 'session' ? <SessionPlace client={fleetClient} session={session} nav={nav} dispatch={dispatch} decisions={decisions} waits={waits} memory={memory} notify={notify}
                prefs={sessionPrefs} setPrefs={setSessionPrefs} order={order} projects={projects} projectIdOf={projectIdOf} />
            : view === 'atelier' ? <Atelier nav={nav} dispatch={dispatch} sessions={sessions} projects={projects} order={order} projectIdOf={projectIdOf} filing={filing} />
            : <List nav={nav} dispatch={dispatch} order={order} projects={projects} projectIdOf={projectIdOf} machines={machines} decisions={decisions} filing={filing} waits={waits} />}
          {onOverview && <Footer dispatch={dispatch} localDown={localDown} />}
        </section>
        {nav.chat && (
          <aside className="ledge-chat-panel" aria-label={t.side.chat}>
            <div className="chat-drawer-content"><Pending title={t.side.chat} /></div>
            <Button variant="ghost" size="icon" className="chat-close" aria-label={t.close} onClick={() => dispatch({ type: 'chat', open: false })}><Icon d={ICONS.close.d} /></Button>
          </aside>
        )}
      </div>
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
        <ProjectDialog key={`${nav.modal.edit ?? ''}|${nav.modal.file ?? ''}`} edit={nav.modal.edit} file={nav.modal.file} projects={projects} sessions={sessions} machines={machines}
          client={fleetClient} fleet={fleet} projectIdOf={projectIdOf} onClose={close} onSaved={projectSaved} />
      )}
      <Toast notice={notice} />
    </ScreenKeysContext.Provider>
  );
}

/** The project editor's dialog (sidebar « + », a table's « Modifier le projet », « Ranger dans… › Nouveau projet… », the New session form).
 *  The draft is taken once, at opening: an unknown project closes the dialog, but one deleted elsewhere while it is edited stays,
 *  and the editor says so on « Enregistrer ». */
function ProjectDialog({ edit, file, projects, sessions, machines, client, fleet, projectIdOf, onClose, onSaved }: {
  edit?: string; file?: string; projects: Projects | null; sessions: readonly Session[]; machines: readonly MachineState[];
  client: DaemonClient; fleet: Pick<Fleet, 'setProjects'>; projectIdOf(s: Session): string | null; onClose(): void; onSaved(id: string, created: boolean, filed: Session[]): void;
}) {
  const { t } = useI18n();
  const [initial] = useState(() => {
    const state = projects ?? NO_STATE;
    if (edit === undefined) return newDraft(state, file === undefined ? undefined : sessions.find(s => s.id === file));
    const p = state.projects.find(x => x.id === edit);
    return p ? draftOf(p) : null;
  });
  useEffect(() => { if (initial === null) onClose(); }, [initial, onClose]);
  if (initial === null) return null;
  const current = projects?.projects.find(p => p.id === initial.id);
  const title = edit !== undefined ? t.projects.titles.edit(current?.name ?? initial.name) : t.projects.titles.new;
  return (
    <Modal title={title} wide className="project-modal" onClose={onClose}>
      <EditorPlace mode={edit !== undefined ? 'edit' : 'new'} initial={initial} projects={projects ?? NO_STATE} sessions={sessions} machines={machines}
        client={client} fleet={fleet} projectIdOf={projectIdOf} onClose={onClose} onSaved={onSaved} onDeleted={onClose} />
    </Modal>
  );
}

export function App({ client }: { client?: DaemonClient } = {}) {
  const [lang] = useState<Lang>(loadLang);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useAppearance();
  return <LangProvider lang={lang}><MarkdownLinks.Provider value={openUrl}><Shell client={client} /></MarkdownLinks.Provider></LangProvider>;
}
