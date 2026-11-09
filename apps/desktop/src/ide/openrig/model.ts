import { KERNEL_RIG, roleOf, seatsByRole, type HumanAsk, type OpenRigState, type Rig, type Session } from '@ledge/protocol';
import { isRunning, kernelRig, listedRigs } from '../../openrig/model';
import type { OpenRigSection } from '../../nav/state';
import type { RigOutputEntry } from '../../openrig/rigOutput';
import { seatLine, type SeatLine } from '../rigs/model';

/** The OpenRig page (docs/mockups/ledge-ide-rigs.html `orPageB`) as pure functions: the rail's numbers, the overview's tiles. */

/** The rail's numbers: Rigs counts the kernel's rig too; a number not known yet (no state, roles unread) is left out. */
export function navCounts(state: OpenRigState | null, roles: number | null, machines: number, output: number): Partial<Record<OpenRigSection, number>> {
  return { ...(state ? { rigs: state.rigs.length } : {}), ...(roles !== null ? { roles } : {}), machines, output };
}

export interface Tiles {
  daemon: { up: boolean; version?: string; since?: string };
  kernel: { up: boolean; seats: number; roles: string[] };
  rigs: { running: number; total: number };
  seats: { active: number; waiting: number };
}

const running = (state: OpenRigState): Rig[] => (state.daemon.state === 'running' ? state.rigs.filter(isRunning) : []);

/** The seats that wait for the person (a permission or a question), over every running rig, the kernel's included. */
export function waitingSeats(state: OpenRigState, sessions: readonly Session[], asks: readonly HumanAsk[], machine: string): Array<{ rig: string; seat: SeatLine; kind: 'perm' | 'ask' }> {
  return running(state).flatMap(r => r.nodes.flatMap(n => {
    const seat = seatLine(n, machine, sessions, asks);
    return seat.dot === 'perm' || seat.dot === 'ask' ? [{ rig: r.name, seat, kind: seat.dot }] : [];
  }));
}

export function tilesOf(state: OpenRigState, sessions: readonly Session[], asks: readonly HumanAsk[], machine: string, lang: 'fr' | 'en'): Tiles {
  const up = state.daemon.state === 'running';
  const started = up && state.daemon.startedAt ? new Date(state.daemon.startedAt) : null;
  const since = started && !Number.isNaN(started.getTime()) ? started.toLocaleTimeString(lang === 'fr' ? 'fr-FR' : 'en-GB', { hour: '2-digit', minute: '2-digit' }) : undefined;
  const k = up ? kernelRig(state) : undefined;
  const kernelUp = !!k && isRunning(k);
  const listed = listedRigs(state);
  const active = running(state).flatMap(r => r.nodes.map(n => seatLine(n, machine, sessions, asks))).filter(s => s.dot !== 'off').length;
  return {
    daemon: { up, ...(state.version ? { version: state.version } : {}), ...(since ? { since } : {}) },
    kernel: { up: kernelUp, seats: kernelUp ? k.nodes.length : 0, roles: kernelUp ? [...new Set(k.nodes.map(n => roleLabel(KERNEL_RIG, n.logicalId)))].sort() : [] },
    rigs: { running: up ? listed.filter(isRunning).length : 0, total: listed.length },
    seats: { active, waiting: waitingSeats(state, sessions, asks, machine).length }
  };
}

/** The last `n` commands run on a machine, the latest last. */
export const recentCommands = (entries: readonly RigOutputEntry[], machine: string, n = 5): RigOutputEntry[] =>
  entries.filter(e => e.machine === machine).slice(-n);

/** A seat's role as the page writes it, without its copy number: the member for a rig (`dev.build-2` → `build`), the pod for the
 *  kernel, whose members are all `lead`, `agent` or `worker` (`advisor.lead` → `advisor`). */
export function roleLabel(rig: string, logicalId: string): string {
  const [pod, member] = roleOf(logicalId).split('.') as [string, string | undefined];
  return rig === KERNEL_RIG || member === undefined ? pod : member;
}

/** A rig's roles as chips: `build ×2`, `review` (`roleLabel`). */
export function roleChips(rig: Rig): Array<{ role: string; runtime: string; count: number }> {
  return [...seatsByRole(rig.nodes)].map(([, ids]) => ({
    role: roleLabel(rig.name, ids[0]!), runtime: rig.nodes.find(n => n.logicalId === ids[0])?.runtime ?? '', count: ids.length
  }));
}
