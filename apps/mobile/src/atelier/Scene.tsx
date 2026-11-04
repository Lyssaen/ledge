// The Atelier's drawing on iPad (docs/mockups/ledge-ipad-atelier.html): Ledge Desktop's rooms, tables, seats and sub-agents
// (apps/desktop/src/atelier), their DOM and classes, so the shared stylesheet (@ledge/ui/atelier/atelier.css) draws them the
// same. Touch only: one gesture per thing (a tap), no menu, no drag, no keyboard shortcut.
import { Fragment, type CSSProperties, type JSX, type ReactNode } from 'react';
import { PROJECT_COLORS, type Helper, type PhoneProject, type PhoneSession } from '@ledge/protocol';
import { Badge } from '@ledge/ui/ui/Badge';
import { Bot } from '@ledge/ui/bots/Bot';
import { ResidentMascot } from '@ledge/ui/bots/ResidentMascot';
import { poseFor, type BotState } from '@ledge/ui/bots/poseFor';
import { Icon } from '@ledge/ui/ui/icons';
import {
  IPAD_RUG_SIDE, MAX_SEATS, ROOM_BACK, ROOM_SIDE, TABLE_GAP, helperState, layoutTable, noteX, sheetState, tableBranch,
  type AtelierTable, type RigRoomInfo, type Side
} from '@ledge/ui/atelier/layout';
import { plantsFor, type Species, type Spot } from '@ledge/ui/atelier/plantSpots';
import { copy } from '../copy';
import { useTheme } from '../theme';
import { phoneBotState, waitingOf } from './fit';

/** A phone session as the layout reads it: its folder name stands for the seat's folder (a rig's plaque). */
export type AtelierPhone = PhoneSession & { cwd?: string };

const DOTS = ['M5 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z', 'M12 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z', 'M19 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z'];
const RIG = ['M12 2.5 20.5 7.25v9.5L12 21.5l-8.5-4.75v-9.5z', 'M12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7'];
const UNASSIGNED = ['M4 7h16v12H4z', 'M4 7l2-3h4l2 3', 'M9 13h6'];
const taskOf = (s: PhoneSession): string => s.topic ?? s.title;

/** What a tap does: open a session's panel, a room's sheet, Ledge's chat. */
export interface SceneActions { open(id: string): void; room(id: string): void; chat(): void }

/** A session's bot as Desktop draws it: frozen while the state shown is only the last known one. */
export function SessionBot({ session, size, frozen }: { session: PhoneSession; size: number; frozen: boolean }): JSX.Element {
  const theme = useTheme();
  const state = phoneBotState(session);
  return <Bot tool={session.tool} state={state} pose={poseFor(session.id, session.state)} size={size} theme={theme} seed={session.id} frozen={frozen} readOnly={!!session.readOnly} />;
}
function HelperBot({ helper, parent, size, frozen }: { helper: Helper; parent: PhoneSession; size: number; frozen: boolean }): JSX.Element {
  const theme = useTheme();
  const seed = `${parent.id}:${helper.id}`;
  const state = helperState(helper);
  return <Bot tool={parent.tool} state={state} pose={poseFor(seed, state)} size={size} theme={theme} seed={seed} frozen={frozen} readOnly={!!parent.readOnly} />;
}
const StateBadge = ({ state }: { state: BotState }) => <Badge state={state} />;
/** Desktop's swatch element; not drawn on iPad (atelier/ipad.css), as in the validated mockup. */
const Swatch = ({ color }: { color: string | null }) => (color ? <i className="side-swatch" style={{ background: color }} /> : <i className="filter-none" />);

