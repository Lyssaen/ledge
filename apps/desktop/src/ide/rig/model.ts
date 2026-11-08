import { roleOf, seatsByRole } from '@ledge/protocol';
import type { Rig, RigGraph, RigGraphSeat, RigPolicy, RigRow, RigSeatPermission, Session } from '@ledge/protocol';
import { isAskSeat } from '../../asks/model';
import { spanOf, type Span } from '../../list/time';
import { seatDot } from '../rigs/model';
import type { RigDot } from '../rigs/model';

/** The « Rig · name » tab as pure functions: its ref, the topology's layout, the permission level, the seats draft, the queue's lines. */

// ── Ref ──

/** A tab's ref: `machine:rig` (machine ids carry no `:`). */
export const rigTabRef = (machine: string, rig: string): string => `${machine}:${rig}`;

export function parseRigRef(ref: string): { machine: string; rig: string } | null {
  const i = ref.indexOf(':');
  return i < 0 ? null : { machine: ref.slice(0, i), rig: ref.slice(i + 1) };
}

// ── Topology ──

export interface TopoNode { logicalId: string; pod: string; name: string; role?: string; runtime: string; dot: RigDot; session?: Session; x: number; y: number }
export interface TopoEdge { from: string; to: string; kind: string; path: string }

const COL = 180, NODE_W = 150, NODE_H = 44, GAP = 28, MARGIN = 40;

/** A seat OpenRig does not tell the session of: `running` and `unknown` are idle (nothing says it works), `exited`, `stopped`… are off. */
const graphActivity = (seat: RigGraphSeat): { activity: string; stopped: boolean } =>
  ({ activity: 'idle', stopped: seat.status !== 'running' && seat.status !== 'unknown' });

export function layoutOf(graph: RigGraph, sessions: readonly Session[], machine: string, running: boolean): {
  nodes: TopoNode[]; edges: TopoEdge[]; pods: { id: string; label: string; x: number }[]; width: number; height: number;
} {
  const pods = graph.pods.map(p => ({ id: p.id, label: p.label }));
  for (const s of graph.seats) if (!pods.some(p => p.id === s.pod)) pods.push({ id: s.pod, label: s.pod });
  const rows = new Map<string, number>();
  const nodes: TopoNode[] = graph.seats.map(seat => {
    const col = pods.findIndex(p => p.id === seat.pod);
    const row = rows.get(seat.pod) ?? 0;
    rows.set(seat.pod, row + 1);
    const joined = seat.session ? sessions.find(s => isAskSeat(s, seat.session!, machine)) : undefined;
    return {
      logicalId: seat.logicalId, pod: seat.pod, name: joined?.name ?? seat.logicalId, ...(seat.role ? { role: seat.role } : {}), runtime: seat.runtime,
      dot: running ? seatDot(joined, graphActivity(seat)) : 'off', ...(joined ? { session: joined } : {}),
      x: MARGIN + col * COL, y: MARGIN + row * (NODE_H + GAP)
    };
  });
  const byId = new Map(nodes.map(n => [n.logicalId, n]));
  const edges: TopoEdge[] = [];
  for (const l of graph.links) {
    const a = byId.get(l.from), b = byId.get(l.to);
    if (a && b) edges.push({ from: l.from, to: l.to, kind: l.kind, path: pathOf(a, b) });
  }
  return {
    nodes, edges, pods: pods.map((p, i) => ({ ...p, x: MARGIN + i * COL })),
    width: Math.max(2 * MARGIN, ...nodes.map(n => n.x + NODE_W + MARGIN)), height: Math.max(2 * MARGIN, ...nodes.map(n => n.y + NODE_H + MARGIN))
  };
}

/** A cubic Bézier: right edge to left edge across pods (left edge to right edge when the target is a column behind), bottom to top inside one pod. */
function pathOf(a: TopoNode, b: TopoNode): string {
  if (a.x === b.x) {
    const down = b.y >= a.y;
    const sx = a.x + NODE_W / 2, sy = down ? a.y + NODE_H : a.y, ty = down ? b.y : b.y + NODE_H, k = (ty - sy) / 2;
    return `M${sx},${sy} C${sx},${sy + k} ${sx},${ty - k} ${sx},${ty}`;
  }
  const fwd = b.x > a.x;
  const sx = fwd ? a.x + NODE_W : a.x, sy = a.y + NODE_H / 2, tx = fwd ? b.x : b.x + NODE_W, ty = b.y + NODE_H / 2, k = (tx - sx) / 2;
  return `M${sx},${sy} C${sx + k},${sy} ${tx - k},${ty} ${tx},${ty}`;
}

// ── Permissions ──

export type PermLevel = 'spec' | 'auto' | 'standard' | 'open' | 'yolo' | 'locked';
export const PERM_LEVELS: readonly PermLevel[] = ['spec', 'auto', 'standard', 'open', 'yolo', 'locked'];

export const policyOf = (level: PermLevel): RigPolicy | 'spec' => level;

const BUILTIN = /^builtin:(auto|standard|open|yolo|locked)$/;

/** One seat's level, null when it cannot be told: a member policy that is `none` or unread, an explicit selection, no source. */
function levelOf(seat: RigSeatPermission): PermLevel | null {
  switch (seat.policySource) {
    case 'member_policy': return (BUILTIN.exec(seat.policy ?? '')?.[1] as PermLevel | undefined) ?? null;
    case 'rig_policy': case 'team_default': case 'kernel_default': case 'floor': return 'spec';
    default: return null;
  }
}

/** The level every seat shares, `'mixed'` when they differ or one is unknown, null without seats. */
export function permLevelOf(seats: readonly RigSeatPermission[]): PermLevel | 'mixed' | null {
  if (seats.length === 0) return null;
  const levels = seats.map(levelOf);
  const first = levels[0];
  return first && levels.every(l => l === first) ? first : 'mixed';
}

// ── Seats ──

export interface RoleCount { role: string; runtime: string; count: number }

/** A running rig's roles (in order of appearance) with their seat count and their first seat's runtime. */
export function roleCounts(rig: Rig): RoleCount[] {
  const by = seatsByRole(rig.nodes);
  const node = new Map(rig.nodes.map(n => [n.logicalId, n]));
  return [...by].map(([role, ids]) => ({ role, runtime: node.get(ids[0]!)?.runtime ?? '', count: ids.length }));
}

const SEATS_MAX = 9;

/** The draft over the roles that exist: a role without an entry keeps its count, a role that left is dropped, a count is 1 to 9. */
export function seatDraft(counts: readonly RoleCount[], draft: Readonly<Record<string, number>>): { seats: Record<string, number>; changed: boolean } {
  const seats: Record<string, number> = {};
  for (const c of counts) {
    const want = draft[c.role];
    seats[c.role] = want !== undefined && Number.isFinite(want) ? Math.min(SEATS_MAX, Math.max(1, Math.round(want))) : c.count;
  }
  return { seats, changed: counts.some(c => seats[c.role] !== c.count) };
}

// ── Queue ──

export interface QueueLine { id: string; state: string; needsInput: boolean; summary: string; from: string; to: string; age: Span }

export function queueLines(rows: readonly RigRow[], sessions: readonly Session[], machine: string, now: number): QueueLine[] {
  const nameOf = (seat: string): string => sessions.find(s => isAskSeat(s, seat, machine))?.name ?? seat;
  return rows.map(r => ({
    id: r.id, state: r.state, needsInput: !!r.needsInput, summary: r.summary ?? '', from: nameOf(r.from), to: nameOf(r.to), age: spanOf(now - (Date.parse(r.updatedAt) || now))
  }));
}
