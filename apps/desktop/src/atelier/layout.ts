import type { Helper, Project, Projects, Session } from '@ledge/protocol';
import type { BotState } from '@ledge/ui/bots/poseFor';
import type { ProjectFilter } from '../nav/state';

/** The mockup's constants (observatory.tsx). */
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
export const roomWidth = (mains: number): number => tableLength(Math.min(mains, MAX_SEATS)) + 2 * RUG_SIDE;

export function layoutTable(mains: readonly Session[], showHelpers: boolean): TableLayout {
  const seated = mains.slice(0, MAX_SEATS);
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
    for (const parent of mains.slice(MAX_SEATS)) for (const helper of parent.helpers ?? []) extraHelpers.push({ helper, parent });
  }
  const ends: EndSeat[] = (['left', 'right'] as const).flatMap(end => bins[end].map((b, slot) => ({ ...b, end, slot, count: bins[end].length })));
  const extraMains = mains.slice(MAX_SEATS);
  return { length, width: roomWidth(mains.length), seats, ends, notes, extra: { mains: extraMains, helpers: extraHelpers }, extraCount: extraMains.length + extraHelpers.length };
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

export interface AtelierScene { tables: { project: Project; mains: Session[] }[]; unassigned: Session[]; empty: Project | null }

export function sceneOf(order: readonly Session[], projects: Projects | null, projectIdOf: (s: Session) => string | null, filter: ProjectFilter): AtelierScene {
  const list = projects?.projects ?? [];
  const known = new Set(list.map(p => p.id));
  const idOf = (s: Session) => { const id = projectIdOf(s); return id !== null && known.has(id) ? id : null; };
  const showTables = filter === 'all' || filter !== 'none';
  const tables = showTables
    ? list.filter(p => filter === 'all' || p.id === filter).map(project => ({ project, mains: order.filter(s => idOf(s) === project.id) })).filter(t => t.mains.length > 0)
    : [];
  const unassigned = filter === 'all' || filter === 'none' ? order.filter(s => idOf(s) === null) : [];
  const target = filter === 'all' || filter === 'none' ? undefined : list.find(p => p.id === filter);
  const empty = target && tables.length === 0 ? target : null;
  return { tables, unassigned, empty };
}

export function walkOrder(scene: AtelierScene): Session[] {
  return [...scene.tables.flatMap(t => t.mains.slice(0, MAX_SEATS)), ...scene.unassigned];
}
