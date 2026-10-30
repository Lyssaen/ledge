import { PROJECT_COLORS, type Escalation, type Projects, type ProjectColor, type Rig, type RigSeat, type SeatState, type Session } from '@ledge/protocol';

export const rigKey = (r: Pick<Rig, 'machine' | 'id'>): string => `${r.machine}/${r.id}`;
/** The Atelier filter naming one rig. */
export const rigFilter = (r: Pick<Rig, 'machine' | 'id'>): string => `rig:${r.machine}/${r.id}`;
export const kernelFilter = (machine: string): string => `kernel:${machine}`;

export function parseRigFilter(f: string): { kind: 'rig'; machine: string; rigId: string } | { kind: 'kernel'; machine: string } | null {
  if (f.startsWith('kernel:')) {
    const machine = f.slice('kernel:'.length);
    return machine ? { kind: 'kernel', machine } : null;
  }
  if (f.startsWith('rig:')) {
    const rest = f.slice('rig:'.length);
    const i = rest.indexOf('/');
    if (i <= 0 || i === rest.length - 1) return null;
    return { kind: 'rig', machine: rest.slice(0, i), rigId: rest.slice(i + 1) };
  }
  return null;
}

const COLOR_NAMES = Object.keys(PROJECT_COLORS) as ProjectColor[];
/** Stable colour of a rig: its name hashed, so the same name has the same colour on every machine. */
export function rigColor(r: Pick<Rig, 'name'>): ProjectColor {
  let sum = 0;
  for (let i = 0; i < r.name.length; i++) sum += r.name.charCodeAt(i);
  return COLOR_NAMES[sum % COLOR_NAMES.length]!;
}

export const SEAT_PLACEHOLDER = 'seat:';
export const isSeatPlaceholder = (id: string): boolean => id.startsWith(SEAT_PLACEHOLDER);

const toolOf = (runtime: string): Session['tool'] => (runtime === 'codex' ? 'codex' : 'claude');
const PHANTOM_STATE: Record<SeatState, Session['state']> = {
  working: 'working', trust: 'starting', starting: 'starting', ready: 'idle', idle: 'idle',
  crashed: 'error', stopped: 'exited', unreachable: 'idle'
};

/**
 * The Desktop session of a seat: the paired one (`seat.sessionId` is already machine-qualified by the fleet), else a phantom
 * read-only session. Phantom neutral fields: `project`/`title` '', `tmuxSession` null, `helpers` [], `startedAt` and
 * `lastActivityAt` the epoch (the seat has no start time), `machineId` the rig's machine. These timestamps and the empty
 * title/task are placeholders: consumers must not render a time or task line when `isSeatPlaceholder(s.id)`.
 * Seat state mapping: unreachable becomes `state: 'idle'` + `offline: true`; crashed `error`; stopped `exited`.
 */
export function seatSession(seat: RigSeat, rig: Rig, byId: ReadonlyMap<string, Session>): Session {
  const paired = seat.sessionId ? byId.get(seat.sessionId) : undefined;
  if (paired) return paired;
  const epoch = new Date(0).toISOString();
  return {
    id: `${SEAT_PLACEHOLDER}${rigKey(rig)}/${seat.ref}`,
    name: seat.name,
    tool: toolOf(seat.runtime),
    cwd: rig.cwd,
    project: '',
    title: '',
    tmuxSession: null,
    state: PHANTOM_STATE[seat.state],
    ...(seat.state === 'unreachable' ? { offline: true } : {}),
    ...(seat.model ? { model: seat.model } : {}),
    machineId: rig.machine,
    helpers: [],
    startedAt: epoch,
    lastActivityAt: epoch,
    source: 'hook_only'
  };
}

/** The kernel's seats: advisor and the human's terminal are tucked away (« +2 »). */
export function kernelSplit(rig: Rig): { shown: RigSeat[]; hidden: RigSeat[] } {
  const hidden: RigSeat[] = [], shown: RigSeat[] = [];
  for (const s of rig.seats) (s.name.startsWith('advisor') || s.runtime === 'terminal' ? hidden : shown).push(s);
  return { shown, hidden };
}

export const workingCount = (rig: Rig): number => rig.seats.filter(s => s.state === 'working').length;
export const readyCount = (rig: Rig): number => rig.seats.filter(s => s.state === 'ready' || s.state === 'working' || s.state === 'idle').length;

export type RigPlace = { kind: 'project'; name: string } | { kind: 'off'; cwd: string } | { kind: 'none' };
export function rigPlace(rig: Rig, projects: Projects | null): RigPlace {
  if (rig.projectId) return { kind: 'project', name: projects?.projects.find(p => p.id === rig.projectId)?.name ?? rig.projectId };
  if (rig.offProject) return { kind: 'off', cwd: rig.cwd };
  return { kind: 'none' };
}

