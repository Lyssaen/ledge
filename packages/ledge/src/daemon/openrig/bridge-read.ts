import { HUMAN_ADDRESS, OPEN_QUEUE_STATES, OPERATOR_HUMAN_SESSIONS } from './facts.js';
import { OpenRigUnreachable, type OpenRigHttp } from './http.js';
import type { RigCli } from './cli.js';
import type { MirrorSnapshot } from './mirror.js';
import { isHumanRow } from './escalations.js';
import type { NodeEntry, QueueRow } from './wire.js';

const rethrowUnreachable = (e: unknown): null => { if (e instanceof OpenRigUnreachable) throw e; return null; };

/** `ps`, then the nodes of each rig and the kernel status. A failed `nodes` (404: rig going away) is left out, so the mirror keeps
 *  the nodes it had and the next resync settles it; a failed kernel status (503 while booting) is null. Unreachable throws. */
export async function readRigs(http: OpenRigHttp): Promise<MirrorSnapshot> {
  const rigs = await http.ps(); const nodes = new Map<string, NodeEntry[]>();
  await Promise.all(rigs.map(async r => { const n = await http.nodes(r.rigId).catch(rethrowUnreachable); if (n) nodes.set(r.rigId, n); }));
  const kernel = await http.kernel().catch(rethrowUnreachable);
  return { rigs, nodes, kernel };
}

/** Open rows addressed to the human or the operator human. Human-gate rows sent to other seats cannot be found by destination
 *  (known gap, lot 2). No per-row GET: the list carries the questions. */
export async function readHumanQueue(http: OpenRigHttp): Promise<QueueRow[]> {
  const out = new Map<string, QueueRow>();
  for (const destinationSession of [HUMAN_ADDRESS, ...OPERATOR_HUMAN_SESSIONS])
    for (const row of await http.queue({ destinationSession, state: OPEN_QUEUE_STATES }))
      if (OPEN_QUEUE_STATES.includes(row.state) && isHumanRow(row)) out.set(row.qitemId, row);
  return [...out.values()];
}

/** probeOpenRig is stateless: this keeps `rig --version` cached while /healthz reports the same pid. */
export function versionCache(cli: RigCli): (http: OpenRigHttp) => { http: OpenRigHttp; cli: RigCli } {
  let pid: number | undefined; let hit: { pid: number; v: string | null } | null = null;
  const cached: RigCli = { ...cli, async version() {
    const p = pid; if (p !== undefined && hit?.pid === p) return hit.v;
    const v = await cli.version(); if (p !== undefined) hit = { pid: p, v }; return v;
  } };
  return http => ({ http: { ...http, async health() { const h = await http.health(); pid = h.pid; return h; } }, cli: cached });
}
