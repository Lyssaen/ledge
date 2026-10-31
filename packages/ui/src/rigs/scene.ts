import type { Project, Projects, Rig, Session } from '@ledge/protocol';
import { isSeatPlaceholder, isStandalone, parseRigFilter, rigsModel, type RigPlace } from './model';

/**
 * The Atelier's pure scene (« une pièce = une table »), shared by Desktop's Atelier and the future « Bureaux ».
 * No Desktop import here: `filter` is the plain string filter ('all', 'none', a project id, `rig:<machine>/<id>`, `kernel:<machine>`).
 */
export interface AtelierTable { key: string; kind: 'common' | 'rig' | 'kernel'; mains: Session[]; hidden?: number }
export type AtelierRoom =
  | { kind: 'project'; key: string; project: Project; tables: AtelierTable[] }
  | { kind: 'rig'; key: string; rig: Rig; place: RigPlace; tables: [AtelierTable] }
  | { kind: 'kernel'; key: string; rig: Rig; tables: [AtelierTable] };
export interface AtelierScene { rooms: AtelierRoom[]; unassigned: Session[]; empty: Project | null }

const noSessions: ReadonlyMap<string, Session> = new Map();

/**
 * The rooms of the atelier: one per project with a standalone session (a session paired to a running seat sits at its rig's
 * table instead), then one per rig outside the kernels (by name), then one kernel per machine. Rig and kernel tables follow
 * `rigsModel` (the sidebar's Rigs section): the seats still running, in the rig's order, the paired session or a placeholder;
 * the kernel's advisor and terminal seats are only counted (`hidden`). « Sans projet » is the standalone sessions no project claims.
 */
export function sceneOf(order: readonly Session[], projects: Projects | null, projectIdOf: (s: Session) => string | null,
  filter: string, rigs: readonly Rig[] = [], byId: ReadonlyMap<string, Session> = noSessions): AtelierScene {
  const list = projects?.projects ?? [];
  const known = new Set(list.map(p => p.id));
  const idOf = (s: Session) => { const id = projectIdOf(s); return id !== null && known.has(id) ? id : null; };
  const alone = order.filter(s => isStandalone(s, rigs));
  const rf = parseRigFilter(filter);
  const all = filter === 'all';

  const rooms: AtelierRoom[] = [];
  if (all || (filter !== 'none' && !rf)) {
    for (const project of list) {
      if (!all && project.id !== filter) continue;
      const mains = alone.filter(s => idOf(s) === project.id);
      if (mains.length > 0) rooms.push({ kind: 'project', key: project.id, project, tables: [{ key: project.id, kind: 'common', mains }] });
    }
  }
  if (all || rf) {
    const model = rigsModel(rigs, byId, projects);
    for (const row of model.rigs) {
      if (!all && !(rf?.kind === 'rig' && rf.machine === row.rig.machine && rf.rigId === row.rig.id)) continue;
      rooms.push({ kind: 'rig', key: row.key, rig: row.rig, place: row.place, tables: [{ key: row.key, kind: 'rig', mains: row.seats }] });
    }
    for (const k of model.kernels) {
      if (!all && !(rf?.kind === 'kernel' && rf.machine === k.rig.machine)) continue;
      rooms.push({ kind: 'kernel', key: k.key, rig: k.rig, tables: [{ key: k.key, kind: 'kernel', mains: k.shown, hidden: k.hiddenCount }] });
    }
  }
  const unassigned = all || filter === 'none' ? alone.filter(s => idOf(s) === null) : [];
  const target = all || filter === 'none' || rf ? undefined : list.find(p => p.id === filter);
  const empty = target && rooms.length === 0 ? target : null;
  return { rooms, unassigned, empty };
}

/**
 * Who sits at a table of `max` seats, the rest going to « +N »: the seats with a session first (so J / K, which walks only them, always
 * finds them drawn), then the placeholders in the room left, each group keeping the table's order. Without placeholders, a plain cut.
 */
export function tableSeats(mains: readonly Session[], max: number): { seated: Session[]; extra: Session[] } {
  const real = mains.filter(s => !isSeatPlaceholder(s.id));
  const keep = new Set([...real.slice(0, max), ...mains.filter(s => isSeatPlaceholder(s.id)).slice(0, Math.max(0, max - real.length))]);
  return { seated: mains.filter(s => keep.has(s)), extra: mains.filter(s => !keep.has(s)) };
}
