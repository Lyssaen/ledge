import { useEffect, useMemo, useRef, useState, type DragEvent, type JSX, type MouseEvent, type ReactNode } from 'react';
import type { Project, Projects, Session } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { useMotionPreferences } from '../motionPreferences';
import { activeCount } from '../nav/agents';
import type { SessionMenuState } from '../manage/useSessionMenu';
import type { SessionActions } from '../manage/useSessionActions';
import { useScreenKeys } from '../nav/screenKeys';
import type { NavAction, NavState } from '../nav/state';
import { roomTileWidth, sceneOf, walkOrder, type AtelierTable } from './layout';
import { ProjectRoom } from './ProjectRoom';
import { RoleChooser, type RoleChoice } from './RoleChooser';
import type { TeamsApi } from '../teams/useTeamsApi';
import { Modal } from '../shell/Modal';
import { LedgeDesk } from './LedgeDesk';
import { MessageLayer, useMessageClock } from './MessageLayer';
import { ProjectTable } from './ProjectTable';
import { useSeats } from './seats';
import { Unassigned } from './Unassigned';
import { useAtelierView } from './useAtelierView';
import { folderOf, type Filing } from './filing';
import { ZONE_TILE } from './zoom';
import { ProjectSwatch } from '../projects/ProjectSwatch';

