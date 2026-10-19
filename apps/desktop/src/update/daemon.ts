import { useCallback, useEffect, useRef, useState } from 'react';
import type { Fleet, MachineState } from '@ledge/fleet';
import { SEMVER, type UpdateFailure } from '@ledge/protocol';
import { compareVersions } from '@ledge/ui/semver';
import type { UpdateSnapshot } from './store';

export type DaemonOffer = 'none' | 'offer' | 'manual';
/** What About offers for a machine's daemon (decision 2): nothing when it is up to date or unknown; the button for an npm
 *  service behind the target; its manual command otherwise (git checkout, no systemd: the daemon would refuse). */
export function daemonOffer(local: MachineState | undefined, target: string | null): DaemonOffer {
  const d = local?.daemon;
  if (!d || !target || !SEMVER.test(target) || !SEMVER.test(d.version) || compareVersions(d.version, target) >= 0) return 'none';
  return d.install === 'npm' && d.systemd ? 'offer' : 'manual';
}
/** The daemon follows Desktop: the release on offer, else the running app (the same lockstep version, spec §11). */
export const daemonTarget = (s: UpdateSnapshot): string | null => (s.phase.kind === 'available' ? s.phase.version : s.latest ?? s.app);

export type DaemonStep =
  | { kind: 'sent'; version: string; auto?: true } | { kind: 'installing' } | { kind: 'restarting' } | { kind: 'done'; version: string }
  | { kind: 'failed'; reason: UpdateFailure | 'offline' | 'timeout'; detail?: string; command?: string };
/** One machine's daemon update: what About offers for it, its journal, whether it runs. */
export interface MachineDaemonUpdate { offer: DaemonOffer; journal: readonly DaemonStep[]; running: boolean }
export interface DaemonUpdates {
  of(machine: string): MachineDaemonUpdate;
  /** The machines whose update runs: their daemon's restart is expected, no « offline » alert for them. */
  updating: ReadonlySet<string>;
  start(machine: string): void;
}
/** Longer than the daemon's own 3-minute npm timeout (as the island's watchdog). */
export const DAEMON_STALL_MS = 4 * 60_000;
const NONE: readonly DaemonStep[] = [];

/** Every machine's daemon update and its journal (#48, spec §11): `update.daemon` goes to that machine (`fleet.sendTo`), the WSL's
 *  as a remote's. `start` sends `target` (the version the daemons follow). On its own, a daemon that is connected (open, ready),
 *  installed by npm under systemd and behind `auto` (the version Desktop runs, null outside the app) is sent `auto` once per
 *  version and per run of the app: a refusal is not retried by itself, « Update » still is. A daemon newer than Desktop is left
 *  as it is. An update is done when its machine is back, open, with at least the version sent; a silent one fails after `stallMs`. */
export function useDaemonUpdates(fleet: Pick<Fleet, 'sendTo' | 'onMachineMessage'>, machines: readonly MachineState[], target: string | null, auto: string | null, stallMs = DAEMON_STALL_MS): DaemonUpdates {
  const [journals, setJournals] = useState<ReadonlyMap<string, readonly DaemonStep[]>>(new Map());
  // The version sent to each machine whose update runs, its stall timer, and the automatic attempts already made (`id@version`).
  const sent = useRef(new Map<string, string>());
  const stalls = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const tried = useRef(new Set<string>());
  const [updating, setUpdating] = useState<ReadonlySet<string>>(new Set());
  const sync = useCallback(() => setUpdating(new Set(sent.current.keys())), []);
  const add = useCallback((machine: string, s: DaemonStep) => {
    if (s.kind === 'done' || s.kind === 'failed') {
      sent.current.delete(machine);
      clearTimeout(stalls.current.get(machine)); stalls.current.delete(machine);
      sync();
    }
    setJournals(j => new Map(j).set(machine, [...(j.get(machine) ?? NONE), s]));
  }, [sync]);
  useEffect(() => () => { for (const t of stalls.current.values()) clearTimeout(t); }, []);

  useEffect(() => fleet.onMachineMessage((machine, m) => {
    if (!sent.current.has(machine)) return;
    if (m.type === 'update.progress') add(machine, { kind: m.step });
    if (m.type === 'update.failed') add(machine, { kind: 'failed', reason: m.reason, ...(m.detail ? { detail: m.detail } : {}), ...(m.command ? { command: m.command } : {}) });
  }), [fleet, add]);

  const send = useCallback((machine: string, version: string, automatic: boolean) => {
    if (sent.current.has(machine)) return;
    if (!fleet.sendTo(machine, { type: 'update.daemon', version })) { add(machine, { kind: 'failed', reason: 'offline' }); return; }
    sent.current.set(machine, version);
    stalls.current.set(machine, setTimeout(() => { if (sent.current.has(machine)) add(machine, { kind: 'failed', reason: 'timeout' }); }, stallMs));
    sync();
    setJournals(j => new Map(j).set(machine, [...(j.get(machine) ?? NONE), { kind: 'sent', version, ...(automatic ? { auto: true as const } : {}) }]));
  }, [fleet, add, sync, stallMs]);

  // Back, open and ready with the version sent (or newer): done. Then, on its own, each connected daemon behind Desktop.
  const connected = machines.filter(m => m.status === 'open' && m.ready);
  const key = connected.map(m => `${m.id}@${m.daemon?.version ?? ''}:${m.daemon?.install ?? ''}:${m.daemon?.systemd ?? ''}`).join('\n');
  useEffect(() => {
    for (const m of connected) {
      const v = sent.current.get(m.id); const now = m.daemon?.version;
      if (v && now && SEMVER.test(now) && compareVersions(now, v) >= 0) add(m.id, { kind: 'done', version: now });
    }
    if (!auto) return;
    for (const m of connected) {
      if (daemonOffer(m, auto) !== 'offer' || sent.current.has(m.id) || tried.current.has(`${m.id}@${auto}`)) continue;
      tried.current.add(`${m.id}@${auto}`);
      send(m.id, auto, true);
    }
    // `key` stands for the connected machines' daemons: a new array of the same machines changes nothing.
  }, [key, auto, add, send]);

  const start = useCallback((machine: string) => { if (target) send(machine, target, false); }, [send, target]);
  const of = useCallback((machine: string): MachineDaemonUpdate => ({
    offer: daemonOffer(machines.find(m => m.id === machine), target),
    journal: journals.get(machine) ?? NONE,
    running: updating.has(machine)
  }), [machines, target, journals, updating]);
  return { of, updating, start };
}
