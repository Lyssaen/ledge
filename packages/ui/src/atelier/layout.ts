import type { Helper, ProjectColor } from '@ledge/protocol';
import type { BotState } from '../bots/poseFor';

/**
 * Where the Atelier puts things (apps/desktop's atelier, and the mobile app's on iPad, docs/mockups/ledge-ipad-atelier.html):
 * pure, generic over the fields it reads, so Desktop's sessions and projects and the phone's both go through it.
 */

/** What the layout reads of a session: Desktop's Session, the phone's PhoneSession. */
export interface AtelierSession {
  id: string;
  helpers?: readonly Helper[];
  branch?: string;
  /** The OpenRig seat it is: it sits in its rig's room. */
  rig?: { name: string; role?: string };
  /** Its folder (Desktop): a rig's room is said to work where its first seat does. */
  cwd?: string;
}
/** What the layout reads of a project: its id, name and colour (the phone knows no more). */
export interface AtelierProject { id: string; name: string; color: ProjectColor }

/** The mockup's constants (observatory.tsx). MAX_SEATS is the default seat count; Settings › Appearance chooses another (seats.ts).
 *  RUG_SIDE is the rug on each side of a table: Desktop's; the iPad's is IPAD_RUG_SIDE. */
export const STEP = 70, MAX_SEATS = 6, END_SEATS = 2, RUG_SIDE = 130;
/** The iPad's narrower rug (docs/mockups/ledge-ipad-atelier.html, view 4): a room of four agents fits the portrait width at 0.92. */
export const IPAD_RUG_SIDE = 90;
export type Side = 't' | 'b';
export type End = 'left' | 'right';
export interface Seat<S extends AtelierSession = AtelierSession> { session: S; x: number; side: Side }
export interface EndSeat<S extends AtelierSession = AtelierSession> { helper: Helper; parent: S; end: End; slot: number; count: number }
export interface Note { helper: Helper; more: number }
export interface TableLayout<S extends AtelierSession = AtelierSession> {
  length: number;
  width: number;
  seats: Seat<S>[];
  ends: EndSeat<S>[];
  notes: Map<string, Note>;
  extra: { mains: S[]; helpers: { helper: Helper; parent: S }[] };
  extraCount: number;
}

export const tableLength = (n: number): number => (Math.max(n, 2) + 1) * STEP;
export const roomWidth = (mains: number, maxSeats = MAX_SEATS, rugSide = RUG_SIDE): number => tableLength(Math.min(mains, maxSeats)) + 2 * rugSide;

export function layoutTable<S extends AtelierSession>(mains: readonly S[], showHelpers: boolean, maxSeats = MAX_SEATS, rugSide = RUG_SIDE): TableLayout<S> {
  const seated = mains.slice(0, maxSeats);
  const length = tableLength(seated.length);
  const xOf = (i: number) => (seated.length === 1 ? length / 2 : STEP * (i + 1));
  const seats: Seat<S>[] = seated.map((session, i) => ({ session, x: xOf(i), side: seated.length === 1 || i % 2 === 0 ? 't' : 'b' }));
  const bins: Record<End, { helper: Helper; parent: S }[]> = { left: [], right: [] };
  const notes = new Map<string, Note>();
  const extraHelpers: { helper: Helper; parent: S }[] = [];
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
  const ends: EndSeat<S>[] = (['left', 'right'] as const).flatMap(end => bins[end].map((b, slot) => ({ ...b, end, slot, count: bins[end].length })));
  const extraMains = mains.slice(maxSeats);
  return { length, width: roomWidth(mains.length, maxSeats, rugSide), seats, ends, notes, extra: { mains: extraMains, helpers: extraHelpers }, extraCount: extraMains.length + extraHelpers.length };
}

const SHEET_W = 84, NOTE_W = 52;
export function noteX(x: number, row: readonly number[], length: number): number {
  const sorted = [...row].sort((a, b) => a - b);
  const i = sorted.indexOf(x);
  const right = (i < sorted.length - 1 ? sorted[i + 1]! - SHEET_W / 2 : length - 6) - (x + SHEET_W / 2);
  const left = (x - SHEET_W / 2) - (i > 0 ? sorted[i - 1]! + SHEET_W / 2 : 6);
  return right >= NOTE_W + 4 ? x + SHEET_W / 2 + 2 : left >= NOTE_W + 4 ? x - SHEET_W / 2 - NOTE_W - 2 : x + SHEET_W / 2 - NOTE_W + 8;
}

