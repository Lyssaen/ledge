import { useState, type CSSProperties, type JSX, type ReactNode } from 'react';
import { PROJECT_COLORS, type Project, type Session } from '@ledge/protocol';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import type { NavAction } from '../nav/state';
import { Menu, MenuItem } from '../shell/Menu';
import { SHELL_ICONS } from '../shell/icons';
import { ProjectSwatch } from '../projects/ProjectSwatch';
import { ROOM_BACK, ROOM_SIDE } from './layout';

const PENCIL = ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'];
const waitingOf = (s: Session) => s.state === 'waiting_permission' || s.state === 'waiting_input';

/**
 * A project's room (atelier rooms spec §2, variant C): low walls in the project's colour, the plaque on the back wall
 * (swatch, name, « 7 sessions », waiting and working counts, the room's menu), the entrance in the front wall,
 * and the project's table inside.
 */
export function ProjectRoom({ project, sessions, width, dispatch, children }: { project: Project; sessions: readonly Session[]; width: number; dispatch: (a: NavAction) => void; children: ReactNode }): JSX.Element {
  const { t } = useI18n();
  const [menu, setMenu] = useState(false);
  const waiting = sessions.filter(waitingOf).length;
  const working = sessions.filter(s => s.state === 'working').length;
  return (
    <section className="project-room atelier-room" data-room={project.id} aria-label={t.rooms.room(project.name)}
      style={{ '--room': `${width}px`, '--project': PROJECT_COLORS[project.color], '--room-side': `${ROOM_SIDE}px`, '--room-back': `${ROOM_BACK}px` } as CSSProperties}>
      <div className="room-walls" aria-hidden="true"><i className="wall-back" /><i className="wall-left" /><i className="wall-right" /><i className="wall-front" /></div>
      <div className="room-plaque">
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
        </Menu>
      </div>
      <div className="room-tables">{children}</div>
      <span className="room-entrance" aria-hidden="true">{t.rooms.entrance}</span>
    </section>
  );
}
