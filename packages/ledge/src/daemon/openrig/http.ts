import type { z } from 'zod';
import { log } from '../../log.js';
import { HealthSchema, PsEntrySchema, NodeEntrySchema, KernelStatusSchema, QueueRowSchema, OutboxRowSchema,
  type Health, type PsEntry, type NodeEntry, type KernelStatus, type QueueRow, type OutboxRow } from './wire.js';

export type Fetch = typeof fetch;
/** Connection refused/reset (WSL mirrored networking resets instead of refusing) or timeout. */
export class OpenRigUnreachable extends Error { constructor(msg: string) { super(msg); this.name = 'OpenRigUnreachable'; } }

export interface OpenRigHttp {
  health(): Promise<Health>;
  ps(): Promise<PsEntry[]>;
  nodes(rigId: string): Promise<NodeEntry[]>;
  kernel(): Promise<KernelStatus>;
  queue(q: { destinationSession?: string; state?: readonly string[] }): Promise<QueueRow[]>;
  outbox(senderSession: string): Promise<OutboxRow[]>;
}

const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']);
const isUnreachable = (e: unknown): boolean => {
  const err = e as { name?: string; code?: string; cause?: { code?: string } } | null;
  return err?.name === 'TimeoutError' || err?.name === 'AbortError' || NETWORK_CODES.has(err?.code ?? '') || NETWORK_CODES.has(err?.cause?.code ?? '');
};

export function createOpenRigHttp(opts: { base: string; fetch?: Fetch; timeoutMs?: number }): OpenRigHttp {
  const doFetch = opts.fetch ?? fetch; const timeoutMs = opts.timeoutMs ?? 3000;
  const warned = new Set<string>();

  async function get(path: string): Promise<unknown> {
    let res: Response;
    try { res = await doFetch(`${opts.base}${path}`, { signal: AbortSignal.timeout(timeoutMs) }); }
    catch (e) {
      if (isUnreachable(e)) throw new OpenRigUnreachable(`OpenRig unreachable at ${opts.base}: ${(e as { cause?: { code?: string } }).cause?.code ?? (e as Error).name}`);
      throw e;
    }
    if (!res.ok) throw new Error(`OpenRig ${path} answered ${res.status}`);
    try { return await res.json(); }
    catch (e) { if (isUnreachable(e)) throw new OpenRigUnreachable(`OpenRig unreachable at ${opts.base}: body ${(e as Error).name}`); throw e; }
  }

  /** Bare array or `{ items: [...] }`; rows failing the schema are skipped, logged once per type. A body that is no list, or a
   *  non-empty list where no row parses, throws: the caller keeps what it had instead of reading an empty answer. */
  function rows<S extends z.ZodTypeAny>(kind: string, schema: S, raw: unknown): z.infer<S>[] {
    const list = Array.isArray(raw) ? raw : Array.isArray((raw as { items?: unknown } | null)?.items) ? (raw as { items: unknown[] }).items : null;
    if (!list) throw new Error(`OpenRig ${kind} answer is not a list`);
    const out: z.infer<S>[] = [];
    for (const item of list) {
      const p = schema.safeParse(item);
      if (p.success) out.push(p.data);
      else if (!warned.has(kind)) { warned.add(kind); log(`openrig: skipped a ${kind} row that does not match its schema (${p.error.issues[0]?.path.join('.') || 'root'}); further ones are silent`); }
    }
    if (list.length && !out.length) throw new Error(`OpenRig ${kind} answer has no readable row (${list.length} rows)`);
    return out;
  }

  return {
    async health() { return HealthSchema.parse(await get('/healthz')); },
    async ps() { return rows('ps', PsEntrySchema, await get('/api/ps')); },
    async nodes(rigId) { return rows('node', NodeEntrySchema, await get(`/api/rigs/${encodeURIComponent(rigId)}/nodes`)); },
    async kernel() { return KernelStatusSchema.parse(await get('/api/kernel/status')); },
    async queue(q) {
      const parts: string[] = [];
      if (q.destinationSession) parts.push(`destinationSession=${encodeURIComponent(q.destinationSession)}`);
      if (q.state?.length) parts.push(`state=${q.state.map(encodeURIComponent).join(',')}`);
      return rows('queue', QueueRowSchema, await get(`/api/queue/list${parts.length ? `?${parts.join('&')}` : ''}`));
    },
    async outbox(senderSession) { return rows('outbox', OutboxRowSchema, await get(`/api/queue/outbox/list?senderSession=${encodeURIComponent(senderSession)}`)); },
  };
}
