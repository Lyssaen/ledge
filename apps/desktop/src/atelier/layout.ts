import type { Helper, Project, Projects, Session } from '@ledge/protocol';
import type { BotState } from '@ledge/ui/bots/poseFor';
import type { ProjectFilter } from '../nav/state';

/** The mockup's constants (observatory.tsx). MAX_SEATS is the default seat count; Settings › Appearance chooses another (seats.ts). */
export const STEP = 70, MAX_SEATS = 6, END_SEATS = 2, RUG_SIDE = 130;
export type Side = 't' | 'b';
export type End = 'left' | 'right';
export interface Seat { session: Session; x: number; side: Side }
export interface EndSeat { helper: Helper; parent: Session; end: End; slot: number; count: number }
export interface Note { helper: Helper; more: number }
export interface TableLayout {
  length: number;
  width: number;
  seats: Seat[];
  ends: EndSeat[];
  notes: Map<string, Note>;
  extra: { mains: Session[]; helpers: { helper: Helper; parent: Session }[] };
  extraCount: number;
}

export const tableLength = (n: number): number => (Math.max(n, 2) + 1) * STEP;
export const roomWidth = (mains: number, maxSeats = MAX_SEATS): number => tableLength(Math.min(mains, maxSeats)) + 2 * RUG_SIDE;

export function layoutTable(mains: readonly Session[], showHelpers: boolean, maxSeats = MAX_SEATS): TableLayout {
  const seated = mains.slice(0, maxSeats);
  const length = tableLength(seated.length);
  const xOf = (i: number) => (seated.length === 1 ? length / 2 : STEP * (i + 1));
  const seats: Seat[] = seated.map((session, i) => ({ session, x: xOf(i), side: seated.length === 1 || i % 2 === 0 ? 't' : 'b' }));
  const bins: Record<End, { helper: Helper; parent: Session }[]> = { left: [], right: [] };
  const notes = new Map<string, Note>();
  const extraHelpers: { helper: Helper; parent: Session }[] = [];
  if (showHelpers) {
    for (const [i, parent] of seated.entries()) {
      const helpers = parent.helpers ?? [];
      const first = helpers[0];
      if (first) notes.set(parent.id, { helper: first, more: helpers.length - 1 });
      const pref: End = xOf(i) > length / 2 ? 'right' : 'left';
      const other: End = pref === 'left' ? 'right' : 'left';
      for (const helper of helpers) {
        const k = bins[pref].length < END_SEATS ? pref : bins[other].length < END_SEATS ? other : null;
        if (k) bins[k].push({ helper, parent });
        else extraHelpers.push({ helper, parent });
      }
    }
    for (const parent of mains.slice(maxSeats)) for (const helper of parent.helpers ?? []) extraHelpers.push({ helper, parent });
  }
  const ends: EndSeat[] = (['left', 'right'] as const).flatMap(end => bins[end].map((b, slot) => ({ ...b, end, slot, count: bins[end].length })));
  const extraMains = mains.slice(maxSeats);
  return { length, width: roomWidth(mains.length, maxSeats), seats, ends, notes, extra: { mains: extraMains, helpers: extraHelpers }, extraCount: extraMains.length + extraHelpers.length };
}

const SHEET_W = 84, NOTE_W = 52;
export function noteX(x: number, row: readonly number[], length: number): number {
  const sorted = [...row].sort((a, b) => a - b);
  const i = sorted.indexOf(x);
  const right = (i < sorted.length - 1 ? sorted[i + 1]! - SHEET_W / 2 : length - 6) - (x + SHEET_W / 2);
  const left = (x - SHEET_W / 2) - (i > 0 ? sorted[i - 1]! + SHEET_W / 2 : 6);
  return right >= NOTE_W + 4 ? x + SHEET_W / 2 + 2 : left >= NOTE_W + 4 ? x - SHEET_W / 2 - NOTE_W - 2 : x + SHEET_W / 2 - NOTE_W + 8;
}

export function tableBranch(mains: readonly Session[]): string | null {
  const count = new Map<string, number>();
  for (const s of mains) if (s.branch) count.set(s.branch, (count.get(s.branch) ?? 0) + 1);
  let best: string | null = null;
  for (const [b, n] of count) if (best === null || n > count.get(best)!) best = b;
  return best;
}

export function sheetState(state: BotState, offline?: boolean): 'approval' | 'question' | 'done' | 'offline' | 'working' | 'starting' | 'error' {
  if (offline) return 'offline';
  if (state === 'idle') return 'done';
  if (state === 'readonly') return 'working';
  return state;
}