/** The plant drawings of Desktop's decor (apps/desktop/src/atelier/Plants.tsx), unchanged. */
const SPECIES: Record<Species, () => JSX.Element> = {
  monstera: () => <span className="p-monstera"><i /><i /><i /><i /><i /><b /></span>,
  fern: () => <span className="p-fern">{[0, 1, 2, 3, 4, 5, 6].map(k => <i key={k} />)}<b /></span>,
  snake: () => <span className="p-snake"><i /><i /><i /><i /><b /></span>,
  ficus: () => <span className="p-ficus"><i /><i /><i /><i /><em /><b /></span>,
  succulent: () => <span className="p-succulent"><i /><i /><i /><i /><i /><b /></span>
};
function Plants({ seed, left, width, avoid }: { seed: string; left: string; width: number; avoid: readonly Spot[] }): JSX.Element {
  return (
    <div className="plants" aria-hidden="true" style={{ left, width }}>
      {plantsFor(seed, avoid).map(({ spot, species, flip }) => {
        const Kind = SPECIES[species];
        return <span key={spot} className={`plant-spot spot-${spot}${flip ? ' flip' : ''}`}><Kind /></span>;
      })}
    </div>
  );
}

type SheetMark = ReturnType<typeof sheetState>;
interface Sheet { id: string; task: string; state: SheetMark; slot: Side; x: number; note?: { task: string; state: SheetMark; more: number } }
const marks = (state: SheetMark) => <>
  {(state === 'approval' || state === 'question') && <b className="sheet-flag" />}
  {state === 'done' && <i className="sheet-stamp">✓</i>}
</>;
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

/** A room's table: the rug and its label, the plants (none at an end where a sub-agent sits), the chairs, the sheets, the
 *  seats, the sub-agents at the ends. A seat opens its session; a sub-agent its parent's; the label the room's sheet. */
