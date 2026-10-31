import { Fragment, useState, type CSSProperties, type JSX, type MouseEvent, type ReactNode } from 'react';
import { PROJECT_COLORS, type RigSeat, type Session } from '@ledge/protocol';
import { botState } from '@ledge/ui/bots/poseFor';
import { isSeatPlaceholder, rigColor, shortCwd, workingCount } from '@ledge/ui/rigs/model';
import { tableSeats } from '@ledge/ui/rigs/scene';
import { Icon } from '@ledge/ui/ui/icons';
import { useI18n } from '../i18n/lang';
import { machineOf, taskOf } from '../nav/agents';
import type { NavAction } from '../nav/state';
import { cls } from '../shell/cls';
import { Menu, MenuItem } from '../shell/Menu';
import { SHELL_ICONS } from '../shell/icons';
import { SessionBot, StateBadge } from '../shell/SessionBot';
import { ROOM_BACK, ROOM_SIDE, RUG_SIDE, layoutTable, type AtelierRoom } from './layout';

export type RigAtelierRoom = Extract<AtelierRoom, { kind: 'rig' | 'kernel' }>;

const colorOf = (room: RigAtelierRoom) => (room.kind === 'kernel' ? 'var(--muted-foreground)' : PROJECT_COLORS[rigColor(room.rig)]);

/**
 * A rig's or the kernel's room (lot 3, maquettes new-atelier-factory / w-3-piece): walls in the rig's colour, the plaque on the back wall
 * (swatch, name, « rig · n sièges », where it works, « sur {machine} » when remote, « injoignable », « n au travail », « … »), the table
 * inside (`children`). The « … » offers « Terminaux » (one item per running seat) and « Fil du rig », then `extraActions` (lot 5).
 */
export function RigRoom({ room, width, dispatch, onTerminal, children, extraActions }: {
  room: RigAtelierRoom; width: number; dispatch: (a: NavAction) => void; onTerminal(seat: RigSeat): void; children: ReactNode; extraActions?: ReactNode;
}): JSX.Element {
  const { t } = useI18n();
  const [menu, setMenu] = useState(false);
  const [terminals, setTerminals] = useState(false);
  const { rig } = room;
  const kernel = room.kind === 'kernel';
  const name = kernel ? t.side.rigs.kernel : rig.name;
  const color = colorOf(room);
  const working = workingCount(rig);
  const seats = rig.seats.filter(s => s.state !== 'stopped');
  const label = t.rooms.rigMenu(name);
  return (
    <section className={cls('project-room atelier-room rig-room', rig.lifecycle === 'unreachable' && 'rig-unreachable')} data-room={room.key} data-kind={room.kind} aria-label={t.rooms.room(name)}
      style={{ '--room': `${width}px`, '--project': color, '--room-side': `${ROOM_SIDE}px`, '--room-back': `${ROOM_BACK}px` } as CSSProperties}>
      <div className="room-walls" aria-hidden="true"><i className="wall-back" /><i className="wall-left" /><i className="wall-right" /><i className="wall-front" /></div>
      <div className="room-plaque">
        <i className="side-swatch" style={{ background: color }} />
        <strong className="plaque-name" title={name}>{name}</strong>
        {kernel
          ? <span className="plaque-counts">{t.rooms.kernelWhat}</span>
          : <span className="plaque-counts">{t.rooms.rigSeats(room.tables[0].mains.length)}</span>}
        {room.kind === 'rig' && room.place.kind === 'project' && <span className="plaque-counts">{t.rooms.inProject(room.place.name)}</span>}
        {room.kind === 'rig' && room.place.kind === 'off' && <span className="plaque-counts" title={room.place.cwd}>{t.rooms.offProject(shortCwd(room.place.cwd))}</span>}
        {rig.machine !== 'local' && <span className="plaque-counts">{t.rooms.onMachine(rig.machine)}</span>}
        {rig.lifecycle === 'unreachable' && <span className="plaque-counts plaque-off">{t.side.rigs.unreachable}</span>}
        {working > 0 && <span className="plaque-working"><i className="live-dot" />{t.rooms.working(working)}</span>}
        <Menu open={menu} onOpenChange={o => { setMenu(o); if (!o) setTerminals(false); }} label={label} className="room-menu-wrap" menuClassName="assign-menu room-menu"
          trigger={tr => (
            <button className="icon-action" aria-label={label} title={t.rooms.rigMenuTitle} {...tr}>
              <Icon d={[]} fill={SHELL_ICONS.dots} size={14} />
            </button>
          )}>
          {/* « Terminaux » unfolds its seats in place (the menu stays open). */}
          <button type="button" role="menuitem" aria-expanded={terminals} disabled={seats.length === 0} onClick={() => setTerminals(o => !o)}>
            <span>{t.rooms.terminals}</span>
          </button>
          {terminals && seats.map(s => (
            <MenuItem key={s.ref} className="menu-sub" onSelect={() => onTerminal(s)}><span>{s.name}</span></MenuItem>
          ))}
          <MenuItem onSelect={() => dispatch({ type: 'ledge', tab: 'conversation' })}><span>{t.rooms.rigThread}</span></MenuItem>
          {extraActions}
        </Menu>
      </div>
      <div className="room-tables">{children}</div>
      <span className="room-entrance" aria-hidden="true">{t.rooms.entrance}</span>
    </section>
  );
}