const HELPER_STATE: Record<Helper['state'], BotState> = { starting: 'starting', working: 'working', waiting_input: 'question', waiting_permission: 'approval', idle: 'idle', exited: 'done', error: 'error' };
export const helperState = (h: Helper): BotState => HELPER_STATE[h.state];

/** A room's table (atelier rooms spec §3.1): the project's common table, where all its sessions sit. */
export interface AtelierTable { key: string; mains: Session[] }
/** An OpenRig rig's room, or the kernel's (docs/mockups/ledge-openrig-groups.html, view 1): its seats around its own table, away
 *  from the projects'; `folder` and `project`: where the rig works. */
export interface RigRoomInfo { kind: 'rig' | 'kernel'; name: string; folder: string; project: string | null }
/** A project's room, or a rig's (`rig`): its walls hold its table. */
export interface AtelierRoom { project: Project; tables: AtelierTable[]; rig?: RigRoomInfo }
export interface AtelierScene { rooms: AtelierRoom[]; unassigned: Session[]; empty: Project | null }

/** The rooms of the atelier (atelier rooms spec §3.1): a project with sessions has a room, its sessions at its common table. */
export function sceneOf(order: readonly Session[], projects: Projects | null, projectIdOf: (s: Session) => string | null, filter: ProjectFilter): AtelierScene {
  const list = projects?.projects ?? [];
  const known = new Set(list.map(p => p.id));
  const idOf = (s: Session) => { const id = projectIdOf(s); return id !== null && known.has(id) ? id : null; };
  // An OpenRig seat sits in its rig's room (the kernel's its own), never at a project's table.
  const own = order.filter(s => !s.rig);
  const showTables = filter === 'all' || filter !== 'none';
  const projectRooms = showTables
    ? list.filter(p => filter === 'all' || p.id === filter)
      .map(project => ({ project, tables: [{ key: `common:${project.id}`, mains: own.filter(s => idOf(s) === project.id) }] }))
      .filter(r => r.tables[0]!.mains.length > 0)
    : [];
  const rigs = filter === 'all' ? rigRooms(order.filter(s => s.rig), id => list.find(p => p.id === id)?.name ?? null, projectIdOf) : [];
  const rooms = [...rigs.filter(r => r.rig!.kind === 'kernel'), ...projectRooms, ...rigs.filter(r => r.rig!.kind === 'rig')];
  const unassigned = filter === 'all' || filter === 'none' ? own.filter(s => idOf(s) === null) : [];
  const target = filter === 'all' || filter === 'none' ? undefined : list.find(p => p.id === filter);
  const empty = target && rooms.length === 0 ? target : null;
  return { rooms, unassigned, empty };
}

export const KERNEL_ROOM = 'kernel';
/** One room per rig whose seats Ledge follows, the kernel's first; a rig's folder is its first seat's. */
export function rigRooms(seats: readonly Session[], projectName: (id: string) => string | null, projectIdOf: (s: Session) => string | null): AtelierRoom[] {
  const by = new Map<string, Session[]>();
  for (const s of seats) by.set(s.rig!.name, [...(by.get(s.rig!.name) ?? []), s]);
  return [...by].sort(([a], [b]) => (a === KERNEL_ROOM ? -1 : b === KERNEL_ROOM ? 1 : a.localeCompare(b))).map(([name, mains]) => {
    const kind = name === KERNEL_ROOM ? 'kernel' as const : 'rig' as const;
    const pid = projectIdOf(mains[0]!);
    return {
      project: { id: `rig:${name}`, name, color: kind === 'kernel' ? 'violet' : 'slate', description: '', repos: [] },
      tables: [{ key: `rig:${name}`, mains }],
      rig: { kind, name, folder: mains[0]!.cwd, project: pid ? projectName(pid) : null }
    };
  });
}

/** Room, then seat (Alt ←/→, Alt 1…9, J / K); `MAX_SEATS` applies per table. */
export function walkOrder(scene: AtelierScene, maxSeats = MAX_SEATS): Session[] {
  return [...scene.rooms.flatMap(r => r.tables.flatMap(t => t.mains.slice(0, maxSeats))), ...scene.unassigned];
}

/** Room margins (atelier units, before zoom): 110 px at the sides and front, 150 px at the back; 70 px between tables. */
export const ROOM_SIDE = 110, ROOM_BACK = 150, TABLE_GAP = 70;
/** A room's width: its tables side by side, the gaps between them and its two side margins. */
export const roomTileWidth = (tables: readonly { mains: readonly unknown[] }[], maxSeats = MAX_SEATS): number =>
  tables.reduce((w, t, i) => w + roomWidth(t.mains.length, maxSeats) + (i > 0 ? TABLE_GAP : 0), 0) + 2 * ROOM_SIDE;
