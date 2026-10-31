import type { Escalation, OpenRigStatus, Projects, Rig, RigSeat, Session } from '@ledge/protocol';
import { isPending } from '@ledge/fleet';
import { kernelSplit, rigPlace, workingCount, type RigPlace } from '@ledge/ui/rigs/model';
import type { Focus } from '../context.js';
import type { Glyphs } from '../glyphs.js';
import { fr } from '../i18n/fr.js';
import type { Messages } from '../i18n/lang.js';
import { C, projectColor } from '../theme.js';
import { openEscalations, overview } from './overview.js';

/** An item of « À toi »: an escalation (its id `e:<machine>:<id>`) or a standalone session waiting (its id the session's). */
export interface YoursItem {
  id: string; glyph: 'approval' | 'question'; who: string; where: string; text: string; at: string; escalation?: Escalation; session?: Session;
}
export type LeftRow =
  | { kind: 'ledge'; preview: string; at?: string; unread: number }
  | { kind: 'yours'; item: YoursItem }
  | { kind: 'project'; label: string; color: string; count: number } | { kind: 'branch'; branch: string }
  | { kind: 'session'; s: Session }
  | { kind: 'rig'; rig: Rig; place: RigPlace; working: number; total: number }
  | { kind: 'seat'; rig: Rig; seat: RigSeat; session?: Session } | { kind: 'idle'; rig: Rig; names: string[] }
  /** OpenRig's kernel of a machine: its state, its seats shown (advisor and the human's terminal tucked away), how many work. */
  | { kind: 'kernel'; machine: string; state: OpenRigStatus['state']; seats: string[]; working: number };

export interface LeftInput {
  sessions: Session[]; projects: Projects | null; rigs: Rig[]; escalations: Escalation[]; openrig: OpenRigStatus[];
  ledge: { preview: string; at?: string; unread: number };
  /** The words of the rows (« Ledge s’en occupe… »); French by default. */
  t?: Messages;
}

export const escalationItemId = (e: Pick<Escalation, 'machine' | 'id'>): string => `e:${e.machine}:${e.id}`;
/** The seat an escalation comes from: its ref (`orch-lead@factory`), on the same machine. */
const fromSeat = (e: Escalation, rig: Rig, seat: RigSeat): boolean => e.machine === rig.machine && e.from === seat.ref;
const isOpen = (e: Escalation) => e.state === 'pending' || e.state === 'grace';
/** Available seats fold into one line; a seat with an escalation open stays on its own. */
const AVAILABLE = new Set<RigSeat['state']>(['idle', 'ready']);

/**
 * The home's left column, top to bottom: Ledge's row; « À toi » (the open escalations, then the standalone sessions waiting, each the
 * oldest first); « Projets · sessions seules » (the tree, standalone sessions only); « Rigs » (each rig by name, its active seats, its
 * available ones folded in one line), the kernels last. `project`'s colour is the project's (`projectColor` is the caller's: the tree
 * gives the raw colour name or none, see `ProjectNode.color`).
 */