/**
 * A rig's or the kernel's table: up to `maxSeats` seats (`tableSeats`: the seats with a session first, then placeholders), the rest
 * counted in « +N »; the kernel's tucked-away seats (advisor, terminal) in « +{hidden} » beside it. A seat with a session is a seat as at
 * a project's table (opens its page, its menu on right click and « … »); a placeholder is only drawn: no `data-agent`, no click, no menu,
 * no drag (it carries `data-seat` so the exchanges can still start or end on it).
 */
export function RigTable({ room, maxSeats, paused, focusedId, order, dispatch, menuId, onMenu }: {
  room: RigAtelierRoom; maxSeats: number; paused: boolean; focusedId: string | null; order: readonly Session[];
  dispatch: (a: NavAction) => void; menuId: string | null; onMenu(s: Session, e: MouseEvent<HTMLElement>): void;
}): JSX.Element {
  const { t } = useI18n();
  const table = room.tables[0];
  const { seated, extra } = tableSeats(table.mains, maxSeats);
  const { length, width, seats } = layoutTable(seated, false, maxSeats);
  const at = (dx: number) => `calc(50% - ${length / 2}px + ${dx}px)`;
  const hidden = table.hidden ?? 0;
  return (
    <section className="atelier-table rig-table" data-table={table.key} aria-label={t.atelier.table(room.kind === 'kernel' ? t.side.rigs.kernel : room.rig.name)}
      style={{ '--room': `${width}px`, '--project': colorOf(room) } as CSSProperties}>
      <div className="table-scene">
        <div className="office-rug" style={{ left: at(-RUG_SIDE), right: 'auto', width: length + 2 * RUG_SIDE }} />
        {(extra.length > 0 || hidden > 0) && (
          <div className="rug-labels" style={{ left: at(-RUG_SIDE), width: length + 2 * RUG_SIDE }}>
            {extra.length > 0 && <span className="table-more" title={extra.map(s => s.name).join(', ')}>{t.side.rigs.more(extra.length)}</span>}
            {hidden > 0 && <span className="table-more kernel-hidden" title={t.rooms.hidden(hidden)}>{t.side.rigs.more(hidden)}</span>}
          </div>
        )}
        {seats.map(({ session: s, x, side }) => <div key={s.id} className={`office-chair chair-${side}`} aria-hidden="true" style={{ left: at(x - 27) }} />)}
        <div className="worktable" aria-hidden="true" style={{ left: at(0), right: 'auto', width: length }}>
          <div className="table-top">
            {seats.filter(({ session: s }) => !isSeatPlaceholder(s.id)).map(({ session: s, x, side }) => (
              <div key={s.id} style={{ left: x - 42 }} className={`task-sheet sheet-${side}`}><p>{taskOf(s)}</p></div>
            ))}
          </div>
        </div>
        {seats.map(({ session: s, x, side }) => {
          const state = botState(s);
          if (isSeatPlaceholder(s.id)) {
            return (
              <div key={s.id} style={{ left: at(x - 56) }} data-seat={s.id} title={t.side.rigs.ghost}
                className={cls('agent-seat seat-ghost', `place-${side}`, s.offline && 'seat-offline')}>
                <SessionBot session={s} size={64} paused={paused} />
                <strong><span className="seat-name" title={s.name}>{s.name}</span></strong>
                <span className="seat-machine">{machineOf(s)}</span>
                <StateBadge state={state} offline={!!s.offline} />
              </div>
            );
          }
          const n = order.findIndex(o => o.id === s.id) + 1;
          return (
            <Fragment key={s.id}>
              <button style={{ left: at(x - 56) }} data-agent={s.id} aria-label={t.atelier.seat(s.name, taskOf(s), machineOf(s))}
                onClick={() => dispatch({ type: 'open', id: s.id })} onContextMenu={e => onMenu(s, e)}
                className={cls('agent-seat', `place-${side}`, focusedId === s.id && 'keyboard-selected', s.offline ? 'seat-offline' : state === 'working' && 'seat-working')}>
                <SessionBot session={s} size={64} paused={paused} />
                <strong><span className="seat-name" title={s.name}>{s.name}</span>{n >= 1 && n <= 9 && <span className="seat-shortcut">Alt {n}</span>}</strong>
                <span className="seat-machine" title={machineOf(s)}>{machineOf(s)}</span>
                <StateBadge state={state} offline={!!s.offline} />
              </button>
              <button type="button" className={cls('seat-more', `place-${side}`)} style={{ left: at(x + 56 - 30) }} aria-label={t.manage.menu.label(s.name)} title={t.manage.menu.more}
                aria-haspopup="menu" aria-expanded={menuId === s.id} onClick={e => onMenu(s, e)}>
                <Icon d={[]} fill={SHELL_ICONS.dots} size={13} />
              </button>
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}
