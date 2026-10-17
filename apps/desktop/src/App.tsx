import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { projectOf, useProjects, type DaemonClient } from '@ledge/fleet';
import type { Projects, Session } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { LangProvider, loadLang, useI18n, type Lang } from './i18n/lang';
import { useFleet } from './fleet/useFleet';
import { useDecisions } from './fleet/decisions';
import { useWaits } from './fleet/waits';
import { useAlerts } from './notify/useAlerts';
import { getDnd, setDnd, useDnd } from './notify/prefs';
import { MarkdownLinks } from '@ledge/ui/documents/markdown';
import { onTrayAction, openUrl, setTrayLabels } from './tauri/bridge';
import { useAppearance } from './shell/theme';
import { initialNav, navReducer, reconcile, type NavAction, type NavState } from './nav/state';
import { loadOverview, saveOverview } from './nav/overview';
import { ScreenKeysContext, type ScreenKeys } from './nav/screenKeys';
import { mainOrder, taskOf } from './nav/agents';
import { useKeys } from './nav/useKeys';
import { Sidebar } from './shell/Sidebar';
import { TopBar } from './shell/TopBar';
import { Footer } from './shell/Footer';
import { Pending } from './shell/Pending';
import { Atelier } from './atelier/Atelier';
import { List } from './list/List';
import { Modal } from './shell/Modal';
import { SearchPalette } from './shell/SearchPalette';
import { ShortcutsHelp } from './shell/ShortcutsHelp';
import { onFullscreenLeft, setWindowFullscreen } from './shell/fullscreen';
import { Toast, useToast } from './shell/Toast';
import { useFiling } from './atelier/filing';

/** The navigation reducer, plus the fleet's corrections: a place naming a session or a project that is gone falls back. */
type ShellAction = NavAction | { type: 'reconcile'; sessions: readonly Session[]; projects: Projects | null };
const shellReducer = (s: NavState, a: ShellAction): NavState => (a.type === 'reconcile' ? reconcile(s, a.sessions, a.projects) : navReducer(s, a));

/** The Atelier's shell: sidebar, top bar, the current place (the atelier, the List; the other screens wait for their lot), footer, chat and dialogs;
 *  the real fleet, toasts and sounds, and the tray. */
function Shell({ client }: { client?: DaemonClient }) {
  const { sessions, machines, status, localDown, fleet, client: fleetClient, errors } = useFleet(client);
  const projects = useProjects(fleetClient);
  const { t } = useI18n();
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
  const close = () => dispatch({ type: 'modal', modal: null });
  const onOverview = place.kind === 'overview' || (place.kind === 'session' && !session);

  return (
    <ScreenKeysContext.Provider value={screenKeys}>
      <div className={`application ${nav.fullscreen ? 'immersive' : ''} ${filing.dragging ? 'is-dragging' : ''}`} data-readonly={localDown ? 'true' : undefined} inert={nav.modal !== null}>
        <Sidebar nav={nav} dispatch={dispatch} sessions={sessions} machines={machines} projects={projects} order={order} projectIdOf={projectIdOf} filing={filing} />
        <section className="workspace">
          <TopBar nav={nav} dispatch={dispatch} session={session} projects={projects} projectIdOf={projectIdOf} />
          {place.kind === 'settings' ? <Pending title={t.sections[place.section]} />
            : session ? <Pending title={place.kind === 'session' && place.helper !== undefined ? session.helpers.find(h => h.id === place.helper)?.task ?? taskOf(session) : taskOf(session)} />
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
      {(nav.modal?.kind === 'launch' || nav.modal?.kind === 'project') && (() => {
        const title = nav.modal.kind === 'project' && nav.modal.edit !== undefined ? t.modalTitles.editProject : t.modalTitles[nav.modal.kind];
        return <Modal title={title} wide onClose={close}><Pending title={title} /></Modal>;
      })()}
      <Toast notice={notice} />
    </ScreenKeysContext.Provider>
  );
}

export function App({ client }: { client?: DaemonClient } = {}) {
  const [lang] = useState<Lang>(loadLang);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useAppearance();
  return <LangProvider lang={lang}><MarkdownLinks.Provider value={openUrl}><Shell client={client} /></MarkdownLinks.Provider></LangProvider>;
}
