import { Fragment, useState, type CSSProperties, type JSX, type MouseEvent } from 'react';
import { PROJECT_COLORS, type Project, type Session } from '@ledge/protocol';
import { botState } from '@ledge/ui/bots/poseFor';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { machineOf, taskOf } from '../nav/agents';
import type { NavAction } from '../nav/state';
import { cls } from '../shell/cls';
import type { SessionActions } from '../manage/useSessionActions';
import { Menu, MenuItem } from '../shell/Menu';
import { SHELL_ICONS } from '../shell/icons';
import { HelperBot, SessionBot, StateBadge } from '../shell/SessionBot';
import type { Filing } from './filing';
import { Plants } from './Plants';
import { RUG_SIDE, helperState, layoutTable, noteX, sheetState, tableBranch, type Side } from './layout';
import { ProjectSwatch } from '../projects/ProjectSwatch';

export interface ProjectTableProps {
  project: Project;
  /** Its main agents, in mainOrder's order. */
  mains: readonly Session[];
  /** The whole mainOrder: « Alt n » on the first nine. */
  order: readonly Session[];
  helpers: boolean;
  paused: boolean;
  /** The filter is on this project: the menu offers « Voir tous les projets ». */
  isolated: boolean;
  /** keyboard-selected (J / K). */
  focusedId: string | null;
  /** just-seated: the agent that was just put away here. */
  seated: string | null;
  dispatch: (a: NavAction) => void;
  /** The table is a drop target for the agents of « Sans projet ». */
  filing: Filing;
  /** End, archive, resume and delete: « Archiver les terminées » of the table's menu. */
  actions: SessionActions;
  /** The session whose menu is open (its « … » shows as pressed). */
  menuId: string | null;
  /** A right click on a seat, or its « … »: the session menu. */
  onMenu(s: Session, e: MouseEvent<HTMLElement>): void;
}

/** The mockup's « … » glyph (observatory.tsx, room-heading). */
const DOTS = ['M5 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z', 'M12 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z', 'M19 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z'];
const PENCIL = ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'];

type SheetMark = ReturnType<typeof sheetState>;
interface Sheet { id: string; task: string; state: SheetMark; slot: Side; x: number; note?: { task: string; state: SheetMark; more: number } }

/** The bookmark on approval and question, the ✓ stamp on done; an offline sheet carries neither. */
const marks = (state: SheetMark) => <>
  {(state === 'approval' || state === 'question') && <b className="sheet-flag" />}
  {state === 'done' && <i className="sheet-stamp">✓</i>}
</>;

/** What lies on a project table (office.tsx's TableTop): one sheet per seated agent, set in front of its place, and the
 *  first sub-agent's sticky note next to its parent's sheet, in the free gap of the same row. */
