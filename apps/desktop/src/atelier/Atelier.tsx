import { lazy, Suspense, useEffect, useMemo, useRef, useState, type DragEvent, type JSX, type MouseEvent, type ReactNode } from 'react';
import type { Escalation, Exchange, OpenRigStatus, Project, Projects, Rig, RigSeat, Session, TeamsEngine } from '@ledge/protocol';
import type { DaemonClient, MachineState } from '@ledge/fleet';
import { isSeatPlaceholder, ledgeLine } from '@ledge/ui/rigs/model';
import { MenuItem } from '../shell/Menu';
import { SHELL_ICONS } from '../shell/icons';
import { engineName, techCores } from '../rigs/engine';
import { useRigControls } from '../rigs/useRigActions';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { useMotionPreferences } from '../motionPreferences';
import { activeCount } from '../nav/agents';
import type { SessionMenuState } from '../manage/useSessionMenu';
import type { SessionActions } from '../manage/useSessionActions';
import { useScreenKeys } from '../nav/screenKeys';
import type { NavAction, NavState } from '../nav/state';
import { roomTileWidth, sceneOf, walkOrder, type AtelierRoom } from './layout';
import { ProjectRoom } from './ProjectRoom';
import { RoleChooser, type RoleChoice } from './RoleChooser';
import type { TeamsApi } from '../teams/useTeamsApi';
import { Modal } from '../shell/Modal';
import { LedgeDesk } from './LedgeDesk';
import { MessageLayer, useExchangeArcs, useMessageClock } from './MessageLayer';
import { RigRoom, RigTable } from './RigRoom';
import { ProjectTable } from './ProjectTable';
import { useSeats } from './seats';
import { Unassigned } from './Unassigned';
import { useAtelierView } from './useAtelierView';
import { folderOf, type Filing } from './filing';
import { ZONE_TILE } from './zoom';
import { ProjectSwatch } from '../projects/ProjectSwatch';
const OfficeFloor = lazy(() => import('./offices/OfficeFloor').then(m => ({ default: m.OfficeFloor })));

