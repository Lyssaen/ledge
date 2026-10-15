import { useCallback, useEffect, useRef, useState } from 'react';
import type { Fleet, MachineState } from '@ledge/fleet';
import { SEMVER, type UpdateFailure } from '@ledge/protocol';
import { compareVersions } from '@ledge/ui/semver';
import type { UpdateSnapshot } from './store';

export type DaemonOffer = 'none' | 'offer' | 'manual';
/** What About offers for the local daemon (decision 2): nothing when it is up to date or unknown; the button for an npm
 *  service behind the target; its manual command otherwise (git checkout, no systemd: the daemon would refuse). */
export function daemonOffer(local: MachineState | undefined, target: string | null): DaemonOffer {
  const d = local?.daemon;
  if (!d || !target || !SEMVER.test(target) || compareVersions(d.version, target) >= 0) return 'none';
  return d.install === 'npm' && d.systemd ? 'offer' : 'manual';
}
/** The daemon follows Desktop: the release on offer, else the running app (the same lockstep version, spec §11). */
export const daemonTarget = (s: UpdateSnapshot): string | null => (s.phase.kind === 'available' ? s.phase.version : s.latest ?? s.app);

export type DaemonStep =
  | { kind: 'sent'; version: string } | { kind: 'installing' } | { kind: 'restarting' } | { kind: 'done'; version: string }
  | { kind: 'failed'; reason: UpdateFailure | 'offline' | 'timeout'; detail?: string; command?: string };
export interface DaemonUpdate { offer: DaemonOffer; journal: DaemonStep[]; running: boolean; start(): void }
/** Longer than the daemon's own 3-minute npm timeout (as the island's watchdog). */
export const DAEMON_STALL_MS = 4 * 60_000;

/** The local daemon's update and its journal (spec §9.4, §11: `update.daemon` to the local daemon only). Done when the
 *  local daemon is back, open, with at least the version sent. */
export function useDaemonUpdate(fleet: Pick<Fleet, 'sendTo' | 'onMachineMessage'>, machines: readonly MachineState[], target: string | null, stallMs = DAEMON_STALL_MS): DaemonUpdate {
  const [journal, setJournal] = useState<DaemonStep[]>([]);
  const sentVersion = useRef<string | null>(null);
  const add = useCallback((s: DaemonStep) => {
    if (s.kind === 'done' || s.kind === 'failed') sentVersion.current = null;
    setJournal(j => [...j, s]);
  }, []);
  const running = sentVersion.current !== null;
  const local = machines.find(m => m.id === 'local');

  useEffect(() => fleet.onMachineMessage((machine, m) => {
    if (machine !== 'local' || sentVersion.current === null) return;
    if (m.type === 'update.progress') add({ kind: m.step });
    if (m.type === 'update.failed') add({ kind: 'failed', reason: m.reason, ...(m.detail ? { detail: m.detail } : {}), ...(m.command ? { command: m.command } : {}) });
  }), [fleet, add]);

  const localVersion = local?.status === 'open' && local.ready ? local.daemon?.version ?? null : null;
  useEffect(() => {
    const v = sentVersion.current;
    if (v && localVersion && compareVersions(localVersion, v) >= 0) add({ kind: 'done', version: localVersion });
  }, [localVersion, add]);

  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => { if (sentVersion.current !== null) add({ kind: 'failed', reason: 'timeout' }); }, stallMs);
    return () => clearTimeout(t);
  }, [running, stallMs, add]);

  const start = useCallback(() => {
    if (sentVersion.current !== null || !target) return;
    if (!fleet.sendTo('local', { type: 'update.daemon', version: target })) { setJournal(j => [...j, { kind: 'failed', reason: 'offline' }]); return; }
    sentVersion.current = target;
    setJournal(j => [...j, { kind: 'sent', version: target }]);
  }, [fleet, target]);

  return { offer: daemonOffer(local, target), journal, running, start };
}
