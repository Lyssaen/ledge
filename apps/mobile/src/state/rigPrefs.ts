// The two start choices of OpenRig's daemon (m4-rigs.html, §2 and §8, Q45): « relancer les rigs qui tournaient » and « Démarrer sans le
// kernel ». The PC does not keep them: Desktop keeps its own (apps/desktop/src/ide/openrig/prefs.ts), and this phone keeps its own here.
import { useSyncExternalStore } from 'react';
import type { OpenRigAction } from '@ledge/protocol';
import { localStore } from './storage';

export interface DaemonPrefs {
  /** A start or a restart brings back the rigs that were running (`restore: 'last'`). */
  relaunch: boolean;
  /** A start that brings nothing back leaves the kernel out (`noKernel`). */
  noKernel: boolean;
}

export const DAEMON_PREFS_DEFAULT: DaemonPrefs = { relaunch: true, noKernel: false };
export const DAEMON_PREFS_KEY = 'ledge.mobile.daemonPrefs';

const listeners = new Set<() => void>();

export function loadDaemonPrefs(storage?: Storage): DaemonPrefs {
  try {
    const v = JSON.parse(localStore(storage)?.getItem(DAEMON_PREFS_KEY) ?? '{}') as Partial<Record<keyof DaemonPrefs, unknown>>;
    return {
      relaunch: typeof v.relaunch === 'boolean' ? v.relaunch : DAEMON_PREFS_DEFAULT.relaunch,
      noKernel: typeof v.noKernel === 'boolean' ? v.noKernel : DAEMON_PREFS_DEFAULT.noKernel
    };
  } catch { return DAEMON_PREFS_DEFAULT; }
}

export function saveDaemonPrefs(patch: Partial<DaemonPrefs>, storage?: Storage): void {
  try { localStore(storage)?.setItem(DAEMON_PREFS_KEY, JSON.stringify({ ...loadDaemonPrefs(storage), ...patch })); } catch { /* kept for this page only */ }
  for (const fn of [...listeners]) fn();
}

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

export function useDaemonPrefs(storage?: Storage): [DaemonPrefs, (patch: Partial<DaemonPrefs>) => void] {
  const raw = useSyncExternalStore(subscribe, () => JSON.stringify(loadDaemonPrefs(storage)));
  return [JSON.parse(raw) as DaemonPrefs, (patch) => saveDaemonPrefs(patch, storage)];
}

/** The daemon's start or restart with this phone's choices, as Desktop sends them. */
export function daemonAction(verb: 'start' | 'restart', p: DaemonPrefs): OpenRigAction {
  const restore = p.relaunch ? 'last' as const : 'none' as const;
  if (verb === 'restart') return { kind: 'daemon.restart', restore };
  return { kind: 'daemon.start', restore, ...(p.noKernel && !p.relaunch ? { noKernel: true } : {}) };
}