function TableTop({ sheets, length }: { sheets: Sheet[]; length: number }): JSX.Element {
  const W = 84;
  return (
    <div className="table-top">
      {sheets.map(s => (
        <Fragment key={s.id}>
          <div style={{ left: s.x - W / 2 }} className={`task-sheet sheet-${s.slot} sheet-${s.state}`}><p>{s.task}</p>{marks(s.state)}</div>
          {s.note && (
            <div style={{ left: noteX(s.x, sheets.filter(o => o.slot === s.slot).map(o => o.x), length) }} className={`sheet-note note-${s.slot} sheet-${s.note.state}`}>
              <p>{s.note.task}</p>{marks(s.note.state)}{s.note.more > 0 && <em className="note-more">+{s.note.more}</em>}
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}

/** One project's table in the atelier (observatory.tsx, `project-room` in atelier mode): the rug with its label and
 *  « +N », the plants, the chairs, the table with its sheets and post-its, the seats and the sub-agents at the ends. */
export function ProjectTable({ project, mains, order, helpers, paused, isolated, focusedId, seated, dispatch, filing, actions, menuId, onMenu }: ProjectTableProps): JSX.Element {
  const { t } = useI18n();
  const { id, name } = project;
  const color = PROJECT_COLORS[project.color];
  const layout = layoutTable(mains, helpers);
  const { length, width, seats, ends, notes, extra, extraCount } = layout;
  const at = (dx: number) => `calc(50% - ${length / 2}px + ${dx}px)`;
  const branch = tableBranch(mains);

  const [menu, setMenu] = useState(false);
  const choose = dispatch;
  // The principal agents whose session is over and whose machine answers: « Archiver les terminées » puts them all away.
  const finished = mains.filter(s => s.state === 'exited' && !s.offline);
  const toList = () => dispatch({ type: 'home', project: id, view: 'list' });

  const bot = (s: Session, size: number) => <SessionBot session={s} size={size} paused={paused} />;
  const helperBot = (h: Session['helpers'][number], parent: Session, size: number) => <HelperBot helper={h} parent={parent} size={size} paused={paused} />;

  const heading = (
    <div className="room-heading">
      <ProjectSwatch project={project} />
      <span className="heading-names">
        <button className="project-conversations" title={name} aria-label={t.atelier.conversations(name)} onClick={toList}>{name}</button>
        {branch !== null && <span className="heading-branch" title={branch}>⎇ {branch}</span>}
      </span>
      {filing.dragging && <span className="drop-hint">{filing.over === id ? t.filing.dropNow(filing.dragging.name) : t.filing.dropHere}</span>}
      <span className="spacer" />
      <Menu open={menu} onOpenChange={setMenu} label={t.atelier.actions(name)} className="room-menu-wrap" menuClassName="assign-menu room-menu"
        trigger={tr => (
          <button className="icon-action" aria-label={t.atelier.actions(name)} title={t.atelier.actionsTitle} {...tr}>
            <Icon d={[]} fill={DOTS} size={14} />
          </button>
        )}>
        <MenuItem onSelect={() => choose({ type: 'modal', modal: { kind: 'project', edit: id } })}>
          <span><Icon d={PENCIL} size={13} />{t.atelier.edit}</span>
        </MenuItem>
        <MenuItem aria-label={t.atelier.newSessionAt(name)} onSelect={() => choose({ type: 'modal', modal: { kind: 'launch', project: id } })}>
          <span><Icon d={ICONS.plus.d} size={13} />{t.atelier.newSession}</span>
        </MenuItem>
        <MenuItem aria-label={isolated ? t.atelier.showAll : t.atelier.isolate(name)} onSelect={() => choose(isolated ? { type: 'home' } : { type: 'home', project: id })}>
          <span><Icon d={ICONS.expand.d} size={13} />{isolated ? t.atelier.showAll : t.atelier.isolateLabel}</span>
        </MenuItem>
        <MenuItem disabled={!finished.some(s => actions.allowed(s.id))} onSelect={() => actions.request('archive', finished.map(s => s.id))}>
          <span><Icon d={SHELL_ICONS.archive} size={13} />{t.manage.menu.archiveFinished}</span>
        </MenuItem>
      </Menu>
    </div>
  );

  const faces = [...extra.mains.map(s => ({ key: s.id, el: bot(s, 18) })), ...extra.helpers.map(({ helper, parent }) => ({ key: `${parent.id}:${helper.id}`, el: helperBot(helper, parent, 18) }))].slice(0, 3);
  const sheets: Sheet[] = seats.map(({ session: s, x, side }) => {
    const n = notes.get(s.id);
    return {
      id: s.id, task: taskOf(s), state: sheetState(botState(s), s.offline), slot: side, x,
      note: n && { task: n.helper.task, state: sheetState(helperState(n.helper), s.offline), more: n.more }
    };
  });

  return (
    <section className={cls('project-room', filing.over === id && 'drop-over')} data-project={id} aria-label={t.atelier.table(name)} {...filing.dropProps(id)} style={{ '--room': `${width}px`, '--project': color } as CSSProperties}>
      <div className="table-scene">
        <div className="office-rug" style={{ left: at(-RUG_SIDE), right: 'auto', width: length + 2 * RUG_SIDE }}>
          {heading}
          {extraCount > 0 && (
            <button className="table-more" title={t.atelier.moreTitle} onClick={toList}>
              <span className="more-faces" aria-hidden="true">{faces.map(f => <i key={f.key}>{f.el}</i>)}</span>
              {t.atelier.more(extraCount)}
            </button>
          )}
        </div>
        <Plants projectId={id} left={at(-RUG_SIDE)} width={length + 2 * RUG_SIDE} avoid={extraCount > 0 ? ['br'] : []} />
        {seats.map(({ session: s, x, side }) => <div key={s.id} className={`office-chair chair-${side}`} aria-hidden="true" style={{ left: at(x - 27) }} />)}
        <div className="worktable" aria-hidden="true" style={{ left: at(0), right: 'auto', width: length }}>
          <TableTop length={length} sheets={sheets} />
        </div>
        {seats.map(({ session: s, x, side }) => {
          const n = order.findIndex(o => o.id === s.id) + 1;
          const state = botState(s);
          return (
            <Fragment key={s.id}>
            <button style={{ left: at(x - 56) }} data-agent={s.id} aria-label={t.atelier.seat(s.name, taskOf(s), machineOf(s))} onClick={() => dispatch({ type: 'open', id: s.id })} onContextMenu={e => onMenu(s, e)}
              className={cls('agent-seat', `place-${side}`, seated === s.id && 'just-seated', focusedId === s.id && 'keyboard-selected', s.offline ? 'seat-offline' : state === 'working' && 'seat-working')}>
              {bot(s, 64)}
              <strong><span className="seat-name" title={s.name}>{s.name}</span>{n >= 1 && n <= 9 && <span className="seat-shortcut">Alt {n}</span>}</strong>
              <span className="seat-machine" title={machineOf(s)}>{machineOf(s)}</span>
              <StateBadge state={state} offline={!!s.offline} />
            </button>
            <button type="button" className={cls('seat-more', `place-${side}`)} style={{ left: at(x + 56 - 30) }} aria-label={t.manage.menu.label(s.name)} title={t.manage.menu.more}
              aria-haspopup="menu" aria-expanded={menuId === s.id} onClick={e => onMenu(s, e)}>
              <Icon d={[]} fill={DOTS} size={13} />
            </button>
            </Fragment>
          );
        })}
        {ends.map(({ helper: h, parent, end, slot, count }) => (
          <button key={`${parent.id}:${h.id}`} style={{ left: end === 'left' ? at(-70) : at(length + 8), right: 'auto', top: count > 1 ? (slot ? 232 : 126) : undefined }}
            className={`agent-seat helper-seat end-${end}`} aria-label={t.atelier.helperSeat(h.kind, parent.name, h.task)} title={h.task} onClick={() => dispatch({ type: 'open', id: parent.id, helper: h.id })}>
            {helperBot(h, parent, 36)}
            <strong>{h.kind}</strong>
            <span className="seat-meta">↳ {parent.name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
