import { useEffect, useMemo, useState, type JSX, type MouseEvent } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { Project, Projects, Session } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { useMotionPreferences } from '../motionPreferences';
import { activeCount } from '../nav/agents';
import { openSessionTerminal } from '../session/terminal';
import { RenameDialog, SessionMenu } from '../manage/SessionMenu';
import type { SessionActions } from '../manage/useSessionActions';
import { useScreenKeys } from '../nav/screenKeys';
import type { NavAction, NavState } from '../nav/state';
import { roomWidth, sceneOf, walkOrder } from './layout';
import { LedgeDesk } from './LedgeDesk';
import { ProjectTable } from './ProjectTable';
import { Unassigned } from './Unassigned';
import { useAtelierView } from './useAtelierView';
import { folderOf, type Filing } from './filing';
import { LEDGE_TILE, ZONE_TILE } from './zoom';
import { ProjectSwatch } from '../projects/ProjectSwatch';

export interface AtelierProps {
  nav: NavState; dispatch: (a: NavAction) => void;
  sessions: readonly Session[]; projects: Projects | null; order: readonly Session[];
  projectIdOf: (s: Session) => string | null;
  /** Putting the agents of « Sans projet » away: the tables are targets, the cards drag, « Ranger dans… » files. */
  filing: Filing;
  /** The session menu and its keys (E, Suppr, F2, T): end, archive, resume and delete with their confirmation. */
  actions: SessionActions;
  /** Terminal, rename and the keys talk to the daemon through it. */
  client: DaemonClient;
  notify(text: string): void;
}

/** The filtered project has no agent yet: say where its table will appear, and offer to start a session there. */
function EmptyProject({ project, dispatch }: { project: Project; dispatch: (a: NavAction) => void }): JSX.Element {
  const { t } = useI18n();
  const where = project.repos.map(r => folderOf(r.path)).join(' · ') || t.atelier.empty.noRepo;
  return (
    <div className="empty-project">
      <ProjectSwatch project={project} />
      <h2>{t.atelier.empty.title(project.name)}</h2>
      <p>{t.atelier.empty.body(where)}</p>
      <Button variant="primary" onClick={() => dispatch({ type: 'modal', modal: { kind: 'launch', project: project.id } })}>
        <Icon d={ICONS.plus.d} size={14} />{t.atelier.newSession}
      </Button>
    </div>
  );
}

/** The atelier (observatory.tsx, atelier mode): Ledge's desk, a table per project with agents, the filtered project's
 *  empty state, « Sans projet », then the legend; the zoom bar beside it. The mosaic is fitted to the space, zoomed and panned
 *  (useAtelierView). J / K (or ↓ / ↑) walk the agents shown, Entrée opens the chosen one; + / − / 0 zoom, Space pans. */
