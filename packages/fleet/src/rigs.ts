import { EXCHANGES_MAX, type Escalation, type Exchange, type OpenRigStatus, type Rig, type ServerMessage } from '@ledge/protocol';
import { qualify } from './machines';

export type RigMessage = Extract<ServerMessage, { type: 'openrig.status' | 'rig.snapshot' | 'rig.updated' | 'rig.removed' | 'rig.exchange' | 'rig.exchanges' | 'escalation.updated' | 'escalation.removed' }>;
export const isRigMessage = (m: ServerMessage): m is RigMessage => /^(openrig\.status|rig\.(snapshot|updated|removed|exchange|exchanges)|escalation\.(updated|removed))$/.test(m.type);
export interface RigBook {
  /** Applies a peer's message (its `machine` fields rewritten: `'local'` becomes `machine`); true when what is visible changed. */
  apply(machine: string, m: RigMessage): boolean;
  /** The peer sent a snapshot: forgets all it held of `machine` (the rig.snapshot that follows refills it). */
  reset(machine: string): boolean;
  /** The machine fell: its rigs turn 'unreachable' (kept), its escalations stay, its status turns 'unreachable'. */
  dropped(machine: string): void;
  rigs(): Rig[]; escalations(): Escalation[]; statuses(): OpenRigStatus[]; exchanges(machine: string, rigId: string): Exchange[] | null;
}
const SEP = '\0';
export function createRigBook(): RigBook {
  const rigMap = new Map<string, Rig>(), statusMap = new Map<string, OpenRigStatus>(), exchangeMap = new Map<string, Exchange[]>();
  const escMap = new Map<string, { esc: Escalation; from: string }>();
  let rigList: Rig[] = [], escList: Escalation[] = [], statusList: OpenRigStatus[] = [];
  const key = (machine: string, id: string) => `${machine}${SEP}${id}`;
  const publish = () => { rigList = [...rigMap.values()]; escList = [...escMap.values()].map(e => e.esc); statusList = [...statusMap.values()]; };
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const fixRig = (machine: string, r: Rig): Rig => { const mine = r.machine === 'local' ? machine : r.machine; return { ...r, machine: mine, seats: r.seats.map(s => (s.sessionId ? { ...s, sessionId: qualify(mine, s.sessionId) } : s)) }; };
  const forgetMachine = (machine: string): boolean => {
    let changed = false;
    for (const [k, r] of rigMap) if (r.machine === machine) { rigMap.delete(k); changed = true; }
    for (const [k, e] of escMap) if (e.from === machine) { escMap.delete(k); changed = true; }
    for (const k of exchangeMap.keys()) if (k.startsWith(machine + SEP)) { exchangeMap.delete(k); changed = true; }
    if (statusMap.delete(machine)) changed = true;
    return changed;
  };
  return {
    apply(machine, m) {
      const mine = (x: string) => (x === 'local' ? machine : x);
      let changed = true;
      if (m.type === 'openrig.status') { const s = { ...m.status, machine: mine(m.status.machine) }; changed = !same(statusMap.get(s.machine), s); statusMap.set(s.machine, s); }
      else if (m.type === 'rig.snapshot') {
        const at = mine(m.machine);
        for (const [k, r] of rigMap) if (r.machine === at) rigMap.delete(k);
        for (const r of m.rigs) { const f = fixRig(at, { ...r, machine: r.machine === 'local' ? at : r.machine }); rigMap.set(key(f.machine, f.id), f); }
      }
      else if (m.type === 'rig.updated') { const f = fixRig(machine, m.rig); const k = key(f.machine, f.id); changed = !same(rigMap.get(k), f); rigMap.set(k, f); }
      else if (m.type === 'rig.removed') { changed = rigMap.delete(key(mine(m.machine), m.rigId)); }
      else if (m.type === 'rig.exchange') {
        const x = { ...m.exchange, machine: mine(m.exchange.machine) }, k = key(x.machine, x.rigId), list = exchangeMap.get(k) ?? [];
        changed = !list.some(e => e.id === x.id); if (changed) exchangeMap.set(k, [...list, x].slice(-EXCHANGES_MAX));
      }
      else if (m.type === 'rig.exchanges') { const at = mine(m.machine); exchangeMap.set(key(at, m.rigId), m.items.map(x => ({ ...x, machine: mine(x.machine) })).slice(-EXCHANGES_MAX)); }
      else if (m.type === 'escalation.updated') { const e = { ...m.escalation, machine: mine(m.escalation.machine) }, k = key(e.machine, e.id); changed = !same(escMap.get(k)?.esc, e); escMap.set(k, { esc: e, from: machine }); }
      else { changed = false; for (const [k, e] of escMap) if (e.from === machine && e.esc.id === m.id) { escMap.delete(k); changed = true; } }
      if (changed && m.type !== 'rig.exchange' && m.type !== 'rig.exchanges') publish();
      return changed;
    },
    reset(machine) { const changed = forgetMachine(machine); if (changed) publish(); return changed; },
    dropped(machine) {
      for (const [k, r] of rigMap) if (r.machine === machine && r.lifecycle !== 'unreachable') rigMap.set(k, { ...r, lifecycle: 'unreachable' });
      const s = statusMap.get(machine); if (s && s.state !== 'unreachable') statusMap.set(machine, { ...s, state: 'unreachable' });
      publish();
    },
    rigs: () => rigList, escalations: () => escList, statuses: () => statusList,
    exchanges: (machine, rigId) => exchangeMap.get(key(machine, rigId)) ?? null
  };
}
