import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { KERNEL_RIG, type HumanAsk, type OpenRigAction, type OpenRigState, type Session } from '@ledge/protocol';
import { isWorking } from '../../openrig/model';
import { isAskSeat } from '../../asks/model';
import { seatDot } from '../rigs/model';
import { isRecord, readJson, writeJson } from '../../state/storage';
import { PERM_LEVELS, type PermLevel } from '../rig/model';

/** Ledge's own preferences for OpenRig's daemon, per machine: what the IDE's start, restart and stop send, and when it asks first. */
export interface DaemonPrefs {
  /** Start and restart bring back the rigs that were running (`rig start --last`). */
  relaunch: boolean;
  /** A start that brings nothing back leaves the kernel out (`--no-kernel`). */
  noKernel: boolean;
  /** The permission level a launch starts with (`spec`: the spec's own). */
  perm: PermLevel;
  /** A rig takes a snapshot before it stops. */
  snapshotBeforeStop: boolean;
  /** A stop or restart always asks; unticked, it asks only when a seat is working. */
  askAlways: boolean;
}

export const DAEMON_PREFS_DEFAULT: DaemonPrefs = { relaunch: true, noKernel: false, perm: 'spec', snapshotBeforeStop: true, askAlways: true };

const KEY = 'ledge.ide.daemonPrefs';
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

const patchOf = (v: unknown): Partial<DaemonPrefs> => {
  if (!isRecord(v)) return {};
  const p: Partial<DaemonPrefs> = {};
  if (typeof v.relaunch === 'boolean') p.relaunch = v.relaunch;
  if (typeof v.noKernel === 'boolean') p.noKernel = v.noKernel;
  if (typeof v.perm === 'string' && (PERM_LEVELS as readonly string[]).includes(v.perm)) p.perm = v.perm as PermLevel;
  if (typeof v.snapshotBeforeStop === 'boolean') p.snapshotBeforeStop = v.snapshotBeforeStop;
  if (typeof v.askAlways === 'boolean') p.askAlways = v.askAlways;
  return p;
};

/** A machine's preferences: what is stored and valid, the defaults for the rest (a corrupt or unreadable store gives all the defaults). */
export function loadDaemonPrefs(machine: string): DaemonPrefs {
  const all = readJson(KEY);
  return { ...DAEMON_PREFS_DEFAULT, ...(isRecord(all) && Object.hasOwn(all, machine) ? patchOf(all[machine]) : {}) };
}

export function saveDaemonPrefs(machine: string, patch: Partial<DaemonPrefs>): void {
  const all = readJson(KEY);
  const next: Record<string, unknown> = isRecord(all) ? { ...all } : {};
  next[machine] = { ...loadDaemonPrefs(machine), ...patchOf(patch) };
  writeJson(KEY, next);
  listeners.forEach(l => l());
}

/** A machine's preferences, shared: every screen re-renders when one changes them. */
export function useDaemonPrefs(machine: string): [DaemonPrefs, (patch: Partial<DaemonPrefs>) => void] {
  const raw = useSyncExternalStore(subscribe, () => JSON.stringify(loadDaemonPrefs(machine)));
  const prefs = useMemo(() => JSON.parse(raw) as DaemonPrefs, [raw]);
  const save = useCallback((patch: Partial<DaemonPrefs>) => saveDaemonPrefs(machine, patch), [machine]);
  return [prefs, save];
}

/** What a power button is about. Tagged, so a rig named `daemon` or `kernel` is never taken for the daemon or the kernel. */
export type PowerTarget = { kind: 'daemon' } | { kind: 'kernel' } | { kind: 'rig'; name: string };

export const DAEMON: PowerTarget = { kind: 'daemon' };

/** Whether an action is about this target (the daemon's, the kernel's, or that rig's). */
export const isAbout = (a: OpenRigAction, t: PowerTarget): boolean =>
  t.kind === 'daemon' ? a.kind.startsWith('daemon.') : t.kind === 'kernel' ? a.kind.startsWith('kernel.') : a.kind.startsWith('rig.') && (a as { rig: string }).rig === t.name;

/** The action a button sends, with the machine's preferences applied (R9). */
export function prefAction(target: PowerTarget, verb: 'start' | 'restart' | 'stop', p: DaemonPrefs): OpenRigAction {
  const restore = p.relaunch ? 'last' as const : 'none' as const;
  if (target.kind === 'daemon') {
    if (verb === 'start') return { kind: 'daemon.start', restore, ...(p.noKernel && !p.relaunch ? { noKernel: true } : {}) };
    if (verb === 'restart') return { kind: 'daemon.restart', restore };
    return { kind: 'daemon.stop' };
  }
  if (target.kind === 'kernel') return { kind: `kernel.${verb}` };
  if (verb === 'stop') return { kind: 'rig.stop', rig: target.name, ...(p.snapshotBeforeStop ? { snapshot: true } : {}) };
  return { kind: `rig.${verb}`, rig: target.name };
}

/** What Ledge itself sees of the seats: its sessions and the asks they raised. OpenRig's polled activity can be 5 to 15 s behind it. */
export interface LiveSeats { sessions: readonly Session[]; asks: readonly HumanAsk[]; machine: string }

/** Whether an action asks first: never a start; always when `askAlways`; else when a seat of its targets is working in OpenRig's eyes
 *  or in Ledge's (`live`: a session working, waiting on a permission or an ask, as the screens draw it). */
export function needsConfirm(action: OpenRigAction, state: OpenRigState, p: DaemonPrefs, live?: LiveSeats): boolean {
  if (action.kind.endsWith('.start')) return false;
  if (p.askAlways) return true;
  const rigs = action.kind.startsWith('daemon.') ? state.rigs
    : action.kind.startsWith('kernel.') ? state.rigs.filter(r => r.name === KERNEL_RIG)
    : state.rigs.filter(r => r.name === (action as { rig: string }).rig);
  return rigs.some(r => r.nodes.some(n => {
    const session = live?.sessions.find(s => isAskSeat(s, n.session, live.machine));
    const dot = seatDot(session, n, live?.asks ?? [], live?.machine);
    return isWorking(n) || dot === 'work' || dot === 'perm' || dot === 'ask';
  }));
}
