import { PROJECT_COLORS, type Projects, type ProjectColor, type Rig, type RigSeat, type SeatState, type Session } from '@ledge/protocol';

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
 * `lastActivityAt` the epoch (the seat has no start time), `machineId` the rig's machine.
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