export function leftRows(i: LeftInput): LeftRow[] {
  const view = overview(i.sessions, i.projects, [], i.rigs, i.escalations);
  const byId = new Map(i.sessions.map(s => [s.id, s]));
  const rigName = (e: Escalation) => (e.rigId ? i.rigs.find(r => r.machine === e.machine && r.id === e.rigId)?.name : undefined);
  const seatName = (e: Escalation) => {
    const rig = e.rigId ? i.rigs.find(r => r.machine === e.machine && r.id === e.rigId) : undefined;
    return rig?.seats.find(s => fromSeat(e, rig, s))?.name ?? e.from.split('@')[0]!;
  };
  const projectLabel = new Map(view.tree.flatMap(n => n.branches.flatMap(b => b.sessions.map(s => [s.id, n.label] as const))));
  const yours: LeftRow[] = [
    ...view.escalations.map((e): LeftRow => ({ kind: 'yours', item: {
      id: escalationItemId(e), glyph: 'approval', who: seatName(e), where: rigName(e) ?? e.machine,
      text: e.state === 'grace' ? (i.t ?? fr).home.grace : e.summary, at: e.createdAt, escalation: e
    } })),
    ...view.yours.map((s): LeftRow => ({ kind: 'yours', item: {
      id: s.id, glyph: s.state === 'waiting_input' ? 'question' : 'approval', who: s.name, where: projectLabel.get(s.id) ?? s.repo ?? s.project,
      text: s.pending?.text ?? '', at: s.lastActivityAt, session: s
    } }))
  ];
  const tree: LeftRow[] = view.tree.flatMap(n => [
    { kind: 'project' as const, label: n.label, color: projectColor(n.color), count: n.count },
    ...n.branches.flatMap(b => [{ kind: 'branch' as const, branch: b.branch }, ...b.sessions.map(s => ({ kind: 'session' as const, s }))])
  ]);
  const rigs: LeftRow[] = i.rigs.filter(r => !r.kernel).sort((a, b) => a.name.localeCompare(b.name) || a.machine.localeCompare(b.machine)).flatMap(rig => {
    const seats = rig.seats.filter(s => s.state !== 'stopped');
    const waits = (s: RigSeat) => i.escalations.some(e => isOpen(e) && fromSeat(e, rig, s));
    const folded = seats.filter(s => AVAILABLE.has(s.state) && !waits(s));
    const active = seats.filter(s => !folded.includes(s));
    return [
      { kind: 'rig' as const, rig, place: rigPlace(rig, i.projects), working: workingCount(rig), total: seats.length },
      ...active.map(seat => {
        const paired = seat.sessionId ? byId.get(seat.sessionId) : undefined;
        return { kind: 'seat' as const, rig, seat, ...(paired ? { session: paired } : {}) };
      }),
      ...(folded.length ? [{ kind: 'idle' as const, rig, names: folded.map(s => s.name) }] : [])
    ];
  });
  // One kernel per machine: its rig when OpenRig lists one, else the machine's OpenRig state alone (stopped, starting…).
  const kernels = new Map<string, Extract<LeftRow, { kind: 'kernel' }>>();
  for (const rig of i.rigs) {
    if (!rig.kernel || kernels.has(rig.machine)) continue;
    const { shown } = kernelSplit({ ...rig, seats: rig.seats.filter(s => s.state !== 'stopped') });
    const state = i.openrig.find(s => s.machine === rig.machine)?.state ?? 'running';
    kernels.set(rig.machine, { kind: 'kernel', machine: rig.machine, state, seats: shown.map(s => s.name), working: shown.filter(s => s.state === 'working').length });
  }
  for (const s of i.openrig) {
    if (kernels.has(s.machine) || s.state === 'absent' || s.state === 'unsupported') continue;
    kernels.set(s.machine, { kind: 'kernel', machine: s.machine, state: s.state, seats: [], working: 0 });
  }
  const kernelRows = [...kernels.values()].sort((a, b) => Number(b.machine === 'local') - Number(a.machine === 'local') || a.machine.localeCompare(b.machine));
  return [{ kind: 'ledge', ...i.ledge }, ...yours, ...tree, ...rigs, ...kernelRows];
}

/** Whether OpenRig runs, or ran, on some machine: else the Rigs section says it is not installed. */
export const hasOpenRig = (rigs: readonly Rig[], openrig: readonly OpenRigStatus[]): boolean =>
  rigs.length > 0 || openrig.some(s => s.state !== 'absent' && s.state !== 'unsupported');

/** The rows `j` `k` walk, in order (projects, branches and folded seats are not chosen). */
export function focusOrder(rows: readonly LeftRow[]): Focus[] {
  return rows.flatMap((r): Focus[] => {
    switch (r.kind) {
      case 'ledge': return [{ kind: 'ledge' }];
      case 'yours': return [{ kind: 'yours', id: r.item.id }];
      case 'session': return [{ kind: 'session', id: r.s.id }];
      case 'rig': return [{ kind: 'rig', machine: r.rig.machine, rigId: r.rig.id }];
      case 'seat': return [{ kind: 'seat', machine: r.rig.machine, rigId: r.rig.id, ref: r.seat.ref }];
      case 'kernel': return [{ kind: 'kernel', machine: r.machine }];
      default: return [];
    }
  });
}

