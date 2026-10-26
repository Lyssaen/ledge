import { useState, type CSSProperties, type JSX, type ReactNode } from 'react';
import { PROJECT_COLORS, type Project, type Session } from '@ledge/protocol';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import type { NavAction } from '../nav/state';
import { Menu, MenuItem } from '../shell/Menu';
import { SHELL_ICONS } from '../shell/icons';
import { ProjectSwatch } from '../projects/ProjectSwatch';
import type { AtelierTable } from './layout';
import { ROOM_BACK, ROOM_SIDE, TABLE_GAP } from './layout';

const PENCIL = ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'];
const waitingOf = (s: Session) => s.state === 'waiting_permission' || s.state === 'waiting_input';

/**
 * A project's room (atelier rooms spec §2, variant C): low walls in the project's colour, the plaque on the back wall
 * (swatch, name, « 3 tables · 7 sessions », waiting and working counts, the room's menu), the entrance in the front wall,
 * and its tables side by side, wrapping. A room with one table looks like the project table it was, inside its walls.
 */
export function ProjectRoom({ project, tables, width, dispatch, children }: { project: Project; tables: readonly AtelierTable[]; width: number; dispatch: (a: NavAction) => void; children: ReactNode }): JSX.Element {
  const { t } = useI18n();
  const [menu, setMenu] = useState(false);
  const sessions = tables.filter(x => x.team?.state !== 'resting').flatMap(x => x.mains);
  const waiting = sessions.filter(waitingOf).length;
  const working = sessions.filter(s => s.state === 'working').length;
  return (
    <section className="project-room atelier-room" data-room={project.id} aria-label={t.teams.room(project.name)}
      style={{ '--room': `${width}px`, '--project': PROJECT_COLORS[project.color], '--room-side': `${ROOM_SIDE}px`, '--room-back': `${ROOM_BACK}px`, '--table-gap': `${TABLE_GAP}px` } as CSSProperties}>
      <div className="room-walls" aria-hidden="true"><i className="wall-back" /><i className="wall-left" /><i className="wall-right" /><i className="wall-front" /></div>
      <div className="room-plaque">
        <ProjectSwatch project={project} />
        <strong className="plaque-name" title={project.name}>{project.name}</strong>
        <span className="plaque-counts">{t.teams.plaqueCounts(tables.length, sessions.length)}</span>
        {waiting > 0 && <span className="plaque-waiting"><i className="approval-dot" />{t.teams.waiting(waiting)}</span>}
        {working > 0 && <span className="plaque-working"><i className="live-dot" />{t.teams.working(working)}</span>}
        <Menu open={menu} onOpenChange={setMenu} label={t.teams.roomMenu(project.name)} className="room-menu-wrap" menuClassName="assign-menu room-menu"
          trigger={tr => (
            <button className="icon-action" aria-label={t.teams.roomMenu(project.name)} title={t.teams.roomMenuTitle} {...tr}>
              <Icon d={[]} fill={SHELL_ICONS.dots} size={14} />
            </button>
          )}>
          <MenuItem onSelect={() => dispatch({ type: 'modal', modal: { kind: 'launch', project: project.id } })}>
            <span><Icon d={ICONS.plus.d} size={13} />{t.teams.newSessionHere}</span>
          </MenuItem>
          <MenuItem onSelect={() => dispatch({ type: 'modal', modal: { kind: 'launch', project: project.id, team: true } })}>
            <span><Icon d={ICONS.plus.d} size={13} />{t.teams.newTeamHere}</span>
          </MenuItem>
          <MenuItem onSelect={() => dispatch({ type: 'modal', modal: { kind: 'project', edit: project.id } })}>
            <span><Icon d={PENCIL} size={13} />{t.atelier.edit}</span>
          </MenuItem>
        </Menu>
      </div>
      <div className="room-tables">{children}</div>
      <span className="room-entrance" aria-hidden="true">{t.teams.entrance}</span>
    </section>
  );
}