export function Table({ table, project, color, frozen, act }: { table: AtelierTable<AtelierPhone>; project: { id: string; name: string }; color: string; frozen: boolean; act: SceneActions }): JSX.Element {
  const { length, width, seats, ends, notes, extra, extraCount } = layoutTable(table.mains, true, MAX_SEATS, IPAD_RUG_SIDE);
  const at = (dx: number) => `calc(50% - ${length / 2}px + ${dx}px)`;
  const branch = tableBranch(table.mains);
  const sheets: Sheet[] = seats.map(({ session: s, x, side }) => {
    const n = notes.get(s.id);
    return { id: s.id, task: taskOf(s), state: sheetState(phoneBotState(s)), slot: side, x, note: n && { task: n.helper.task, state: sheetState(helperState(n.helper)), more: n.more } };
  });
  const faces = [...extra.mains.map(s => ({ key: s.id, el: <SessionBot session={s} size={18} frozen={frozen} /> })),
    ...extra.helpers.map(({ helper, parent }) => ({ key: `${parent.id}:${helper.id}`, el: <HelperBot helper={helper} parent={parent} size={18} frozen={frozen} /> }))].slice(0, 3);
  const avoid: Spot[] = [...(extraCount > 0 ? ['br' as const] : []), ...(ends.some(e => e.end === 'left') ? ['ml' as const] : []), ...(ends.some(e => e.end === 'right') ? ['mr' as const] : [])];
  return (
    <section className="atelier-table" data-project={project.id} data-table={table.key} aria-label={copy.atelier.table(project.name)}
      style={{ '--room': `${width}px`, '--project': color } as CSSProperties}>
      <div className="table-scene">
        <div className="office-rug" style={{ left: at(-IPAD_RUG_SIDE), right: 'auto', width: length + 2 * IPAD_RUG_SIDE }} />
        <div className="rug-labels" style={{ left: at(-IPAD_RUG_SIDE), width: length + 2 * IPAD_RUG_SIDE }}>
          <div className="room-heading">
            <Swatch color={color} />
            <span className="heading-names">
              <button type="button" className="project-conversations" title={project.name} aria-label={copy.atelier.conversations(project.name)} onClick={() => act.room(project.id)}>{project.name}</button>
              {branch !== null && <span className="heading-branch" title={branch}>⎇ {branch}</span>}
            </span>
            <span className="spacer" />
            <span className="room-menu-wrap">
              <button type="button" className="icon-action" aria-label={copy.atelier.roomMenu(project.name)} onClick={() => act.room(project.id)}><Icon d={[]} fill={DOTS} size={14} /></button>
            </span>
          </div>
          {extraCount > 0 && (
            <button type="button" className="table-more" onClick={() => act.room(project.id)}>
              <span className="more-faces" aria-hidden="true">{faces.map(f => <i key={f.key}>{f.el}</i>)}</span>
              {copy.atelier.more(extraCount)}
            </button>
          )}
        </div>
        <Plants seed={table.key} left={at(-IPAD_RUG_SIDE)} width={length + 2 * IPAD_RUG_SIDE} avoid={avoid} />
        {seats.map(({ session: s, x, side }) => <div key={s.id} className={`office-chair chair-${side}`} aria-hidden="true" style={{ left: at(x - 27) }} />)}
        <div className="worktable" aria-hidden="true" style={{ left: at(0), right: 'auto', width: length }}>
          <TableTop length={length} sheets={sheets} />
        </div>
        {seats.map(({ session: s, x, side }) => {
          const state = phoneBotState(s);
          return (
            <button key={s.id} type="button" style={{ left: at(x - 56) }} data-agent={s.id} aria-label={copy.atelier.seat(s.name, taskOf(s))} onClick={() => act.open(s.id)}
              className={`agent-seat place-${side}${!frozen && state === 'working' ? ' seat-working' : ''}${frozen ? ' seat-offline' : ''}`}>
              <SessionBot session={s} size={64} frozen={frozen} />
              <strong><span className="seat-name" title={s.name}>{s.name}</span></strong>
              <span className="seat-machine">{s.rig?.role ?? 'local'}</span>
              <StateBadge state={state} />
            </button>
          );
        })}
        {ends.map(({ helper: h, parent, end, slot, count }) => (
          <button key={`${parent.id}:${h.id}`} type="button" style={{ left: end === 'left' ? at(-70) : at(length + 8), right: 'auto', top: count > 1 ? (slot ? 232 : 126) : undefined }}
            className={`agent-seat helper-seat end-${end}`} aria-label={copy.atelier.helperSeat(h.kind, parent.name, h.task)} title={h.task} onClick={() => act.open(parent.id)}>
            <HelperBot helper={h} parent={parent} size={36} frozen={frozen} />
            <strong>{h.kind}</strong>
            <span className="seat-meta">↳ {parent.name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** A project's room, or a rig's: its walls in its colour, the plaque on the back wall (its name opens the room's sheet), its table. */
export function Room({ project, tables, rig, width, act, children }: { project: PhoneProject; tables: readonly AtelierTable<AtelierPhone>[]; rig?: RigRoomInfo; width: number; act: SceneActions; children: ReactNode }): JSX.Element {
  const sessions = tables.flatMap(x => x.mains);
  const mine = rig ? sessions.filter(s => s.state !== 'exited') : sessions;
  const waiting = mine.filter(waitingOf).length;
  const working = mine.filter(s => s.state === 'working').length;
  const name = rig?.kind === 'kernel' ? copy.atelier.kernel : project.name;
  const open = () => act.room(project.id);
  return (
    <section className={`project-room atelier-room${rig ? ` rig-room ${rig.kind}-room` : ''}`} data-room={project.id} aria-label={rig ? copy.atelier.rigRoom(rig.kind, project.name) : copy.atelier.room(project.name)}
      style={{ '--room': `${width}px`, '--project': PROJECT_COLORS[project.color], '--room-side': `${ROOM_SIDE}px`, '--room-back': `${ROOM_BACK}px`, '--table-gap': `${TABLE_GAP}px` } as CSSProperties}>
      <div className="room-walls" aria-hidden="true"><i className="wall-back" /><i className="wall-left" /><i className="wall-right" /><i className="wall-front" /></div>
      <div className={`room-plaque${rig ? ' rig-plaque' : ''}`}>
        {rig ? <span className="rig-hex" aria-hidden="true"><Icon d={RIG} size={13} /></span> : <Swatch color={PROJECT_COLORS[project.color]} />}
        <strong className="plaque-name" title={name} role="button" tabIndex={0} aria-label={copy.atelier.roomMenu(name)} onClick={open} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}>{name}</strong>
        {rig
          ? <span className="plaque-where">{rig.kind === 'kernel' ? copy.atelier.kernelWhere : copy.atelier.rigWhere(rig.folder, rig.project)}</span>
          : <span className="plaque-counts">{copy.atelier.plaqueCounts(sessions.length)}</span>}
        {waiting > 0 && <span className="plaque-waiting"><i className="approval-dot" />{copy.atelier.waiting(waiting)}</span>}
        {working > 0 && <span className="plaque-working"><i className="live-dot" />{copy.atelier.working(working)}</span>}
        {!rig && (
          <span className="room-menu-wrap">
            <button type="button" className="icon-action" aria-label={copy.atelier.roomMenu(name)} onClick={open}><Icon d={[]} fill={DOTS} size={14} /></button>
          </span>
        )}
      </div>
      <div className="room-tables">{children}</div>
      <span className="room-entrance" aria-hidden="true">{copy.atelier.entrance}</span>
    </section>
  );
}

/** « Sans projet »: the sessions the PC ties to no project, one card each; a card opens its session (they are put away on the PC). */
export function Unassigned({ sessions, frozen, act }: { sessions: readonly PhoneSession[]; frozen: boolean; act: SceneActions }): JSX.Element | null {
  if (sessions.length === 0) return null;
  return (
    <section className="unassigned-zone atelier" aria-labelledby="unassigned-title">
      <div className="unassigned-heading">
        <Icon d={UNASSIGNED} size={15} />
        <h2 id="unassigned-title">{copy.atelier.unassigned}</h2>
        <span className="muted">{copy.atelier.unassignedHint}</span>
      </div>
      <div className="unassigned-list">
        {sessions.map(s => (
          <div key={s.id} className="unassigned-card">
            <button type="button" className="unassigned-open" data-agent={s.id} aria-label={copy.atelier.seat(s.name, taskOf(s))} onClick={() => act.open(s.id)}>
              <SessionBot session={s} size={56} frozen={frozen} />
              <span className="unassigned-copy">
                <strong>{s.name}</strong>
                <span title={taskOf(s)}>{taskOf(s)}</span>
                <code>{s.project}</code>
              </span>
            </button>
            <div className="unassigned-actions"><StateBadge state={phoneBotState(s)} /></div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Ledge in the Atelier's corner: its bubble counts the agents it watches over; a tap opens the chat (when the PC offers it). */
export function LedgeDesk({ count, frozen, onOpen }: { count: number; frozen: boolean; onOpen?: () => void }): JSX.Element {
  const theme = useTheme();
  return (
    <div className="ledge-corner">
      <button type="button" className="ledge-desk" onClick={onOpen} disabled={!onOpen} aria-label={copy.atelier.desk}>
        <span className="ledge-bubble">{copy.atelier.watching(count)}</span>
        <span className="ledge-seat"><ResidentMascot size={80} theme={theme} frozen={frozen} /></span>
        <strong>Ledge</strong><small>{copy.atelier.assistant}</small>
      </button>
    </div>
  );
}

export function Legend(): JSX.Element {
  const l = copy.atelier.legend;
  return (
    <div className="workspace-legend">
      <span><i className="live-dot" />{l.working}</span>
      <span><i className="approval-dot" />{l.approval}</span>
      <span><i className="question-dot" />{l.question}</span>
      <span><i className="done-dot" />{l.done}</span>
      <span className="spacer" />
      <span>{l.helper}</span>
    </div>
  );
}
