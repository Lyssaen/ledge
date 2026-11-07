import { useSyncExternalStore } from 'react';
import type { DaemonClient } from '@ledge/fleet';

export interface RigOutputEntry { /** Counted by the log: a stable key. */ seq: number; at: number; machine: string; commands: readonly string[]; ok: boolean; result: string | null }
export const RIG_OUTPUT_MAX = 200;

const lastLine = (output: string | undefined): string | null => {
  const lines = (output ?? '').split('\n').map(l => l.trim()).filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1]! : null;
};

/**
 * The `rig` commands this Desktop ran and how they ended, since it opened (the bottom panel's Output): the end of each OpenRig
 * action, from any machine. An answer with no command, and the local cancellation `useOpenRig` makes up, are not logged.
 */
export function createRigOutput(client: Pick<DaemonClient, 'onMessage'>, now: () => number = Date.now) {
  let seq = 0;
  let entries: readonly RigOutputEntry[] = [];
  const subs = new Set<() => void>();
  const off = client.onMessage(m => {
    if (m.type !== 'openrig.done' && m.type !== 'openrig.launched' && m.type !== 'openrig.reseated') return;
    if (m.commands.length === 0 || m.error === 'cancelled') return;
    const entry: RigOutputEntry = { seq: seq++, at: now(), machine: m.machineId ?? 'local', commands: m.commands, ok: m.ok, result: m.ok ? lastLine(m.output) : (m.error ?? null) };
    entries = [...entries, entry].slice(-RIG_OUTPUT_MAX);
    subs.forEach(fn => fn());
  });
  return {
    entries: (): readonly RigOutputEntry[] => entries,
    subscribe(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn); }; },
    dispose(): void { off(); subs.clear(); }
  };
}
export type RigOutput = ReturnType<typeof createRigOutput>;

export function useRigOutput(log: RigOutput): readonly RigOutputEntry[] {
  return useSyncExternalStore(log.subscribe, log.entries);
}