export interface AtelierProps {
  nav: NavState; dispatch: (a: NavAction) => void;
  sessions: readonly Session[]; projects: Projects | null; order: readonly Session[];
  projectIdOf: (s: Session) => string | null;
  /** Putting the agents of « Sans projet » away: the tables are targets, the cards drag, « Ranger dans… » files. */
  filing: Filing;
  /** The session menu and its keys (E, Suppr, F2, T): end, archive, resume and delete with their confirmation. */
  actions: SessionActions;
  /** The session menu's state, shared with the session page's header (the shell renders the menu): the seats open it, the keys use its terminal and rename. */
  menu: SessionMenuState;
  /** More buttons at the end of the zoom bar (the detached Atelier's way out of full screen). */
  tools?: ReactNode;
  /** The live teams and Ledge's tasks (atelier rooms spec): a table per team, drag a seat to join or leave. */
  teams?: TeamsApi;
  /** The archived sessions: a resting team's seats are drawn from them. */
  archived?: readonly Session[];
  /** Says what happened (a join, a leave) in the shell's toast. */
  notify?: (text: string) => void;
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
export function Atelier({ nav, dispatch, sessions, projects, order, projectIdOf, filing, actions, menu, tools, teams, archived = [], notify }: AtelierProps): JSX.Element {
  const { t } = useI18n();
  const { reduced } = useMotionPreferences();
  const { place } = nav;
  const filter = place.kind === 'settings' ? place.back.project : place.project;
  const lookup = useMemo(() => { const byId = new Map([...archived, ...sessions].map(s => [s.id, s])); return (id: string) => byId.get(id); }, [archived, sessions]);
  const scene = useMemo(() => sceneOf(order, projects, projectIdOf, filter, teams?.teams ?? [], lookup), [order, projects, projectIdOf, filter, teams?.teams, lookup]);
  // A seat carried to another table (§3.3): a team table asks the role, the room's common table leaves the team, another room files it there.
  const carried = useRef<Session | null>(null);
  const [overTable, setOverTable] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<RoleChoice | null>(null);
  const [dissolving, setDissolving] = useState<{ id: string; name: string } | null>(null);
  const seatDrag = teams ? (s: Session) => (s.offline || s.source === 'hook_only' ? undefined : {
    draggable: true as const,
    onDragStart(e: DragEvent) { e.dataTransfer.setData('text/plain', s.id); e.dataTransfer.effectAllowed = 'move'; carried.current = s; },
    onDragEnd() { carried.current = null; setOverTable(null); }
  }) : undefined;
  const tableDrop = (table: AtelierTable, projectId: string) => (teams ? {
    over: overTable === table.key,
    onDragOver(e: DragEvent) { if (!carried.current) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOverTable(table.key); },
    onDragLeave(e: DragEvent) { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverTable(o => (o === table.key ? null : o)); },
    onDrop(e: DragEvent) {
      const s = carried.current; carried.current = null; setOverTable(null);
      if (!s) return;
      e.preventDefault(); e.stopPropagation();
      if (table.kind === 'team' && table.team) {
        if (s.team === table.team.id) return;
        setChoosing({ session: s, team: table.team, at: { x: e.clientX, y: e.clientY } });
        return;
      }
      // Another room: filed in that project (the folder rule), and out of its team.
      if (projectIdOf(s) !== projectId) filing.file(s, projectId);
      if (s.team) { teams.leave(s.team, s.id); notify?.(t.teams.left(s.name)); }
    }
  } : undefined);
  const [seats] = useSeats();
  const walk = useMemo(() => walkOrder(scene, seats), [scene, seats]);
  const clock = useMessageClock(sessions);

  const [focusedId, setFocusedId] = useState<string | null>(null);
  // The chosen agent left the walk (gone, filed elsewhere, filtered out): nothing stays chosen.
  useEffect(() => { if (focusedId !== null && !walk.some(s => s.id === focusedId)) setFocusedId(null); }, [walk, focusedId]);

  const menuAt = (s: Session, e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    // A right click opens at the pointer (the keyboard's menu key reports none: under the seat); the « … » opens under itself.
    const pointer = e.type === 'contextmenu' && (e.clientX !== 0 || e.clientY !== 0);
    menu.open(s.id, pointer ? { x: e.clientX, y: e.clientY } : { x: r.left, y: r.bottom + 4 }, el.matches('button') ? el : el.querySelector<HTMLElement>('button[data-agent]'));
  };

  // The mosaic's tiles, in render order: the tables, then the empty project or « Sans projet » (Ledge sits in the corner, outside it).
  const tiles = useMemo(() => [
    ...scene.rooms.map(r => roomTileWidth(r.tables, seats)), ...(scene.empty || scene.unassigned.length > 0 ? [ZONE_TILE] : [])
  ], [scene, seats]);
  const view = useAtelierView(tiles, [nav.helpers, nav.fullscreen, nav.chat, filter, sessions.length]);
  useScreenKeys(e => {
    if (view.keys(e)) return true;
    const target = e.target instanceof Element ? e.target : null;
    // Renaming owns the keyboard (Escape closes it in the dialog itself).
    if (menu.renaming !== null) return false;
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
      if (key === 'f2' && !chosen.offline) { menu.rename(chosen); return true; }
      if (key === 't') { menu.terminal(chosen); return true; }
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
      {tools}
    </div>
    <div className="overview-scroll atelier" id="view-panel-atelier" role="region" aria-label={t.side.atelier} ref={view.scrollRef}>
      <div ref={view.floorRef} className="atelier-floor">
        <div ref={view.shellRef} className={`office-shell ${nav.paused ? 'office-paused' : ''} ${reduced ? 'office-reduced' : ''}`}>
          <MessageLayer sessions={sessions} clock={clock} paused={nav.paused} reduced={reduced} dispatch={dispatch} />
          <LedgeDesk count={activeCount(sessions)} chat={nav.chat} paused={nav.paused} onClick={() => dispatch({ type: 'chat' })} />
          <div className={`project-grid ${scene.rooms.length === 1 ? 'focused' : ''}`}>
            {scene.rooms.map(({ project, tables }) => (
              <ProjectRoom key={project.id} project={project} tables={tables} width={roomTileWidth(tables, seats)} dispatch={dispatch}>
                {tables.map(table => (
                  <ProjectTable key={table.key} table={table} roomHasTeams={tables.some(x => x.kind === 'team')} project={project} mains={table.mains} order={order} helpers={nav.helpers} seats={seats} paused={nav.paused}
                    isolated={filter === project.id} focusedId={focusedId} seated={filing.seated} dispatch={dispatch} filing={filing}
                    actions={actions} menuId={menu.menu?.id ?? null} onMenu={menuAt}
                    teamTasks={table.team ? teams?.tasks.filter(x => x.team === table.team!.id) : undefined}
                    teamActions={teams && { resume: teams.resume, dissolve: (id, name) => setDissolving({ id, name }), tasks: () => dispatch({ type: 'ledge', tab: 'tasks' }) }}
                    seatDrag={seatDrag} tableDrop={tableDrop(table, project.id)} />
                ))}
              </ProjectRoom>
            ))}
          </div>
          {scene.empty && <EmptyProject project={scene.empty} dispatch={dispatch} />}
          <Unassigned sessions={scene.unassigned} order={order} focusedId={focusedId} paused={nav.paused} dispatch={dispatch}
            filing={filing} projects={projects?.projects ?? []} onMenu={menuAt} />
        </div>
      </div>
      {choosing && teams && (
        <RoleChooser choice={choosing} teams={teams} onClose={() => setChoosing(null)}
          onChoose={role => { teams.join(choosing.team.id, choosing.session.id, role); notify?.(t.teams.joined(choosing.session.name, choosing.team.name, role)); setChoosing(null); }} />
      )}
      {dissolving && teams && (
        <Modal title={t.teams.dissolveTitle(dissolving.name)} role="alertdialog" className="confirm-modal" onClose={() => setDissolving(null)}>
          <div className="confirm-content">
            <p>{t.teams.dissolveBody}</p>
            <div className="confirm-actions">
              <Button autoFocus onClick={() => setDissolving(null)}>{t.manage.confirm.cancel}</Button>
              <Button variant="primary" className="danger-btn" onClick={() => { teams.dissolve(dissolving.id); setDissolving(null); }}>{t.teams.dissolve}</Button>
            </div>
          </div>
        </Modal>
      )}
      <div className="workspace-legend">
        <span><i className="live-dot" />{t.atelier.legend.working}</span>
        <span><i className="approval-dot" />{t.atelier.legend.approval}</span>
        <span><i className="question-dot" />{t.atelier.legend.question}</span>
        <span><i className="done-dot" />{t.atelier.legend.done}</span>
        <span className="spacer" />
        <span>{t.atelier.legend.helper}</span>
      </div>
    </div>
  </>);
}