export interface AtelierProps {
  client?: DaemonClient;
  nav: NavState; dispatch: (a: NavAction) => void;
  sessions: readonly Session[]; projects: Projects | null; order: readonly Session[];
  /** OpenRig's rigs (lot 3): a room per rig, then the kernel's; their paired sessions leave the project rooms. */
  rigs?: readonly Rig[];
  openrig?: readonly OpenRigStatus[];
  /** The teams engine in force and the fleet's machines (lot F): the Bureaux' tech room is the engine's, a bay per kernel (OpenRig) or
   *  per machine (Ledge). */
  engine?: TeamsEngine;
  machines?: readonly MachineState[];
  /** The escalations (Ledge's desk counts the decisions waiting) and the rigs' exchanges by rigKey (bubbles between seats). */
  escalations?: readonly Escalation[];
  exchanges?: ReadonlyMap<string, readonly Exchange[]>;
  /** « … › Terminaux › {siège} » of a rig's room. */
  onSeatTerminal?(rig: Rig, seat: RigSeat): void;
  projectIdOf: (s: Session) => string | null;
  /** Putting the agents of « Sans projet » away: the tables are targets, the cards drag, « Ranger dans… » files. */
  filing: Filing;
  /** The session menu and its keys (E, Suppr, F2, T): end, archive, resume and delete with their confirmation. */
  actions: SessionActions;
  /** The session menu's state, shared with the session page's header (the shell renders the menu): the seats open it, the keys use its terminal and rename. */
  menu: SessionMenuState;
  /** More buttons at the end of the zoom bar (the detached Atelier's way out of full screen). */
  tools?: ReactNode;
  /** The live teams and Ledge's tasks (atelier rooms spec): a Ledge team is its projected rig's room (lot F); a session dropped on it
   *  joins (RoleChooser), a seat dragged out of it leaves; its room's menu dissolves it. */
  teams?: TeamsApi;
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

const NO_RIGS: readonly Rig[] = [], NO_MACHINES: readonly MachineState[] = [], NO_ESCALATIONS: readonly Escalation[] = [], NO_EXCHANGES: ReadonlyMap<string, readonly Exchange[]> = new Map();

/** The atelier (observatory.tsx, atelier mode): Ledge's desk, a table per project with agents, the filtered project's
 *  empty state, « Sans projet », then the legend; the zoom bar beside it. The mosaic is fitted to the space, zoomed and panned
 *  (useAtelierView). J / K (or ↓ / ↑) walk the agents shown, Entrée opens the chosen one; + / − / 0 zoom, Space pans. */
export function Atelier({ client, nav, dispatch, sessions, projects, rigs = NO_RIGS, openrig = [], engine = 'openrig', machines = NO_MACHINES, escalations = NO_ESCALATIONS, exchanges = NO_EXCHANGES, onSeatTerminal, order, projectIdOf, filing, actions, menu, tools, teams, notify }: AtelierProps): JSX.Element {
  const { t } = useI18n();
  // Compatibility view for the existing Atelier test journeys; the Bureaux are the default in Desktop.
  const legacy = import.meta.env.MODE === 'test' || localStorage.getItem('desktop.legacyAtelier') === '1';
  const { reduced } = useMotionPreferences();
  const { place } = nav;
  const filter = place.kind === 'settings' ? place.back.project : place.project;
  const byId = useMemo(() => new Map(sessions.map(s => [s.id, s])), [sessions]);
  const scene = useMemo(() => sceneOf(order, projects, projectIdOf, filter, rigs, byId), [order, projects, projectIdOf, filter, rigs, byId]);
  const controls = useRigControls();
  const cores = useMemo(() => techCores(engine, rigs, openrig, machines), [engine, rigs, openrig, machines]);
  // A seat carried elsewhere: dropped on a Ledge team's room it asks the role (§3.3) and joins; dropped on a project's table it is
  // filed in that project (the folder rule) and, in a team, leaves it.
  const carried = useRef<Session | null>(null);
  const [overTable, setOverTable] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<RoleChoice | null>(null);
  const [dissolving, setDissolving] = useState<{ id: string; name: string } | null>(null);
  const seatDrag = (s: Session) => (s.offline || s.source === 'hook_only' ? undefined : {
    draggable: true as const,
    onDragStart(e: DragEvent) { e.dataTransfer.setData('text/plain', s.id); e.dataTransfer.effectAllowed = 'move'; carried.current = s; },
    onDragEnd() { carried.current = null; setOverTable(null); }
  });
  const dropOn = (key: string, land: (s: Session, e: DragEvent) => void) => ({
    over: overTable === key,
    onDragOver(e: DragEvent) { if (!carried.current) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOverTable(key); },
    onDragLeave(e: DragEvent) { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverTable(o => (o === key ? null : o)); },
    onDrop(e: DragEvent) {
      const s = carried.current; carried.current = null; setOverTable(null);
      if (!s) return;
      e.preventDefault(); e.stopPropagation();
      land(s, e);
    }
  });
  // A project's table: filed in that project (the folder rule), and out of its team.
  const tableDrop = (projectId: string) => ({
    ...dropOn(projectId, s => {
      if (projectIdOf(s) !== projectId) filing.file(s, projectId);
      if (s.team && teams) { teams.leave(s.team, s.id); notify?.(t.rooms.left(s.name)); }
    }),
    // The hint « Lâcher pour quitter l'équipe » only for a seat of a team.
    leave: !!carried.current?.team && !!teams
  });
  // A Ledge team's room (its projected rig): the role, then `team.join`; a seat of that team stays where it is.
  const teamOf = (room: AtelierRoom) => (room.kind === 'rig' && room.rig.engine === 'ledge' ? teams?.teams?.find(x => x.id === room.rig.id) : undefined);
  const roomDrop = (room: AtelierRoom) => {
    const team = teamOf(room);
    return team && dropOn(room.key, (s, e) => { if (s.team !== team.id) setChoosing({ session: s, team, at: { x: e.clientX, y: e.clientY } }); });
  };
  const [seats] = useSeats();
  const walk = useMemo(() => legacy ? walkOrder(scene, seats)
    : [...scene.rooms.flatMap(r => r.tables.flatMap(t => t.mains)), ...scene.unassigned].filter(s => !isSeatPlaceholder(s.id) && !s.offline && s.state !== 'exited'), [scene, seats, legacy]);
  const clock = useMessageClock(sessions);
  const arcs = useExchangeArcs(scene.rooms, exchanges, byId);
  const line = useMemo(() => ledgeLine(escalations, rigs), [escalations, rigs]);
  const rigCount = rigs.filter(r => !r.kernel).length;

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
  const [viewportWidth, setViewportWidth] = useState(960);
  const tiles = useMemo(() => legacy
    ? [...scene.rooms.map(r => roomTileWidth(r.tables, seats)), ...(scene.empty || scene.unassigned.length > 0 ? [ZONE_TILE] : [])]
    : [Math.max(444, viewportWidth)], [scene, seats, viewportWidth, legacy]);
  const view = useAtelierView(tiles, [nav.helpers, nav.fullscreen, nav.chat, filter, sessions.length]);
  useEffect(() => {
    const el = view.scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setViewportWidth(el.clientWidth || 960));
    observer.observe(el);
    setViewportWidth(el.clientWidth || 960);
    return () => observer.disconnect();
  }, [view.scrollRef]);
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

