import type { ClientMessage, OperationReason, OperationStatus } from '@ledge/protocol';

export interface OperationRecord { id: string; owner: string; fingerprint: string; status: OperationStatus; reason?: OperationReason; at: string }

export type BeginResult = { kind: 'fresh' | 'replay'; record: OperationRecord } | { kind: 'conflict' };

/** Fields of a client message that decide what an operation does. Add a field here (e.g. `other`) and it joins the fingerprint. */
const FINGERPRINT_FIELDS = ['type', 'id', 'decision', 'text', 'pendingId', 'pendingVersion'] as const;

/** Stable JSON of what the operation does; never the assertion or the operation id. */
export function fingerprint(msg: ClientMessage): string {
  const src = msg as unknown as Record<string, unknown>;
  return JSON.stringify(FINGERPRINT_FIELDS.map((k) => src[k] ?? null));
}

interface Entry { record: OperationRecord; ms: number }

/** In-memory, bounded (24 h / 500): the same operation id never runs twice. Lost on restart, so a phone then reads `unknown`. */
export class OperationRegistry {
  private entries = new Map<string, Entry>();
  private now: () => number;
  private ttlMs: number;
  private max: number;

  constructor(o: { now?: () => number; ttlMs?: number; max?: number } = {}) {
    this.now = o.now ?? Date.now;
    this.ttlMs = o.ttlMs ?? 86_400_000;
    this.max = o.max ?? 500;
  }

  begin(id: string, owner: string, fp: string): BeginResult {
    this.expire();
    const existing = this.entries.get(id);
    if (existing) {
      if (existing.record.owner !== owner || existing.record.fingerprint !== fp) return { kind: 'conflict' };
      return { kind: 'replay', record: { ...existing.record } };
    }
    const ms = this.now();
    const record: OperationRecord = { id, owner, fingerprint: fp, status: 'received', at: new Date(ms).toISOString() };
    this.entries.set(id, { record, ms });
    this.evict();
    return { kind: 'fresh', record: { ...record } };
  }

  finish(id: string, status: 'applied' | 'rejected' | 'failed', reason?: OperationReason): OperationRecord {
    const e = this.entries.get(id);
    if (!e) throw new Error(`unknown operation ${id}`);
    e.record.status = status;
    if (reason) e.record.reason = reason; else delete e.record.reason;
    return { ...e.record };
  }

  get(id: string, owner: string): OperationRecord | undefined {
    this.expire();
    const e = this.entries.get(id);
    return e && e.record.owner === owner ? { ...e.record } : undefined;
  }

  private expire(): void {
    const limit = this.now() - this.ttlMs;
    for (const [id, e] of this.entries) if (e.ms < limit) this.entries.delete(id);
  }

  /** Drops the oldest finished operations first; an operation still `received` is never evicted. */
  private evict(): void {
    for (const [id, e] of this.entries) {
      if (this.entries.size <= this.max) return;
      if (e.record.status !== 'received') this.entries.delete(id);
    }
  }
}