export const SEAT_ORDER: readonly SeatState[] = ['working', 'trust', 'starting', 'ready', 'idle', 'crashed', 'unreachable', 'stopped'];

/** Every seat outside the kernels, working first, then by name. */
export function allSeats(rigs: readonly Rig[]): { rig: Rig; seat: RigSeat }[] {
  return rigs.filter(r => !r.kernel).flatMap(rig => rig.seats.map(seat => ({ rig, seat })))
    .sort((a, b) => SEAT_ORDER.indexOf(a.seat.state) - SEAT_ORDER.indexOf(b.seat.state) || a.seat.name.localeCompare(b.seat.name));
}

/** A seat of a rig by ref, address or name. */
export function seatAt(rigs: readonly Rig[], machine: string, rigId: string, who: string): RigSeat | undefined {
  const rig = rigs.find(r => r.machine === machine && r.id === rigId);
  return rig?.seats.find(s => s.ref === who) ?? rig?.seats.find(s => s.address === who) ?? rig?.seats.find(s => s.name === who);
}

/**
 * Whether a session belongs in Projets: false only when a rig of the same machine has a running seat (any seat of a kernel, hidden
 * ones included) paired to this very session id. Everything else stays (no rig, unknown rig, stopped seat, pairing race, seat paired
 * to another session), so a session is never missing from both Projets and Rigs.
 */
export function isStandalone(s: Session, rigs: readonly Rig[]): boolean {
  const r = s.rig;
  if (!r) return true;
  return !rigs.some(x => x.machine === r.machine && x.seats.some(seat => seat.sessionId === s.id && seat.state !== 'stopped'));
}

export interface RigRow { key: string; rig: Rig; place: RigPlace; seats: Session[]; working: number; waiting: number; remote: boolean }
export interface KernelRow { key: string; rig: Rig; shown: Session[]; hiddenCount: number }

/** The sidebar's Rigs section: rigs by name (kernels apart, one per machine, after them); seats still running, in the rig's order. */
export function rigsModel(rigs: readonly Rig[], byId: ReadonlyMap<string, Session>, projects: Projects | null): { rigs: RigRow[]; kernels: KernelRow[] } {
  const rows = rigs.filter(r => !r.kernel).sort((a, b) => a.name.localeCompare(b.name) || a.machine.localeCompare(b.machine)).map((rig): RigRow => {
    const seats = rig.seats.filter(s => s.state !== 'stopped').map(s => seatSession(s, rig, byId));
    return { key: rigKey(rig), rig, place: rigPlace(rig, projects), seats, working: workingCount(rig),
      waiting: seats.filter(s => s.state === 'waiting_permission' || s.state === 'waiting_input').length, remote: rig.machine !== 'local' };
  });
  const machines = new Set<string>();
  const kernels: KernelRow[] = [];
  for (const rig of rigs) {
    if (!rig.kernel || machines.has(rig.machine)) continue;
    machines.add(rig.machine);
    const { shown, hidden } = kernelSplit({ ...rig, seats: rig.seats.filter(x => x.state !== 'stopped') });
    kernels.push({ key: rigKey(rig), rig, shown: shown.map(s => seatSession(s, rig, byId)), hiddenCount: hidden.length });
  }
  kernels.sort((a, b) => Number(b.rig.machine === 'local') - Number(a.rig.machine === 'local') || a.rig.machine.localeCompare(b.rig.machine));
  return { rigs: rows, kernels };
}

/** The line Ledge has in the sidebar: what waits for the user, else what Ledge last said, else calm. */
export interface LedgeLine {
  preview: { kind: 'decision'; count: number; rig?: string } | { kind: 'grace'; rig?: string } | { kind: 'said'; text: string } | { kind: 'calm'; rigs: number };
  at?: string;
  unread: number;
}

export function ledgeLine(escalations: readonly Escalation[], rigs: readonly Rig[], said?: { text: string; at: string }): LedgeLine {
  const open = escalations.filter(e => e.intent === 'decision' && (e.state === 'pending' || e.state === 'grace'))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const rigOf = (e: Escalation | undefined): { rig?: string } => {
    const name = e?.rigId ? rigs.find(r => r.machine === e.machine && r.id === e.rigId)?.name : undefined;
    return name ? { rig: name } : {};
  };
  const pending = open.filter(e => e.state === 'pending');
  if (pending.length) return { preview: { kind: 'decision', count: pending.length, ...rigOf(pending[0]) }, at: pending[0]!.createdAt, unread: open.length };
  const grace = open[0];
  if (grace) return { preview: { kind: 'grace', ...rigOf(grace) }, at: grace.createdAt, unread: open.length };
  if (said) return { preview: { kind: 'said', text: said.text }, at: said.at, unread: 0 };
  return { preview: { kind: 'calm', rigs: rigs.filter(r => !r.kernel).length }, unread: 0 };
}
