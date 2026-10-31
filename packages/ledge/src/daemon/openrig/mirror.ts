import { isDeepStrictEqual } from 'node:util';
import { relative, isAbsolute, sep } from 'node:path';
import { type Projects, type Rig, type RigLifecycle, type RigSeat } from '@ledge/protocol';
import { EVENTS, EVENTS_UNOBSERVED } from './facts.js';
import type { OpenRigEvent } from './sse.js';
import { toSeat } from './seats.js';
import { paths } from '../../paths.js';
import { rigProjectId } from './adopt.js';
import type { KernelStatus, NodeEntry, PsEntry } from './wire.js';

export interface MirrorSnapshot { rigs: PsEntry[]; nodes: Map<string, NodeEntry[]>; kernel: KernelStatus | null }
export interface Mirror {
  replace(s: MirrorSnapshot): { updated: Rig[]; removed: string[] };
  applyEvent(e: OpenRigEvent): { updated: Rig[]; removed: string[]; refetch: string[] };
  setNodes(rigId: string, nodes: NodeEntry[]): Rig | null;
  markUnreachable(): Rig[];
  pair(rigId: string, ref: string, sessionId: string | undefined): Rig | null;
  rigs(): Rig[]; byRef(ref: string): { rig: Rig; seat: RigSeat } | null; byName(name: string): Rig | null;
}

interface Entry { ps: PsEntry; nodes: NodeEntry[] }
const REFETCH = new Set<string>([EVENTS.rigImported, EVENTS.nodeLaunched, EVENTS.nodeStartupReady, ...Object.values(EVENTS_UNOBSERVED)]);

export function createMirror(opts: { machine: string; projects: () => Projects; rigsRoot?: string }): Mirror {
  const entries = new Map<string, Entry>(); const pairs = new Map<string, string>(); // seat ref -> Ledge session id
  let kernel: KernelStatus | null = null; let unreachable = false;
  const rigsRoot = opts.rigsRoot ?? paths().rigs;
  const underRigs = (cwd: string) => { const r = relative(rigsRoot, cwd); return r !== '' && r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r); };
  const nameOf = (ps: PsEntry) => String(ps.rigName ?? ps.name ?? ps.rigId);
  const isKernel = (ps: PsEntry) => {
    if (nameOf(ps) === 'kernel') return true;
    const k = kernel as Record<string, unknown> | null; if (!k) return false;
    return [k.rigId, k.rig_id, k.rigName, k.rig_name, k.rig].some(v => typeof v === 'string' && (v === ps.rigId || v === nameOf(ps)));
  };
  const build = ({ ps, nodes }: Entry): Rig => {
    const seats = nodes.map(n => { const s = toSeat(n); const sessionId = pairs.get(s.ref); return sessionId ? { ...s, sessionId } : s; });
    const cwd = nodes.find(n => typeof n.cwd === 'string' && n.cwd)?.cwd as string | undefined ?? '';
    const base = (ps.status === 'running' || ps.status === 'partial' || ps.status === 'stopped' ? ps.status : 'running') as RigLifecycle;
    const lifecycle: RigLifecycle = unreachable ? 'unreachable' : seats.some(s => s.state === 'starting') ? 'launching' : base;
    return { id: ps.rigId, name: nameOf(ps), machine: opts.machine, cwd, projectId: rigProjectId({ id: ps.rigId, cwd, machine: opts.machine }, opts.projects()),
      offProject: cwd !== '' && underRigs(cwd), lifecycle, kernel: isKernel(ps), seats, repos: [] };
  };
  const all = () => [...entries.values()].map(build);
  const byId = (id: string) => { const e = entries.get(id); return e ? build(e) : null; };

  return {
    replace(s) {
      const before = new Map(all().map(r => [r.id, r])); kernel = s.kernel; unreachable = false; const next = new Map<string, Entry>();
      for (const ps of s.rigs) next.set(ps.rigId, { ps, nodes: s.nodes.get(ps.rigId) ?? entries.get(ps.rigId)?.nodes ?? [] });
      const removed = [...entries.keys()].filter(id => !next.has(id));
      entries.clear(); for (const [k, v] of next) entries.set(k, v);
      return { updated: all().filter(r => !isDeepStrictEqual(before.get(r.id), r)), removed };
    },
    applyEvent(e) {
      const none = { updated: [], removed: [], refetch: [] as string[] };
      if (e.type === EVENTS.seatActivity) {
        if (e.rigId) return { ...none, refetch: [e.rigId] };
        const hit = typeof e.sessionName === 'string' ? this.byRef(e.sessionName) : null;
        return hit ? { ...none, refetch: [hit.rig.id] } : none;
      }
      if (REFETCH.has(e.type) && e.rigId) return { ...none, refetch: [e.rigId] };
      return none;
    },
    setNodes(rigId, nodes) { const e = entries.get(rigId); if (!e) return null; e.nodes = nodes; return build(e); },
    markUnreachable() { unreachable = true; return all(); },
    pair(rigId, ref, sessionId) {
      const e = entries.get(rigId); if (!e) return null;
      if (sessionId === undefined) pairs.delete(ref); else pairs.set(ref, sessionId);
      return build(e);
    },
    rigs: all,
    byRef(ref) { for (const r of all()) { const seat = r.seats.find(s => s.ref === ref); if (seat) return { rig: r, seat }; } return null; },
    byName(name) { return all().find(r => r.name === name) ?? null; }
  };
}