/** A focus as a string, to compare and find it. */
export function focusKey(f: Focus): string {
  switch (f.kind) {
    case 'ledge': return 'ledge';
    case 'yours': return `yours|${f.id}`;
    case 'session': return `session|${f.id}`;
    case 'rig': return `rig|${f.machine}|${f.rigId}`;
    case 'seat': return `seat|${f.machine}|${f.rigId}|${f.ref}`;
    case 'kernel': return `kernel|${f.machine}`;
  }
}

/** The focus a row gives (undefined for a row not chosen). */
export const rowFocus = (row: LeftRow): Focus | undefined => focusOrder([row])[0];

/** The session a focus shows: a session, a waiting session, a seat's paired session (a placeholder when it has none). */
export function focusSession(f: Focus, rows: readonly LeftRow[], byId: ReadonlyMap<string, Session>): Session | null {
  if (f.kind === 'session') return byId.get(f.id) ?? null;
  if (f.kind === 'yours') return byId.get(f.id) ?? null;
  if (f.kind === 'seat') {
    const row = rows.find((r): r is Extract<LeftRow, { kind: 'seat' }> => r.kind === 'seat' && r.rig.machine === f.machine && r.rig.id === f.rigId && r.seat.ref === f.ref);
    return row?.session ?? null;
  }
  return null;
}

/** The focus after the rows changed: the same one while it is listed; a waiting session that no longer waits is still chosen in
 *  Projets; a session not listed yet stays; else the one now at its place, else Ledge. */
export function keepFocus(order: readonly Focus[], focus: Focus, previous: readonly Focus[]): Focus {
  const keys = order.map(focusKey);
  if (keys.includes(focusKey(focus))) return focus;
  if (focus.kind === 'yours' && keys.includes(`session|${focus.id}`)) return { kind: 'session', id: focus.id };
  if (focus.kind === 'session' && keys.includes(`yours|${focus.id}`)) return { kind: 'yours', id: focus.id };
  const at = previous.findIndex(f => focusKey(f) === focusKey(focus));
  // A session chosen before it is listed (just launched): it stays chosen until it comes.
  if (at < 0 && focus.kind === 'session') return focus;
  for (let i = at; i >= 0; i--) { const k = keys.indexOf(focusKey(previous[i]!)); if (k >= 0) return order[k]!; }
  return order[0] ?? { kind: 'ledge' };
}

/** `j` `k`: the next or previous row, wrapping. */
export function stepFocus(order: readonly Focus[], focus: Focus, by: 1 | -1): Focus {
  if (order.length === 0) return focus;
  const at = order.findIndex(f => focusKey(f) === focusKey(focus));
  return order[(at + by + order.length) % order.length]!;
}

/** `tab`: the next item of « À toi » after the focus, wrapping (the focus stays when nothing waits). */
export function nextYours(order: readonly Focus[], focus: Focus): Focus {
  const yours = order.filter(f => f.kind === 'yours');
  if (yours.length === 0) return focus;
  const at = yours.findIndex(f => focusKey(f) === focusKey(focus));
  return yours[(at + 1) % yours.length]!;
}

/** A seat's state as the column reads it: « Attend Ledge » while an escalation of this seat is open. */
export function seatStateLabel(seat: RigSeat, escalations: readonly Escalation[], words: Messages['seat'] = fr.seat): { glyph: keyof Glyphs; color: string; label: string } {
  if (escalations.some(e => isOpen(e) && e.from === seat.ref)) return { glyph: 'approval', color: C.yellow, label: words.waitsLedge };
  switch (seat.state) {
    case 'working': return { glyph: 'working', color: C.blue, label: words.working };
    case 'idle': case 'ready': return { glyph: 'idle', color: C.green, label: words.idle };
    case 'starting': case 'trust': return { glyph: 'starting', color: C.blue, label: words.starting };
    case 'stopped': return { glyph: 'done', color: C.faint, label: words.stopped };
    case 'crashed': return { glyph: 'error', color: C.red, label: words.crashed };
    case 'unreachable': return { glyph: 'readonly', color: C.dim, label: words.unreachable };
  }
}

/** Who waits for the user: the escalations still pending (not those Ledge handles in its grace) and the standalone sessions waiting. */
export const waitingCount = (rows: readonly LeftRow[]): number =>
  rows.filter(r => r.kind === 'yours' && (r.item.escalation ? r.item.escalation.state === 'pending' : !!r.item.session && isPending(r.item.session))).length;

export { openEscalations };