export function tableBranch(mains: readonly AtelierSession[]): string | null {
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
export interface AtelierTable<S extends AtelierSession = AtelierSession> { key: string; mains: S[] }
/** An OpenRig rig's room, or the kernel's (docs/mockups/ledge-openrig-groups.html, view 1): its seats around its own table, away
 *  from the projects'; `folder` and `project`: where the rig works. */
export interface RigRoomInfo { kind: 'rig' | 'kernel'; name: string; folder: string; project: string | null }
/** A project's room, or a rig's (`rig`): its walls hold its table. */
export interface AtelierRoom<S extends AtelierSession = AtelierSession, P extends AtelierProject = AtelierProject> { project: P; tables: AtelierTable<S>[]; rig?: RigRoomInfo }
export interface AtelierScene<S extends AtelierSession = AtelierSession, P extends AtelierProject = AtelierProject> { rooms: AtelierRoom<S, P>[]; unassigned: S[]; empty: P | null }
/** The project a rig's room shows as (its plaque's colour): Desktop's full Project, the phone's three fields. */
export type RigProject<P extends AtelierProject> = (room: { id: string; name: string; kind: RigRoomInfo['kind'] }) => P;

/** The rooms of the atelier (atelier rooms spec §3.1): a project with sessions has a room, its sessions at its common table.
 *  `filter`: 'all', 'none' (« Sans projet » only) or a project's id. */
export function sceneOf<S extends AtelierSession, P extends AtelierProject>(order: readonly S[], projects: readonly P[] | null, projectIdOf: (s: S) => string | null, filter: string, byRig: boolean, rigProject: RigProject<P>): AtelierScene<S, P> {
  const list = projects ?? [];
  const known = new Set(list.map(p => p.id));
  const idOf = (s: S) => { const id = projectIdOf(s); return id !== null && known.has(id) ? id : null; };
  // An OpenRig seat sits in its rig's room (the kernel's its own), never at a project's table; « Projets » shows no seat.
  const own = order.filter(s => !s.rig);
  const showTables = filter === 'all' || filter !== 'none';
  const projectRooms = showTables
    ? list.filter(p => filter === 'all' || p.id === filter)
      .map(project => ({ project, tables: [{ key: `common:${project.id}`, mains: own.filter(s => idOf(s) === project.id) }] }))
      .filter(r => r.tables[0]!.mains.length > 0)
    : [];
  const rigs = byRig && filter === 'all' ? rigRooms(order.filter(s => s.rig), id => list.find(p => p.id === id)?.name ?? null, projectIdOf, rigProject) : [];
  const rooms = [...rigs.filter(r => r.rig!.kind === 'kernel'), ...projectRooms, ...rigs.filter(r => r.rig!.kind === 'rig')];
  const unassigned = filter === 'all' || filter === 'none' ? own.filter(s => idOf(s) === null) : [];
  const target = filter === 'all' || filter === 'none' ? undefined : list.find(p => p.id === filter);
  const empty = target && rooms.length === 0 ? target : null;
  return { rooms, unassigned, empty };
}

export const KERNEL_ROOM = 'kernel';
/** One room per rig whose seats Ledge follows, the kernel's first; a rig's folder is its first seat's. */
export function rigRooms<S extends AtelierSession, P extends AtelierProject>(seats: readonly S[], projectName: (id: string) => string | null, projectIdOf: (s: S) => string | null, rigProject: RigProject<P>): AtelierRoom<S, P>[] {
  const by = new Map<string, S[]>();
  for (const s of seats) by.set(s.rig!.name, [...(by.get(s.rig!.name) ?? []), s]);
  return [...by].sort(([a], [b]) => (a === KERNEL_ROOM ? -1 : b === KERNEL_ROOM ? 1 : a.localeCompare(b))).map(([name, mains]) => {
    const kind = name === KERNEL_ROOM ? 'kernel' as const : 'rig' as const;
    const pid = projectIdOf(mains[0]!);
    return {
      project: rigProject({ id: `rig:${name}`, name, kind }),
      tables: [{ key: `rig:${name}`, mains }],
      rig: { kind, name, folder: mains[0]!.cwd ?? '', project: pid ? projectName(pid) : null }
    };
  });
}
/** A rig's room colour: the kernel's violet, a rig's slate. */
export const rigColor = (kind: RigRoomInfo['kind']): ProjectColor => (kind === 'kernel' ? 'violet' : 'slate');

/** Room, then seat (Alt ←/→, Alt 1…9, J / K); `MAX_SEATS` applies per table. */
export function walkOrder<S extends AtelierSession>(scene: AtelierScene<S, AtelierProject>, maxSeats = MAX_SEATS): S[] {
  return [...scene.rooms.flatMap(r => r.tables.flatMap(t => t.mains.slice(0, maxSeats))), ...scene.unassigned];
}

/** Room margins (atelier units, before zoom): 110 px at the sides and front, 150 px at the back; 70 px between tables. */
export const ROOM_SIDE = 110, ROOM_BACK = 150, TABLE_GAP = 70;
/** A room's width: its tables side by side, the gaps between them and its two side margins. */
export const roomTileWidth = (tables: readonly { mains: readonly unknown[] }[], maxSeats = MAX_SEATS, rugSide = RUG_SIDE): number =>
  tables.reduce((w, t, i) => w + roomWidth(t.mains.length, maxSeats, rugSide) + (i > 0 ? TABLE_GAP : 0), 0) + 2 * ROOM_SIDE;
