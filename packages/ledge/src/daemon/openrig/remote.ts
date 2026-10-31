import WebSocket from 'ws';
import type { ClientMessage, Machine, Machines, ServerMessage } from '@ledge/protocol';
import { createDaemonClient, type DaemonClient, type DaemonStatus } from '@ledge/fleet/client';
import { createTokenSource, type TokenRead } from '@ledge/fleet/token';
import { readDaemonToken } from '../../auth.js';

export type RemoteMessage = Extract<ServerMessage, { type: 'openrig.status' | 'rig.snapshot' | 'rig.updated' | 'rig.removed' | 'rig.exchange' | 'rig.exchanges' | 'escalation.updated' | 'escalation.removed' | 'rig.result' | 'rig.plan' }>;
export type PeerStatus = 'open' | 'connecting' | 'unreachable' | 'unsupported';

export interface RemotePeers {
  /** Adds, keeps or closes the peers (the machines with `ssh`). */
  setMachines(list: Machines): void;
  status(machine: string): PeerStatus;
  /** The Ledge version the peer's daemon gave in its last snapshot (undefined before one, or from a daemon that gives none). */
  version(machine: string): string | undefined;
  /** `machine` already rewritten to 'local' by the caller; false when the peer is not open. */
  send(machine: string, msg: ClientMessage): boolean;
  /** `machine` = the peer's id; the content is already rewritten. */
  onMessage(fn: (machine: string, m: RemoteMessage) => void): () => void;
  onStatus(fn: (machine: string, s: 'open' | 'unreachable' | 'unsupported' | 'removed') => void): () => void;
  close(): void;
}

const mine = (machine: string, x: string): string | null => (x === 'local' ? machine : null);

/** A peer's message with its own `machine: 'local'` turned into the peer's id. A message about another machine is dropped
 *  (two daemons listing each other would echo); one with no machine field is the peer's own. `seat.sessionId` stays unqualified. */
export function rewriteFromPeer(machine: string, m: ServerMessage): RemoteMessage | null {
  switch (m.type) {
    case 'openrig.status': return m.status.machine === 'local' ? { ...m, status: { ...m.status, machine } } : null;
    case 'rig.snapshot': {
      if (m.machine !== 'local') return null;
      const rigs = m.rigs.filter(r => r.machine === 'local').map(r => ({ ...r, machine }));
      return { ...m, machine, rigs };
    }
    case 'rig.updated': return m.rig.machine === 'local' ? { ...m, rig: { ...m.rig, machine } } : null;
    case 'rig.removed': return mine(machine, m.machine) ? { ...m, machine } : null;
    case 'rig.exchange': return m.exchange.machine === 'local' ? { ...m, exchange: { ...m.exchange, machine } } : null;
    case 'rig.exchanges': {
      if (m.machine !== 'local') return null;
      return { ...m, machine, items: m.items.filter(e => e.machine === 'local').map(e => ({ ...e, machine })) };
    }
    case 'escalation.updated': return m.escalation.machine === 'local' ? { ...m, escalation: { ...m.escalation, machine } } : null;
    case 'escalation.removed': case 'rig.result': return m;
    case 'rig.plan': return m.plan.machine === 'local' ? { ...m, plan: { ...m.plan, machine } } : null;
    default: return null;
  }
}

async function readToken(): Promise<TokenRead> {
  try { const token = readDaemonToken(); return token ? { kind: 'token', token } : { kind: 'absent' }; }
  catch { return { kind: 'unavailable' }; }
}

interface Peer { machine: Machine; client: DaemonClient; status: PeerStatus; version?: string; off: Array<() => void> }

/** `port` may be a function: the server creates its peers after it listens. Peers dial the local daemon's own `/ssh/<alias>`. */
export function createRemotePeers(opts: { port: number | (() => number); connect?: (machine: Machine, url: string) => DaemonClient; labelOf?: (id: string) => string }): RemotePeers {
  const token = createTokenSource(readToken);
  const connect = opts.connect ?? ((_m: Machine, url: string) => createDaemonClient({ url, WebSocketImpl: WebSocket as never, token }));
  const peers = new Map<string, Peer>();
  const msgFns = new Set<(machine: string, m: RemoteMessage) => void>(), stFns = new Set<(machine: string, s: 'open' | 'unreachable' | 'unsupported' | 'removed') => void>();
  const emitStatus = (id: string, s: 'open' | 'unreachable' | 'unsupported' | 'removed') => stFns.forEach(f => f(id, s));

  const setStatus = (p: Peer, s: PeerStatus) => {
    if (p.status === s) return;
    p.status = s;
    if (s !== 'connecting') emitStatus(p.machine.id, s);
  };
  function start(machine: Machine) {
    const port = typeof opts.port === 'function' ? opts.port() : opts.port;
    const client = connect(machine, `ws://127.0.0.1:${port}/ssh/${machine.ssh}`);
    const p: Peer = { machine, client, status: 'connecting', off: [] };
    p.off.push(client.onStatus((s: DaemonStatus) => {
      // `open` is only the socket: the peer is open at its snapshot, which says whether it knows OpenRig.
      if (s === 'unreachable') setStatus(p, 'unreachable');
      else if (s === 'connecting' && p.status !== 'connecting') p.status = 'connecting';
    }));
    p.off.push(client.onMessage(m => {
      if (peers.get(machine.id) !== p) return;
      if (m.type === 'snapshot') { p.version = m.daemon?.version; setStatus(p, m.daemon?.openrig ? 'open' : 'unsupported'); return; }
      if (p.status !== 'open') return;
      const out = rewriteFromPeer(machine.id, m);
      if (out) msgFns.forEach(f => f(machine.id, out));
    }));
    peers.set(machine.id, p);
    client.connect();
  }
  function drop(p: Peer) { p.off.forEach(f => f()); peers.delete(p.machine.id); p.client.close(); emitStatus(p.machine.id, 'removed'); }

  return {
    setMachines(list) {
      const wanted = new Map(list.filter(m => m.ssh && m.id !== 'local').map(m => [m.id, m]));
      for (const p of [...peers.values()]) { const w = wanted.get(p.machine.id); if (!w || w.ssh !== p.machine.ssh) drop(p); }
      for (const m of wanted.values()) if (!peers.has(m.id)) start(m);
    },
    status: machine => peers.get(machine)?.status ?? 'unreachable',
    version: machine => peers.get(machine)?.version,
    send(machine, msg) {
      const p = peers.get(machine);
      if (!p || p.status !== 'open' || p.client.status() !== 'open') return false;
      p.client.send(msg);
      return true;
    },
    onMessage(fn) { msgFns.add(fn); return () => { msgFns.delete(fn); }; },
    onStatus(fn) { stFns.add(fn); return () => { stFns.delete(fn); }; },
    close() { for (const p of peers.values()) { p.off.forEach(f => f()); p.client.close(); } peers.clear(); }
  };
}
