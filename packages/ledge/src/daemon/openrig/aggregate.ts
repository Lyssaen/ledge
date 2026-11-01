import { type Escalation, type Exchange, type Machines, type OpenRigStatus, type Projects, type Rig } from '@ledge/protocol';
import { log } from '../../log.js';
import { rigProjectId } from './adopt.js';
import type { Bridge, BridgeMessage } from './bridge.js';
import type { RemoteMessage, RemotePeers } from './remote.js';

/** The local bridge and the remote peers as one view: everything that leaves it carries the real machine ('local' or a machines.json id). */
export interface RigAggregate {
  /** One openrig.status per machine (remote ones included), one rig.snapshot per machine, then the escalations. */
  replay(): BridgeMessage[];
  onMessage(fn: (m: BridgeMessage) => void): () => void;
  rigs(): Rig[]; escalations(): Escalation[]; statuses(): OpenRigStatus[];
  escalation(id: string): Escalation | undefined;
  /** True after an id has been observed on more than one machine. */
  escalationAmbiguous(id: string): boolean;
  /** Remote: the last `rig.exchanges` the peer sent for that rig (null before any); local: the bridge's log. */
  exchanges(machine: string, rigId: string): Exchange[] | null;
  /** Lays a local state (an answer waiting in the queue, lot 6 Task 6) over a remote escalation, broadcast again; null takes it off. */
  overlay(id: string, patch: Partial<Escalation> | null): void;
  /** The projects changed: a rig.snapshot again for each remote machine, its rigs filed in the projects as they are now. */
  refresh(): void;
}

interface Resync { seen: Set<string>; snapshot: boolean; timer: NodeJS.Timeout | null }
interface Remote { status: OpenRigStatus | null; rigs: Map<string, Rig>; escs: Map<string, Escalation>; exchanges: Map<string, Exchange[]>; resync: Resync | null }

/** How long after the last message of a peer's replay its escalation resync ends when nothing else follows it. */
const SETTLE_MS = 1000;

/**
 * A peer's daemon replays its status, its rig.snapshot then every escalation after each `snapshot` (bridge.replay), and
 * nothing of OpenRig after them. So the escalations it no longer has are those missing from that burst: the burst ends at
 * the peer's first message that is not an escalation after its rig.snapshot, or `settleMs` after its last message. The timer
 * starts only at that rig.snapshot (an open peer knows OpenRig, so it always replays one): the frames before it (machines,
 * projects, chat history…) may be slow over SSH. A live rig.snapshot (the peer's OpenRig reconnecting) is not followed by the
 * escalations, so only a peer `open` starts a resync. Overlays are never dropped here: the answer queue (Task 6) owns them.
 */
