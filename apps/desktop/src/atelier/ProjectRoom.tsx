import { useState, type CSSProperties, type JSX, type ReactNode } from 'react';
import { PROJECT_COLORS, type Project, type Session } from '@ledge/protocol';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import type { NavAction } from '../nav/state';
import { Menu, MenuItem } from '../shell/Menu';
import { SHELL_ICONS } from '../shell/icons';
import { ProjectSwatch } from '../projects/ProjectSwatch';
import type { AtelierTable, RigRoomInfo } from './layout';
import { cls } from '../shell/cls';
import { ROOM_BACK, ROOM_SIDE, TABLE_GAP } from './layout';

const PENCIL = ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'];
const waitingOf = (s: Session) => s.state === 'waiting_permission' || s.state === 'waiting_input';

/**
 * A project's room (atelier rooms spec §2, variant C): low walls in the project's colour, the plaque on the back wall
 * (swatch, name, « 7 sessions », waiting and working counts, the room's menu), the entrance in the front wall,
 * and its table.
 */
export function ProjectRoom({ project, tables, rig, sessions: rigSessions, width, dispatch, children }: { project: Project; tables: readonly AtelierTable[]; rig?: RigRoomInfo; sessions?: readonly Session[]; width: number; dispatch: (a: NavAction) => void; children: ReactNode }): JSX.Element {
  const { t } = useI18n();
  const [menu, setMenu] = useState(false);
  const sessions = tables.flatMap(x => x.mains);
  const waiting = sessions.filter(waitingOf).length;
  const working = sessions.filter(s => s.state === 'working').length;
  return (
    <section className={cls('project-room atelier-room', rig && `rig-room ${rig.kind}-room`)} data-room={project.id} aria-label={rig ? t.rooms.rigRoom(rig.kind, project.name) : t.rooms.room(project.name)}
      style={{ '--room': `${width}px`, '--project': PROJECT_COLORS[project.color], '--room-side': `${ROOM_SIDE}px`, '--room-back': `${ROOM_BACK}px`, '--table-gap': `${TABLE_GAP}px` } as CSSProperties}>
      <div className="room-walls" aria-hidden="true"><i className="wall-back" /><i className="wall-left" /><i className="wall-right" /><i className="wall-front" /></div>
      {rig ? <RigPlaque rig={rig} sessions={rigSessions ?? sessions} dispatch={dispatch} /> : <div className="room-plaque">
        <ProjectSwatch project={project} />
        <strong className="plaque-name" title={project.name}>{project.name}</strong>
        <span className="plaque-counts">{t.rooms.plaqueCounts(sessions.length)}</span>
        {waiting > 0 && <span className="plaque-waiting"><i className="approval-dot" />{t.rooms.waiting(waiting)}</span>}
        {working > 0 && <span className="plaque-working"><i className="live-dot" />{t.rooms.working(working)}</span>}
        <Menu open={menu} onOpenChange={setMenu} label={t.rooms.roomMenu(project.name)} className="room-menu-wrap" menuClassName="assign-menu room-menu"
          trigger={tr => (
            <button className="icon-action" aria-label={t.rooms.roomMenu(project.name)} title={t.rooms.roomMenuTitle} {...tr}>
              <Icon d={[]} fill={SHELL_ICONS.dots} size={14} />
            </button>
          )}>
          <MenuItem onSelect={() => dispatch({ type: 'modal', modal: { kind: 'launch', project: project.id } })}>
            <span><Icon d={ICONS.plus.d} size={13} />{t.rooms.newSessionHere}</span>
          </MenuItem>
          <MenuItem onSelect={() => dispatch({ type: 'modal', modal: { kind: 'project', edit: project.id } })}>
            <span><Icon d={PENCIL} size={13} />{t.atelier.edit}</span>
          </MenuItem>
          <MenuItem onSelect={() => dispatch({ type: 'modal', modal: { kind: 'broadcast', to: { project: project.id } } })}>
            <span><Icon d={SHELL_ICONS.mail} size={13} />{t.broadcast.project}</span>
          </MenuItem>
        </Menu>
      </div>}
      <div className="room-tables">{children}</div>
      <span className="room-entrance" aria-hidden="true">{t.rooms.entrance}</span>
    </section>
  );
}

/** `/home/me/Workspace/ledge` as `~/Workspace/ledge`. */
const tilde = (p: string): string => p.replace(/^\/home\/[^/]+(?=\/|$)/, '~');

/** A rig's plaque (docs/mockups/ledge-openrig-groups.html, view 1): its name, where it works, its counts, and the way to its
 *  OpenRig page; the kernel's, the way to its operator. */
function RigPlaque({ rig, sessions, dispatch }: { rig: RigRoomInfo; sessions: readonly Session[]; dispatch: (a: NavAction) => void }): JSX.Element {
  const { t } = useI18n();
  const mine = sessions.filter(s => s.rig?.name === rig.name && s.state !== 'exited');
  const waiting = mine.filter(waitingOf).length, working = mine.filter(s => s.state === 'working').length;
  const operator = rig.kind === 'kernel' ? mine.find(s => s.rig?.role === 'operator.agent') : undefined;
  return (
    <div className="room-plaque rig-plaque">
      <span className="rig-hex" aria-hidden="true"><Icon d={SHELL_ICONS.rig} size={13} /></span>
      <strong className="plaque-name" title={rig.name}>{rig.kind === 'kernel' ? t.rooms.kernel : rig.name}</strong>
      <span className="plaque-where" title={rig.folder}>{rig.kind === 'kernel' ? t.rooms.kernelWhere : t.rooms.rigWhere(tilde(rig.folder), rig.project)}</span>
      {waiting > 0 && <span className="plaque-waiting"><i className="approval-dot" />{t.rooms.waiting(waiting)}</span>}
      {working > 0 && <span className="plaque-working"><i className="live-dot" />{t.rooms.working(working)}</span>}
      {operator && <button type="button" className="plaque-btn" onClick={() => dispatch({ type: 'open', id: operator.id })}>{t.openrig.talkToOperator}</button>}
      <button type="button" className="plaque-btn" onClick={() => dispatch({ type: 'openrig', ...(mine[0]?.machineId ? { machine: mine[0].machineId } : {}) })}>{t.rooms.manageRig}</button>
    </div>
  );
}
