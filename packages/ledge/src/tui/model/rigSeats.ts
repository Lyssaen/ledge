import { seatPlan, seatsByRole, type Rig, type RigSeat } from '@ledge/protocol';
import { rigRunning, seatBusy } from './openrig.js';

/**
 * « Sièges du rig » in the TUI (docs/mockups/ledge-openrig.html, view 4, « Sièges (±) »): a running rig's seats by role, the
 * count asked for each, and what reaching it does. Pure: the screen draws it and sends the counts.
 */

export type Delegation = 'pairs' | 'all';

/** A role of the rig: its seats in copy order, and its first seat (whose harness and model the added ones copy). */
export interface SeatRow { role: string; seats: string[]; first: RigSeat }

/** Only a running rig changes seats. */
export const canReseat = (r: Rig | undefined): r is Rig => !!r && rigRunning(r) && r.nodes.length > 0;

export function seatRows(r: Rig): SeatRow[] {
  const byId = new Map(r.nodes.map(n => [n.logicalId, n]));
  return [...seatsByRole(r.nodes)].map(([role, seats]) => ({ role, seats, first: byId.get(seats[0]!)! }));
}

/** Each role's count as it is now. */
export const countsOf = (rows: readonly SeatRow[]): Record<string, number> => Object.fromEntries(rows.map(r => [r.role, r.seats.length]));
/** - + on a role: 0 to 9. */
export const withCount = (counts: Record<string, number>, role: string, by: number): Record<string, number> =>
  ({ ...counts, [role]: Math.max(0, Math.min(9, (counts[role] ?? 0) + by)) });
/** The roles whose count changed, as the daemon takes them. */
export const changedCounts = (rows: readonly SeatRow[], counts: Record<string, number>): Record<string, number> =>
  Object.fromEntries(rows.filter(r => (counts[r.role] ?? r.seats.length) !== r.seats.length).map(r => [r.role, counts[r.role]!]));

export type Plan = ReturnType<typeof seatPlan>;
export const planOf = (r: Rig, rows: readonly SeatRow[], counts: Record<string, number>): Plan => seatPlan(r.nodes, changedCounts(rows, counts));

/** A role's chips: its seats (removed ones flagged), then the seats added (`build-2`). */
export function chips(row: SeatRow, plan: Plan): Array<{ id: string; kind: 'kept' | 'added' | 'removed' }> {
  const removed = new Set(plan.remove);
  return [
    ...row.seats.map(id => ({ id, kind: removed.has(id) ? 'removed' as const : 'kept' as const })),
    ...plan.add.filter(a => a.role === row.role).map(a => ({ id: a.id, kind: 'added' as const }))
  ];
}

/** The seats removed while they work: their work in progress stops with them. */
export const busyRemovals = (r: Rig, plan: Plan): string[] => plan.remove.filter(id => { const n = r.nodes.find(x => x.logicalId === id); return !!n && seatBusy(n); });

/** The commands the preview lists, in order: an add per seat added, a remove per seat removed, the links when seats are
 *  added, then a snapshot (so a restart keeps the new size). `links` names how the added seats are linked. */
export function previewCommands(rig: string, plan: Plan, links: string): string[] {
  if (!plan.add.length && !plan.remove.length) return [];
  return [
    ...plan.add.map(a => `rig add ${rig} ${a.pod} ${a.id}`),
    ...plan.remove.map(id => `rig remove ${rig} ${id}`),
    ...(plan.add.length ? [`rig edge add … (${links})`] : []),
    `rig snapshot ${rig}`
  ];
}