export function Atelier({ nav, dispatch, sessions, projects, order, projectIdOf, filing, actions, client, notify }: AtelierProps): JSX.Element {
  const { t } = useI18n();
  const { reduced } = useMotionPreferences();
  const { place } = nav;
  const filter = place.kind === 'settings' ? place.back.project : place.project;
  const scene = useMemo(() => sceneOf(order, projects, projectIdOf, filter), [order, projects, projectIdOf, filter]);
  const walk = useMemo(() => walkOrder(scene), [scene]);

  const [focusedId, setFocusedId] = useState<string | null>(null);
  // The chosen agent left the walk (gone, filed elsewhere, filtered out): nothing stays chosen.
  useEffect(() => { if (focusedId !== null && !walk.some(s => s.id === focusedId)) setFocusedId(null); }, [walk, focusedId]);

  // The session menu (one at a time) and where the focus goes back when it closes; the session being renamed.
  const [menu, setMenu] = useState<{ id: string; at: { x: number; y: number }; opener: HTMLElement | null } | null>(null);
  const [renaming, setRenaming] = useState<Session | null>(null);
  const menuSession = menu ? sessions.find(s => s.id === menu.id) ?? null : null;
  useEffect(() => { if (menu !== null && menuSession === null) setMenu(null); }, [menu, menuSession]);
  const menuAt = (s: Session, e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    // A right click opens at the pointer (the keyboard's menu key reports none: under the seat); the « … » opens under itself.
    const pointer = e.type === 'contextmenu' && (e.clientX !== 0 || e.clientY !== 0);
    setMenu({ id: s.id, at: pointer ? { x: e.clientX, y: e.clientY } : { x: r.left, y: r.bottom + 4 }, opener: el.matches('button') ? el : el.querySelector<HTMLElement>('button[data-agent]') });
  };
  const closeMenu = () => {
    const opener = menu?.opener;
    setMenu(null);
    // The menu's own button (the « … ») is given the focus by the menu itself; a context menu has none: back to the seat.
    const active = document.activeElement;
    if (opener?.isConnected && (active === null || active === document.body || active.closest('[role=menu]'))) opener.focus();
  };
  const terminal = (s: Session) => { void openSessionTerminal(client, s).then(ok => { if (!ok) notify(t.session.terminal.openFailed(s.name)); }); };
  const rename = (s: Session) => { if (s.state !== 'exited') setRenaming(s); };

  // The mosaic's tiles, in render order: Ledge's desk, the tables, then the empty project or « Sans projet ».
  const tiles = useMemo(() => [
    LEDGE_TILE, ...scene.tables.map(t => roomWidth(t.mains.length)), ...(scene.empty || scene.unassigned.length > 0 ? [ZONE_TILE] : [])
  ], [scene]);
  const view = useAtelierView(tiles, [nav.helpers, nav.fullscreen, nav.chat, filter, sessions.length]);
  useScreenKeys(e => {
    if (view.keys(e)) return true;
    const target = e.target instanceof Element ? e.target : null;
    // Renaming owns the keyboard (Escape closes it in the dialog itself).
    if (renaming !== null) return false;
    if (target?.closest('[role=tablist],[role=menu]')) return false;
    const key = e.key.toLowerCase();
    const step = key === 'j' || key === 'arrowdown' ? 1 : key === 'k' || key === 'arrowup' ? -1 : 0;
    if (step !== 0) {
      if (walk.length === 0) return false;
      const i = walk.findIndex(s => s.id === focusedId);
      const next = walk[i < 0 ? (step > 0 ? 0 : walk.length - 1) : (i + step + walk.length) % walk.length]!;
      setFocusedId(next.id);
      // Compare ids as data, never build a selector from one.
      [...(view.scrollRef.current?.querySelectorAll<HTMLElement>('[data-agent]') ?? [])].find(el => el.dataset.agent === next.id)?.focus();
      return true;
    }
    // The chosen agent: E archives, Suppr deletes (each asks when it must), F2 renames, T opens its terminal.
    const chosen = focusedId === null ? undefined : sessions.find(s => s.id === focusedId);
    if (chosen) {
      if (key === 'e') { actions.request('archive', [chosen.id]); return true; }
      if (key === 'delete') { actions.request('delete', [chosen.id]); return true; }
      if (key === 'f2') { rename(chosen); return true; }
      if (key === 't') { terminal(chosen); return true; }
    }
    // A focused button or link keeps its own Entrée.
    if (e.key === 'Enter' && focusedId !== null && !target?.closest('button,a')) {
      dispatch({ type: 'open', id: focusedId });
      return true;
    }
    return false;
  });

  return (<>
    <div className="zoom-controls" role="toolbar" aria-label={t.zoom.bar}>
      <Button variant="ghost" size="icon" aria-label={t.zoom.out} title={t.zoom.outTitle} onClick={() => view.step(-1)}>−</Button>
      <button type="button" className="zoom-level" aria-label={t.zoom.reset} title={t.zoom.reset} onClick={() => view.zoomTo(1)}>{Math.round(view.zoom * 100)} %</button>
      <Button variant="ghost" size="icon" aria-label={t.zoom.in} title={t.zoom.inTitle} onClick={() => view.step(1)}>+</Button>
      <span className="zoom-sep" />
      <Button variant={view.fitted ? 'secondary' : 'ghost'} size="sm" aria-pressed={view.fitted} title={t.zoom.fitTitle} onClick={view.fit}>
        <Icon d={ICONS.expand.d} size={13} />{t.zoom.fit}
      </Button>
      <span className="zoom-hint">{t.zoom.hint}</span>
    </div>
    <div className="overview-scroll atelier" id="view-panel-atelier" role="tabpanel" aria-labelledby="view-tab-atelier" ref={view.scrollRef}>
      <div ref={view.shellRef} className={`office-shell ${nav.paused ? 'office-paused' : ''} ${reduced ? 'office-reduced' : ''}`}>
        <LedgeDesk count={activeCount(sessions)} chat={nav.chat} paused={nav.paused} onClick={() => dispatch({ type: 'chat' })} />
        <div className={`project-grid ${scene.tables.length === 1 ? 'focused' : ''}`}>
          {scene.tables.map(({ project, mains }) => (
            <ProjectTable key={project.id} project={project} mains={mains} order={order} helpers={nav.helpers} paused={nav.paused}
              isolated={filter === project.id} focusedId={focusedId} seated={filing.seated} dispatch={dispatch} filing={filing}
              actions={actions} menuId={menu?.id ?? null} onMenu={menuAt} />
          ))}
        </div>
        {scene.empty && <EmptyProject project={scene.empty} dispatch={dispatch} />}
        <Unassigned sessions={scene.unassigned} order={order} focusedId={focusedId} paused={nav.paused} dispatch={dispatch}
          filing={filing} projects={projects?.projects ?? []} onMenu={menuAt} />
      </div>
      <div className="workspace-legend">
        <span><i className="live-dot" />{t.atelier.legend.working}</span>
        <span><i className="approval-dot" />{t.atelier.legend.approval}</span>
        <span><i className="question-dot" />{t.atelier.legend.question}</span>
        <span><i className="done-dot" />{t.atelier.legend.done}</span>
        <span className="spacer" />
        <span>{t.atelier.legend.helper}</span>
      </div>
    </div>
    {menu && menuSession && (
      <SessionMenu session={menuSession} at={menu.at} actions={actions} filing={filing} projects={projects?.projects ?? []} current={projectIdOf(menuSession)}
        onOpen={s => dispatch({ type: 'open', id: s.id })} onTerminal={terminal} onRename={rename} onClose={closeMenu} />
    )}
    {renaming && <RenameDialog session={renaming} onRename={topic => client.send({ type: 'session.rename', id: renaming.id, topic })} onClose={() => setRenaming(null)} />}
  </>);
}