export function createRigAggregate(opts: { bridge: Bridge; remote: RemotePeers; machines: () => Machines; projects: () => Projects; settleMs?: number }): RigAggregate {
  const { bridge, remote } = opts; const settleMs = opts.settleMs ?? SETTLE_MS;
  const peers = new Map<string, Remote>();
  /** Which peer owns each remote escalation id (escalation.removed has no machine). Ids are OpenRig's: a clash between machines is not expected. */
  const owner = new Map<string, string>();
  // Remote collision handling keeps only one owner; retain the ambiguity so clients never route an unsafe id.
  const collisions = new Set<string>();
  const observedOrigins = new Map<string, string>();
  const observeOrigin = (id: string, machine: string) => {
    const previous = observedOrigins.get(id);
    if (previous !== undefined && previous !== machine) collisions.add(id);
    else if (previous === undefined) observedOrigins.set(id, machine);
  };
  for (const escalation of bridge.escalations()) observeOrigin(escalation.id, escalation.machine);
  const overlays = new Map<string, Partial<Escalation>>();
  const listeners = new Set<(m: BridgeMessage) => void>();
  const emit = (m: BridgeMessage) => { for (const fn of listeners) { try { fn(m); } catch (e) { log(`openrig: aggregate listener threw: ${(e as Error).message}`); } } };

  const peer = (machine: string): Remote => {
    let p = peers.get(machine);
    if (!p) peers.set(machine, p = { status: null, rigs: new Map(), escs: new Map(), exchanges: new Map(), resync: null });
    return p;
  };
  const order = (): string[] => {
    const ids = opts.machines().map(m => m.id);
    return [...peers.keys()].sort((a, b) => (ids.indexOf(a) + 1 || Infinity) - (ids.indexOf(b) + 1 || Infinity));
  };
  const labelOf = (machine: string) => opts.machines().find(m => m.id === machine)?.label ?? machine;
  /** The projects live on this machine: a remote rig's project is computed here, as the mirror does for a local one — the
   *  project that lists its id, else the one whose repository holds its folder on its machine. A project's `rigs` are bare
   *  rig ids (no machine): a rig id is OpenRig's, unique per machine only, so a clash between machines would file both. */
  const filed = (machine: string, rig: Rig): Rig => ({ ...rig, projectId: rigProjectId({ id: rig.id, cwd: rig.cwd, machine }, opts.projects()) });
  const over = (e: Escalation): Escalation => { const o = overlays.get(e.id); return o ? { ...e, ...o } : e; };
  const remoteEsc = (id: string): Escalation | undefined => { const m = owner.get(id); return m ? peers.get(m)?.escs.get(id) : undefined; };

  const dropEscalation = (p: Remote, id: string) => { p.escs.delete(id); owner.delete(id); emit({ type: 'escalation.removed', id }); };
  const stopResync = (p: Remote) => { if (p.resync?.timer) clearTimeout(p.resync.timer); p.resync = null; };
  const finishResync = (p: Remote) => {
    const r = p.resync; if (!r) return; stopResync(p);
    for (const id of [...p.escs.keys()]) if (!r.seen.has(id)) dropEscalation(p, id);
  };
  const arm = (p: Remote) => {
    const r = p.resync; if (!r) return;
    if (r.timer) clearTimeout(r.timer);
    r.timer = setTimeout(() => { if (p.resync === r) finishResync(p); }, settleMs); r.timer.unref();
  };
  /** Kept as they are, marked unreachable: they wait over there (spec §4.8). */
  const markUnreachable = (p: Remote, status: OpenRigStatus) => {
    stopResync(p);
    p.status = status; emit({ type: 'openrig.status', status });
    for (const [id, rig] of p.rigs) {
      if (rig.lifecycle === 'unreachable') continue;
      const next = { ...rig, lifecycle: 'unreachable' as const }; p.rigs.set(id, next); emit({ type: 'rig.updated', rig: next });
    }
  };

  bridge.onMessage(m => {
    if (m.type === 'escalation.updated') { observeOrigin(m.escalation.id, m.escalation.machine); if (owner.has(m.escalation.id)) collisions.add(m.escalation.id); }
    emit(m.type === 'escalation.updated' ? { ...m, escalation: over(m.escalation) } : m);
  });

  remote.onStatus((machine, s) => {
    if (s === 'removed') {
      const p = peers.get(machine); if (!p) return;
      stopResync(p); peers.delete(machine);
      for (const rigId of p.rigs.keys()) emit({ type: 'rig.removed', machine, rigId });
      for (const id of [...p.escs.keys()]) dropEscalation(p, id);
      return;
    }
    const p = peer(machine);
    if (s === 'open') { stopResync(p); p.resync = { seen: new Set(), snapshot: false, timer: null }; return; }
    if (s === 'unreachable') return markUnreachable(p, { machine, state: 'unreachable' });
    const v = remote.version(machine);
    markUnreachable(p, { machine, state: 'unsupported', detail: `Ledge ${v ? `${v} ` : ''}sur ${labelOf(machine)} ne connaît pas OpenRig : mets-le à jour` });
  });

  remote.onMessage((machine, m: RemoteMessage) => {
    const p = peer(machine); const r = p.resync;
    if (r) {
      if (m.type === 'escalation.updated') r.seen.add(m.escalation.id);
      if (r.snapshot && m.type !== 'escalation.updated' && m.type !== 'escalation.removed') finishResync(p);
      else { if (m.type === 'rig.snapshot') r.snapshot = true; if (r.snapshot) arm(p); }
    }
    switch (m.type) {
      case 'openrig.status': p.status = m.status; return emit(m);
      case 'rig.snapshot': {
        const rigs = m.rigs.map(rig => filed(machine, rig)); const ids = new Set(rigs.map(rig => rig.id));
        for (const rigId of [...p.rigs.keys()]) if (!ids.has(rigId)) { p.rigs.delete(rigId); p.exchanges.delete(rigId); emit({ type: 'rig.removed', machine, rigId }); }
        p.rigs = new Map(rigs.map(rig => [rig.id, rig]));
        return emit({ type: 'rig.snapshot', machine, rigs });
      }
      case 'rig.updated': { const rig = filed(machine, m.rig); p.rigs.set(rig.id, rig); return emit({ type: 'rig.updated', rig }); }
      case 'rig.removed': p.rigs.delete(m.rigId); p.exchanges.delete(m.rigId); return emit(m);
      case 'rig.exchange': {
        const list = p.exchanges.get(m.exchange.rigId);
        if (list && !list.some(x => x.id === m.exchange.id)) list.push(m.exchange);
        return emit(m);
      }
      case 'rig.exchanges': p.exchanges.set(m.rigId, m.items); return;
      case 'escalation.updated': {
        observeOrigin(m.escalation.id, machine);
        const prev = owner.get(m.escalation.id);
        if ((prev && prev !== machine) || bridge.escalation(m.escalation.id)) collisions.add(m.escalation.id);
        if (prev && prev !== machine) { log(`openrig: escalation ${m.escalation.id} of ${machine} has the id of one of ${prev}: the last one wins`); peers.get(prev)?.escs.delete(m.escalation.id); }
        p.escs.set(m.escalation.id, m.escalation); owner.set(m.escalation.id, machine);
        return emit({ type: 'escalation.updated', escalation: over(m.escalation) });
      }
      case 'escalation.removed': if (owner.get(m.id) === machine) dropEscalation(p, m.id); return;
      default: return; // rig.result, rig.plan: the router's (Task 5)
    }
  });

  const remoteRigs = (machine: string, p: Remote) => [...p.rigs.values()].map(rig => filed(machine, rig));
  const remoteEscs = () => order().flatMap(machine => [...peers.get(machine)!.escs.values()].map(over));

  return {
    replay() {
      const local = bridge.replay();
      const ids = order();
      const statuses = [...local.filter(m => m.type === 'openrig.status'),
        ...ids.flatMap((machine): BridgeMessage[] => { const s = peers.get(machine)!.status; return s ? [{ type: 'openrig.status', status: s }] : []; })];
      const snapshots = [...local.filter(m => m.type === 'rig.snapshot'),
        ...ids.map((machine): BridgeMessage => ({ type: 'rig.snapshot', machine, rigs: remoteRigs(machine, peers.get(machine)!) }))];
      const escs = [...local.flatMap((m): BridgeMessage[] => m.type === 'escalation.updated' ? [{ ...m, escalation: over(m.escalation) }] : []),
        ...remoteEscs().map((escalation): BridgeMessage => ({ type: 'escalation.updated', escalation }))];
      return [...statuses, ...snapshots, ...escs];
    },
    onMessage(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    rigs: () => [...bridge.rigs(), ...order().flatMap(machine => remoteRigs(machine, peers.get(machine)!))],
    escalations: () => [...bridge.escalations().map(over), ...remoteEscs()],
    statuses: () => [bridge.status(), ...order().flatMap(machine => { const s = peers.get(machine)!.status; return s ? [s] : []; })],
    escalation(id) { const e = bridge.escalation(id) ?? remoteEsc(id); return e ? over(e) : undefined; },
    escalationAmbiguous(id) { return collisions.has(id) || (!!bridge.escalation(id) && owner.has(id)) || [...peers.values()].some(p => p.resync !== null); },
    exchanges(machine, rigId) {
      if (machine === 'local') return bridge.exchanges(rigId);
      return peers.get(machine)?.exchanges.get(rigId) ?? null;
    },
    overlay(id, patch) {
      if (patch) overlays.set(id, patch); else if (!overlays.delete(id)) return;
      const e = bridge.escalation(id) ?? remoteEsc(id);
      if (e) emit({ type: 'escalation.updated', escalation: over(e) });
    },
    refresh() {
      for (const machine of order()) {
        const p = peers.get(machine)!;
        const rigs = remoteRigs(machine, p); p.rigs = new Map(rigs.map(rig => [rig.id, rig]));
        emit({ type: 'rig.snapshot', machine, rigs });
      }
    }
  };
}
