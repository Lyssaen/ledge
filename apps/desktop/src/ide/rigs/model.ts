import type { HumanAsk, OpenRigAction, OpenRigState, Rig, RigSeat, Session } from '@ledge/protocol';
import type { MachineState } from '@ledge/fleet';
import { isAskSeat } from '../../asks/model';
import { commandsOf, isRunning, kernelRig, listedRigs, workingSeats } from '../../openrig/model';

/** The IDE's Rigs view (docs/mockups/ledge-ide-rigs.html) as pure functions: one machine's rows, the machine menu, a confirmation. */

export type RigDot = 'perm' | 'ask' | 'work' | 'idle' | 'off';
export interface SeatLine { logicalId: string; name: string; dot: RigDot; session?: Session; ctx?: number }
export interface RigLine { name: string; running: boolean; dot: RigDot; count: number; seats: SeatLine[] }
export interface RigsView { status: 'loading' | 'offline' | 'absent' | 'stopped' | 'running'; version?: string; kernel: RigLine | null; rigs: RigLine[] }

/** Worst first. */
const ORDER: readonly RigDot[] = ['perm', 'ask', 'work', 'idle', 'off'];
const worst = (dots: readonly RigDot[]): RigDot => ORDER.find(d => dots.includes(d)) ?? 'idle';

/** A seat's dot. Joined to a Ledge session: its state (and the asks it has raised). Not joined: what OpenRig says of the seat (`activity` running → work, `stopped` → off). */
export function seatDot(session: Session | undefined, node: { activity: string; stopped?: boolean }, asks: readonly HumanAsk[] = [], machine?: string): RigDot {
  if (!session) return node.activity === 'running' ? 'work' : node.stopped ? 'off' : 'idle';
  const asking = asks.some(a => isAskSeat(session, a.from.seat, machine));
  return session.state === 'waiting_permission' || session.state === 'error' ? 'perm'
    : session.state === 'waiting_input' || asking ? 'ask'
    : session.state === 'working' || session.state === 'starting' ? 'work' : 'idle';
}

function seatLine(node: RigSeat, machine: string, sessions: readonly Session[], asks: readonly HumanAsk[]): SeatLine {
  const session = sessions.find(s => isAskSeat(s, node.session, machine));
  const dot = seatDot(session, node, asks, machine);
  if (!session) return { logicalId: node.logicalId, name: node.logicalId, dot };
  return { logicalId: node.logicalId, name: session.name, dot, session, ...(session.context ? { ctx: Math.round(session.context.used / session.context.window * 100) } : {}) };
}

function rigLine(r: Rig, machine: string, sessions: readonly Session[], asks: readonly HumanAsk[]): RigLine {
  if (!isRunning(r)) return { name: r.name, running: false, dot: 'off', count: 0, seats: [] };
  const seats = r.nodes.map(n => seatLine(n, machine, sessions, asks));
  return { name: r.name, running: true, dot: worst(seats.map(s => s.dot)), count: r.nodes.length, seats };
}

export function rigsViewOf(input: { state: OpenRigState | undefined; error?: string; machine: string; sessions: readonly Session[]; asks: readonly HumanAsk[] }): RigsView {
  const { state, error, machine, sessions, asks } = input;
  if (error) return { status: 'offline', kernel: null, rigs: [] };
  if (!state) return { status: 'loading', kernel: null, rigs: [] };
  const version = state.version ? { version: state.version } : {};
  if (!state.installed) return { status: 'absent', ...version, kernel: null, rigs: [] };
  if (state.daemon.state !== 'running') return { status: 'stopped', ...version, kernel: null, rigs: [] };
  const k = kernelRig(state);
  return { status: 'running', ...version, kernel: k ? rigLine(k, machine, sessions, asks) : null, rigs: listedRigs(state).map(r => rigLine(r, machine, sessions, asks)) };
}

export interface MachineEntry { id: string; label: string; kind: 'local' | 'ssh'; status: 'running' | 'stopped' | 'absent' | 'offline' | 'loading'; running: number }

export function machineEntries(machines: readonly MachineState[], states: ReadonlyMap<string, OpenRigState>, errors: ReadonlySet<string>): MachineEntry[] {
  return machines.map(m => {
    const base = { id: m.id, label: m.label, kind: m.ssh ? 'ssh' as const : 'local' as const };
    const st = states.get(m.id);
    if (errors.has(m.id) || !m.ready) return { ...base, status: 'offline', running: 0 };
    if (!st) return { ...base, status: 'loading', running: 0 };
    if (!st.installed) return { ...base, status: 'absent', running: 0 };
    if (st.daemon.state !== 'running') return { ...base, status: 'stopped', running: 0 };
    return { ...base, status: 'running', running: listedRigs(st).filter(isRunning).length };
  });
}

/** The saved machine when it still exists, else this computer. */
export const displayedMachine = (saved: string | null, machines: readonly MachineState[]): string =>
  saved !== null && machines.some(m => m.id === saved) ? saved : 'local';

export const powerOf = (running: boolean): readonly ('start' | 'restart' | 'stop')[] => (running ? ['restart', 'stop'] : ['start']);

export function actionOf(target: 'daemon' | 'kernel' | string, verb: 'start' | 'restart' | 'stop'): OpenRigAction {
  if (target === 'daemon') return { kind: `daemon.${verb}` };
  if (target === 'kernel') return { kind: `kernel.${verb}` };
  return { kind: `rig.${verb}`, rig: target };
}

/** What a stop or restart would interrupt (Ledge session names, else the seat's id) and the commands it runs. */
export function confirmOf(state: OpenRigState, action: OpenRigAction, sessions: readonly Session[], machine: string): { working: string[]; commands: string[]; restart: boolean } {
  const working = workingSeats(state, action).map(({ seat }) => sessions.find(s => isAskSeat(s, seat.session, machine))?.name ?? seat.logicalId);
  return { working, commands: commandsOf(action), restart: action.kind.endsWith('.restart') };
}

/** The Rigs icon's alert: OpenRig is installed but its daemon is not running. */
export const rigsAlert = (state: OpenRigState | undefined): boolean => !!state && state.installed && state.daemon.state !== 'running';
