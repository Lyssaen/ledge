import type { OpenRigStatus, RigVerb } from '@ledge/protocol';
import { OpenRigUnreachable, type OpenRigHttp } from './http.js';

export type RigTarget = { rigId: string; seatRef?: undefined } | { rigId?: string; seatRef: string };
export interface RigRequest { method: 'POST'; path: string; body: Record<string, unknown> }

const RIG_VERBS: readonly RigVerb[] = ['down', 'up', 'restore'];
/** The word of each seat gesture in the reason OpenRig records. */
const GESTE: Partial<Record<RigVerb, string>> = { restart: 'relance', stop: 'arrêt', handover: 'relève' };

/** A rig verb needs a rig id (and no seat), a seat verb needs a seat ref. */
const validTarget = (verb: RigVerb, t: { rigId?: string; seatRef?: string }): boolean =>
  RIG_VERBS.includes(verb) ? !!t.rigId && t.seatRef === undefined : !!t.seatRef;
const enc = encodeURIComponent;

/** The OpenRig request of a verb; 'restore' is two calls (list snapshots, restore the newest). Throws on a target `actOnRig` refuses. */
export function rigActRequest(verb: RigVerb, target: RigTarget, operator: string): RigRequest | 'restore' {
  if (!validTarget(verb, target)) throw new Error('invalid target');
  if (verb === 'restore') return 'restore';
  if (verb === 'down') return { method: 'POST', path: '/api/down', body: { rigId: target.rigId, snapshot: true } };
  if (verb === 'up') return { method: 'POST', path: `/api/rigs/${enc(target.rigId!)}/up`, body: {} };
  const reason = `Ledge : ${GESTE[verb]} demandé par l'utilisateur`;
  return { method: 'POST', path: `/api/seat/${verb}/${enc(target.seatRef!)}`, body: { reason, ...(verb === 'handover' ? { source: 'fresh' } : {}), operator } };
}

export interface ActDeps {
  /** Read after `ensureRunning`: the bridge has no client before its first probe. */
  http: () => OpenRigHttp | null;
  ensureRunning(reason: 'action'): Promise<OpenRigStatus>;
  operator: string;
}
export type ActResult = { ok: true } | { ok: false; code: 'openrig_down' | 'unsupported' | 'failed'; reason: string };

const failed = (reason: string): ActResult => ({ ok: false, code: 'failed', reason });
/** `error`, `message` or `code` of a refusal body, else `HTTP <status>`. */
function refusal(r: { status: number; json: unknown }): string {
  const j = r.json as { error?: unknown; message?: unknown; code?: unknown } | null;
  for (const v of [j?.error, j?.message, j?.code]) if (typeof v === 'string' && v !== '') return v;
  return `HTTP ${r.status}`;
}
const ok2xx = (r: { status: number }) => r.status >= 200 && r.status < 300;

export async function actOnRig(d: ActDeps, msg: { verb: RigVerb } & { rigId?: string; seatRef?: string }): Promise<ActResult> {
  if (!validTarget(msg.verb, msg)) return failed('invalid target');
  const status = await d.ensureRunning('action');
  if (status.state !== 'running') return { ok: false, code: status.state === 'unsupported' ? 'unsupported' : 'openrig_down', reason: status.detail ?? `OpenRig : ${status.state}` };
  const http = d.http(); if (!http) return { ok: false, code: 'openrig_down', reason: "OpenRig n'est pas branché" };
  try {
    const req = rigActRequest(msg.verb, msg as RigTarget, d.operator);
    if (req === 'restore') {
      const rigId = msg.rigId!;
      const list = await http.call('GET', `/api/rigs/${enc(rigId)}/snapshots`);
      if (!ok2xx(list)) return failed(refusal(list));
      const j = list.json as { snapshots?: unknown; items?: unknown } | unknown[] | null;
      const rows = Array.isArray(j) ? j : Array.isArray(j?.snapshots) ? j.snapshots : Array.isArray(j?.items) ? j.items : [];
      const snaps = rows.filter((x): x is { id: string; createdAt?: string } => typeof (x as { id?: unknown } | null)?.id === 'string');
      if (!snaps.length) return failed('no snapshot');
      const newest = snaps.reduce((a, b) => ((b.createdAt ?? '') > (a.createdAt ?? '') ? b : a));
      const r = await http.call('POST', `/api/rigs/${enc(rigId)}/restore/${enc(newest.id)}`, {});
      return ok2xx(r) ? { ok: true } : failed(refusal(r));
    }
    const r = await http.call(req.method, req.path, req.body);
    return ok2xx(r) ? { ok: true } : failed(refusal(r));
  } catch (e) {
    if (e instanceof OpenRigUnreachable) return { ok: false, code: 'openrig_down', reason: e.message };
    return failed((e as Error).message);
  }
}
