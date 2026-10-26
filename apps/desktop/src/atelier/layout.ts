import { projectOf, type Helper, type Project, type Projects, type Session, type Team } from '@ledge/protocol';
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

/** A table of a room (atelier rooms spec §3.1): the project's common table (today's project table), or a live team's. */
export interface AtelierTable { key: string; kind: 'common' | 'team'; team?: Team; mains: Session[] }
/** A project's room: its walls hold its tables, the common one first, then the teams by creation. */
export interface AtelierRoom { project: Project; tables: AtelierTable[] }
export interface AtelierScene { rooms: AtelierRoom[]; unassigned: Session[]; empty: Project | null }

/** The project a live team's room is: the one its folder falls in now, else the one it was created in. */
export function teamProject(team: Team, projects: Projects | null): string | null {
  if (!projects) return team.project;
  const known = new Set(projects.projects.map(p => p.id));
  const now = projectOf({ cwd: team.cwd, machineId: team.machine }, projects);
  return now ?? (team.project !== null && known.has(team.project) ? team.project : null);
}

/**
 * The rooms of the atelier (atelier rooms spec §3.1). A session sits at its team's table when that team lives in its
 * project's room, else at the room's common table. A team's table is drawn while the team is active or resting, even
 * with no live seat (a resting team shows its seats' ended or archived sessions, found by `lookup`); a dissolved team has
 * none. The common table is drawn when it has sessions, or when the room has no team table. « Sans projet » is unchanged.
 */
export function sceneOf(order: readonly Session[], projects: Projects | null, projectIdOf: (s: Session) => string | null, filter: ProjectFilter,
  teams: readonly Team[] = [], lookup: (id: string) => Session | undefined = () => undefined): AtelierScene {
  const list = projects?.projects ?? [];
  const known = new Set(list.map(p => p.id));
  const idOf = (s: Session) => { const id = projectIdOf(s); return id !== null && known.has(id) ? id : null; };
  const showTables = filter === 'all' || filter !== 'none';
  const live = teams.filter(t => t.state !== 'dissolved');
  const roomOf = new Map(live.map(t => [t.id, teamProject(t, projects)]));
  const rooms = showTables
    ? list.filter(p => filter === 'all' || p.id === filter).map(project => {
      const mains = order.filter(s => idOf(s) === project.id);
      const atTeam = (s: Session) => !!s.team && roomOf.get(s.team) === project.id;
      const teamTables: AtelierTable[] = live.filter(t => roomOf.get(t.id) === project.id).map(team => {
        const seated = mains.filter(s => s.team === team.id);
        // A resting team keeps its seats' bots: their sessions, ended or archived, in seat order.
        const resting = team.state === 'resting' ? team.seats.flatMap(x => { const s = x.sessionId ? (seated.find(m => m.id === x.sessionId) ?? lookup(x.sessionId)) : undefined; return s ? [s] : []; }) : [];
        return { key: `team:${team.id}`, kind: 'team' as const, team, mains: seated.length ? seated : resting };
      });
      const common = mains.filter(s => !atTeam(s));
      const tables: AtelierTable[] = [...(common.length > 0 || teamTables.length === 0 ? [{ key: `common:${project.id}`, kind: 'common' as const, mains: common }] : []), ...teamTables];
      return { project, tables };
    }).filter(r => r.tables.some(t => t.mains.length > 0 || t.kind === 'team'))
    : [];
  const unassigned = filter === 'all' || filter === 'none' ? order.filter(s => idOf(s) === null) : [];
  const target = filter === 'all' || filter === 'none' ? undefined : list.find(p => p.id === filter);
  const empty = target && rooms.length === 0 ? target : null;
  return { rooms, unassigned, empty };
}

/** Room, then table, then seat (Alt ←/→, Alt 1…9, J / K); `MAX_SEATS` applies per table. A resting team's seats are not walked. */
export function walkOrder(scene: AtelierScene, maxSeats = MAX_SEATS): Session[] {
  return [...scene.rooms.flatMap(r => r.tables.flatMap(t => (t.team?.state === 'resting' ? [] : t.mains.slice(0, maxSeats)))), ...scene.unassigned];
}

/** Room margins (atelier units, before zoom): 110 px at the sides and front, 150 px at the back; 70 px between tables. */
export const ROOM_SIDE = 110, ROOM_BACK = 150, TABLE_GAP = 70;
/** A room's width: its tables side by side, the gaps between them and its two side margins. */
export const roomTileWidth = (tables: readonly { mains: readonly unknown[] }[], maxSeats = MAX_SEATS): number =>
  tables.reduce((w, t, i) => w + roomWidth(t.mains.length, maxSeats) + (i > 0 ? TABLE_GAP : 0), 0) + 2 * ROOM_SIDE;
