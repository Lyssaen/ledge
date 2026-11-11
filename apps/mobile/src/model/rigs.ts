// What the Rigs tab draws from OpenRig's state (docs/mockups/ledge-mobile-refonte/m4-rigs.html): a rig's status, what in it waits on
// the person, its seats' states, its queue rows' tones, the kernel's routing words. Pure, so the screens and the tests share it.
import {
  KERNEL_RIG, seatsByRole,
  type HumanAsk, type PhoneOpenRigState, type PhoneSession, type RigGraphSeat, type RigSeat, type RigSeatPermission
} from '@ledge/protocol';
import type { DotState } from '../ui/kit/marks';

type Rig = PhoneOpenRigState['rigs'][number];

/** A rig's status as its chip says it, and only that (Q48): running, starting, partial (some seats stopped), stopped. */
export type RigStatus = 'running' | 'starting' | 'partial' | 'stopped';

const STARTING = new Set(['starting', 'launching', 'booting']);

export function rigStatus(r: Pick<Rig, 'status' | 'lifecycleState' | 'running' | 'nodes'>): RigStatus {
  if (STARTING.has(r.status) || STARTING.has(r.lifecycleState)) return 'starting';
  if (r.status === 'partial') return 'partial';
  const runs = r.status === 'running' || r.running > 0;
  if (!runs) return 'stopped';
  return r.nodes.some(n => n.stopped) ? 'partial' : 'running';
}

export const runs = (s: RigStatus): boolean => s !== 'stopped';

/** The kernel, OpenRig's own rig, apart from the others. */
export const kernelOf = (s: PhoneOpenRigState): Rig | undefined => s.rigs.find(r => r.name === KERNEL_RIG);

const RANK: Record<RigStatus, number> = { running: 0, partial: 0, starting: 0, stopped: 1 };
/** The rigs of the list: the kernel out, those that run first, each group in OpenRig's order (Q38). */
export const listedRigs = (s: PhoneOpenRigState): Rig[] =>
  s.rigs.filter(r => r.name !== KERNEL_RIG).map((r, i) => ({ r, i })).sort((a, b) => RANK[rigStatus(a.r)] - RANK[rigStatus(b.r)] || a.i - b.i).map(x => x.r);

/** The Ledge session that follows a seat: its rig and its role (`pod.member`), as the PC names them. */
export const sessionOfSeat = (sessions: Iterable<PhoneSession>, rig: string, logicalId: string): PhoneSession | undefined => {
  for (const s of sessions) if (s.rig?.name === rig && s.rig.role === logicalId && s.state !== 'exited') return s;
  return undefined;
};

/** What waits on the person in a rig: its seats' permissions, and their questions with the rows OpenRig parked on the person. */
export interface Attention { perm: number; ask: number }

export function attentionOf(rig: string, sessions: Iterable<PhoneSession>, asks: readonly HumanAsk[] | null): Attention {
  let perm = 0, ask = 0;
  for (const s of sessions) {
    if (s.rig?.name !== rig || !s.pending) continue;
    // Plans and diffs count as permissions, as in « À toi ».
    if (s.pending.kind === 'question') ask += 1; else perm += 1;
  }
  for (const a of asks ?? []) if (a.from.rig === rig && a.kind !== 'update') ask += 1;
  return { perm, ask };
}

export const isWorking = (n: Pick<RigSeat, 'activity' | 'work'>): boolean => n.activity === 'running' || n.work > 0;

/** The rig's dot: its most urgent (permission > question > at work > free > stopped), Q48. */
export function rigDot(r: Rig, a: Attention): DotState {
  if (a.perm) return 'perm';
  if (a.ask) return 'ask';
  const s = rigStatus(r);
  if (s === 'stopped') return 'off';
  return s === 'starting' || r.nodes.some(isWorking) ? 'work' : 'idle';
}

/** A seat's state, as a node of the topology says it in words: its session's when Ledge follows it, else OpenRig's. */
export type SeatState = 'perm' | 'ask' | 'work' | 'idle' | 'off' | 'starting' | 'waiting';

export function seatState(o: { session?: PhoneSession | undefined; node?: RigSeat | undefined; graph?: RigGraphSeat | undefined; rigStatus: RigStatus }): SeatState {
  const { session, node, graph } = o;
  if (o.rigStatus === 'stopped') return 'off';
  if (session) {
    if ((session.pending && session.pending.kind !== 'question') || session.state === 'waiting_permission' || session.state === 'error') return 'perm';
    if (session.pending || session.state === 'waiting_input') return 'ask';
    if (session.state === 'starting') return 'starting';
    if (session.state === 'working') return 'work';
    return 'idle';
  }
  if (node?.stopped || graph?.status === 'exited' || graph?.status === 'stopped') return o.rigStatus === 'starting' ? 'waiting' : 'off';
  if (o.rigStatus === 'starting' && !node) return 'waiting';
  if (node && isWorking(node)) return 'work';
  if (graph?.attention || node?.attention) return 'ask';
  return 'idle';
}

export const SEAT_DOT: Record<SeatState, DotState> = { perm: 'perm', ask: 'ask', work: 'work', idle: 'idle', off: 'off', starting: 'work', waiting: 'off' };

/** The runtime's two letters for a topology node (`claude-code` → CC, `codex` → CX), null for one Ledge does not draw. */
export const toolOf = (runtime: string): 'claude' | 'codex' | 'cursor' | 'omp' | null =>
  runtime === 'claude-code' || runtime === 'claude' ? 'claude' : runtime === 'codex' ? 'codex' : runtime === 'cursor' ? 'cursor' : runtime === 'omp' ? 'omp' : null;