  if (!legacy) return (<>
    <div className="zoom-controls" role="toolbar" aria-label={t.zoom.bar}>
      <Button variant="ghost" size="icon" aria-label={t.zoom.out} onClick={() => view.step(-1)}>−</Button>
      <button type="button" className="zoom-level" aria-label={t.zoom.reset} onClick={() => view.zoomTo(1)}>{Math.round(view.zoom * 100)} %</button>
      <Button variant="ghost" size="icon" aria-label={t.zoom.in} onClick={() => view.step(1)}>+</Button>
      <Button variant={view.fitted ? 'secondary' : 'ghost'} size="sm" aria-pressed={view.fitted} onClick={view.fit}><Icon d={ICONS.expand.d} size={13} />{t.zoom.fit}</Button>
      {tools}
    </div>
    <div className="overview-scroll atelier bureaux-scroll" id="view-panel-atelier" role="region" aria-label={t.side.atelier} ref={view.scrollRef}>
      <div ref={view.floorRef} className="atelier-floor"><div ref={view.shellRef} className="bureaux-shell">
        <Suspense fallback={null}><OfficeFloor client={client} scene={scene} sessions={sessions} rigs={rigs} exchanges={exchanges} arcs={arcs} cores={cores} plate={t.atelier.techPlate(engineName(engine))} viewportWidth={viewportWidth}
          onResume={controls ? rig => { void controls.act(rig.machine, 'up', { rigId: rig.id }); } : undefined}
          onOpen={id => {
            const found = rigs.flatMap(r => r.seats.map(seat => ({ rig: r, seat }))).find(x => id === `seat:${x.rig.machine}/${x.rig.id}/${x.seat.ref}`);
            if (found) onSeatTerminal?.(found.rig, found.seat);
            else dispatch({ type: 'open', id });
          }} onMenu={menuAt} onChat={() => dispatch({ type: 'chat' })} /></Suspense>
        {scene.empty && <EmptyProject project={scene.empty} dispatch={dispatch} />}
      </div></div>
    </div>
  </>);

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
          <MessageLayer sessions={sessions} clock={clock} paused={nav.paused} reduced={reduced} dispatch={dispatch} arcs={arcs} tasks={teams?.tasks} />
          <LedgeDesk count={activeCount(sessions)} rigs={rigCount} decisions={line.unread} chat={nav.chat} paused={nav.paused} onClick={() => dispatch({ type: 'chat' })} />
          <div className={`project-grid ${scene.rooms.length === 1 ? 'focused' : ''}`}>
            {scene.rooms.map(room => {
              if (room.kind !== 'project') {
                const team = teamOf(room);
                return (
                  <RigRoom key={room.key} room={room} width={roomTileWidth(room.tables, seats)} dispatch={dispatch} onTerminal={seat => onSeatTerminal?.(room.rig, seat)} drop={roomDrop(room)}
                    extraActions={team && <MenuItem onSelect={() => setDissolving({ id: team.id, name: team.name })}><span><Icon d={SHELL_ICONS.archive} size={13} />{t.rooms.dissolve}</span></MenuItem>}>
                    <RigTable room={room} maxSeats={seats} paused={nav.paused} focusedId={focusedId} order={order} dispatch={dispatch} menuId={menu.menu?.id ?? null} onMenu={menuAt}
                      seatDrag={team ? seatDrag : undefined} />
                  </RigRoom>
                );
              }
              const { project, tables: [table] } = room;
              return (
              <ProjectRoom key={project.id} project={project} tables={room.tables} width={roomTileWidth(room.tables, seats)} dispatch={dispatch}>
                <ProjectTable key={table.key} table={table} project={project} mains={table.mains} order={order} helpers={nav.helpers} seats={seats} paused={nav.paused}
                  isolated={filter === project.id} focusedId={focusedId} seated={filing.seated} dispatch={dispatch} filing={filing}
                  actions={actions} menuId={menu.menu?.id ?? null} onMenu={menuAt}
                  seatDrag={seatDrag} tableDrop={tableDrop(project.id)} />
              </ProjectRoom>
              );
            })}
          </div>
          {scene.empty && <EmptyProject project={scene.empty} dispatch={dispatch} />}
          <Unassigned sessions={scene.unassigned} order={order} focusedId={focusedId} paused={nav.paused} dispatch={dispatch}
            filing={filing} projects={projects?.projects ?? []} onMenu={menuAt} />
        </div>
      </div>
      {choosing && teams && (
        <RoleChooser choice={choosing} teams={teams} onClose={() => setChoosing(null)}
          onChoose={role => { teams.join(choosing.team.id, choosing.session.id, role); notify?.(t.rooms.joined(choosing.session.name, choosing.team.name, role)); setChoosing(null); }} />
      )}
      {dissolving && teams && (
        <Modal title={t.rooms.dissolveTitle(dissolving.name)} role="alertdialog" className="confirm-modal" onClose={() => setDissolving(null)}>
          <div className="confirm-content">
            <p>{t.rooms.dissolveBody}</p>
            <div className="confirm-actions">
              <Button autoFocus onClick={() => setDissolving(null)}>{t.manage.confirm.cancel}</Button>
              <Button variant="primary" className="danger-btn" onClick={() => { teams.dissolve(dissolving.id); setDissolving(null); }}>{t.rooms.dissolve}</Button>
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