/** A node's short name: its member (`dev.front` → `dev-front`, as OpenRig names the session before the `@`). */
export const seatName = (logicalId: string, session?: string): string => session?.split('@')[0] || logicalId.replace('.', '-');

/** The graph's pods, each with its seats in the graph's order; a seat whose pod is not listed goes under its own. */
export function podsOf(seats: readonly RigGraphSeat[], pods: readonly { id: string; label: string }[]): { id: string; label: string; seats: RigGraphSeat[] }[] {
  const out = pods.map(p => ({ ...p, seats: seats.filter(s => s.pod === p.id) }));
  for (const s of seats) if (!out.some(p => p.id === s.pod)) out.push({ id: s.pod, label: s.pod, seats: seats.filter(x => x.pod === s.pod) });
  return out.filter(p => p.seats.length);
}

/**
 * The topology's top: the seat others delegate from and none delegates to (the lead), drawn alone above the pods; null when the
 * links do not tell one.
 */
export function topSeat(seats: readonly RigGraphSeat[], links: readonly { from: string; to: string; kind: string }[]): string | null {
  const delegating = links.filter(l => /delegat/.test(l.kind));
  const from = new Set(delegating.map(l => l.from));
  const to = new Set(delegating.map(l => l.to));
  const tops = seats.filter(s => from.has(s.logicalId) && !to.has(s.logicalId));
  return tops.length === 1 ? tops[0]!.logicalId : null;
}

// ── Permissions (Desktop's ide/rig/model.ts) ──

export type PermLevel = 'spec' | 'auto' | 'standard' | 'open' | 'yolo' | 'locked';
/** The levels as the sheet lists them (m4-rigs.html, §7): Desktop's five, then « Spec ». */
export const PERM_LEVELS: readonly PermLevel[] = ['auto', 'standard', 'open', 'yolo', 'locked', 'spec'];

const BUILTIN = /^builtin:(auto|standard|open|yolo|locked)$/;

function levelOf(seat: RigSeatPermission): PermLevel | null {
  switch (seat.policySource) {
    case 'member_policy': return (BUILTIN.exec(seat.policy ?? '')?.[1] as PermLevel | undefined) ?? null;
    case 'rig_policy': case 'team_default': case 'kernel_default': case 'floor': return 'spec';
    default: return null;
  }
}

/** The level every seat shares, `mixed` when they differ or one is unknown, null without seats. */
export function permLevelOf(seats: readonly RigSeatPermission[]): PermLevel | 'mixed' | null {
  if (seats.length === 0) return null;
  const levels = seats.map(levelOf);
  const first = levels[0];
  return first && levels.every(l => l === first) ? first : 'mixed';
}

/** The spec's policy as a level (`builtin:auto` → auto), null when it names none Ledge knows. */
export const specLevel = (policy: string | undefined): PermLevel | null => (BUILTIN.exec(policy ?? '')?.[1] as PermLevel | undefined) ?? null;

// ── Seats by role ──

export interface RoleCount { role: string; count: number; ids: string[] }

export const roleCounts = (r: Pick<Rig, 'nodes'>): RoleCount[] => [...seatsByRole(r.nodes)].map(([role, ids]) => ({ role, count: ids.length, ids }));

// ── Queue ──

/** A queue row's tone: one OpenRig parked on the person (« à toi »), in progress, pending, blocked. */
export type RowTone = 'mine' | 'progress' | 'pending' | 'blocked';

export function rowTone(row: { id: string; state: string }, asks: readonly HumanAsk[] | null): RowTone {
  if (asks?.some(a => a.id === row.id)) return 'mine';
  return row.state === 'in-progress' ? 'progress' : row.state === 'blocked' ? 'blocked' : 'pending';
}

/** A closed row's end: done, handed off, or one of the ways it stopped. */
export type ClosedTone = 'done' | 'handed' | 'stopped';
export const closedTone = (state: string): ClosedTone => (state === 'done' ? 'done' : state === 'handed-off' ? 'handed' : 'stopped');

// ── Routing ──

/** One routing step in Ledge's words: OpenRig's `change`, read (`claimed`, `handed off to <seat>`, `blocked on <row>`…). */
export type Change = { verb: 'claimed' | 'completed' | 'canceled' | 'resumed' | 'failed' } | { verb: 'handed'; to: string } | { verb: 'blocked'; on: string } | { verb: 'other'; text: string };

export function changeOf(change: string): Change {
  const c = change.trim();
  const handed = /^handed[ _-]?off(?: to)? (.+)$/i.exec(c);
  if (handed) return { verb: 'handed', to: handed[1]!.split('@')[0]! };
  const blocked = /^blocked(?: on)? (.+)$/i.exec(c);
  if (blocked) return { verb: 'blocked', on: blocked[1]! };
  const v = c.toLowerCase();
  if (v === 'claimed') return { verb: 'claimed' };
  if (v === 'completed' || v === 'done') return { verb: 'completed' };
  if (v === 'canceled' || v === 'cancelled') return { verb: 'canceled' };
  if (v === 'resumed' || v === 'unblocked') return { verb: 'resumed' };
  if (v === 'failed') return { verb: 'failed' };
  return { verb: 'other', text: c };
}

// ── Times ──

/** OpenRig's UTC time (`2026-11-08 14:54:01`) or an ISO one, as a date; null when it cannot be read. */
export function parseRigTime(t: string): Date | null {
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(t) ? `${t.replace(' ', 'T')}Z` : t;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** How far a day is from today, in the phone's time zone: 0 today, 1 yesterday, more before. */
export function daysAgo(d: Date, now: Date): number {
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((day(now) - day(d)) / 86_400_000);
}

/** A seat id is the kernel's operator, Max (`operator.agent`). */
export const isOperator = (logicalId: string): boolean => logicalId.startsWith('operator.');
