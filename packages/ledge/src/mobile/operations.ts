// Makes a phone's writes idempotent: an operation id (a uuid the phone picks) runs once, and a retry gets the stored outcome.
// In memory only, so a daemon restart forgets every operation.
import type { OperationReason, OperationStatus, PhoneClientMessage } from '@ledge/protocol';

// Until the gateway handles the lot 6a writes (credential.register, session.answer, device.forget), they are kept out of this type.
export type PhoneOperation = Extract<PhoneClientMessage, { op: string; id: string }> extends infer M ? Exclude<M, { type: 'session.answer' }> : never;

export interface OperationRecord { op: string; owner: string; fingerprint: string; status: OperationStatus; reason?: OperationReason; at: number }

export type BeginResult = { kind: 'fresh' | 'replay'; record: OperationRecord } | { kind: 'conflict' };

/** What the operation does, never its id. */
export function fingerprint(m: PhoneOperation): string {
  const f = m as { decision?: string; note?: string; text?: string; expect?: { key: string } };
  return JSON.stringify([m.type, m.id, f.decision ?? null, f.note ?? null, f.text ?? null, f.expect?.key ?? null]);
}

/** Bounded (24 h, 500 records): the oldest finished record goes first, and a record still `received` is never evicted. */
export class OperationRegistry {
  private records = new Map<string, OperationRecord>();
  private now: () => number;
  private ttlMs: number;
  private max: number;

  constructor(o: { now?: () => number; ttlMs?: number; max?: number } = {}) {
    this.now = o.now ?? Date.now;
    this.ttlMs = o.ttlMs ?? 86_400_000;
    this.max = o.max ?? 500;
  }

  begin(owner: string, op: string, fp: string): BeginResult {
    this.expire();
    const known = this.records.get(op);
    if (known) {
      if (known.owner !== owner || known.fingerprint !== fp) return { kind: 'conflict' };
      return { kind: 'replay', record: { ...known } };
    }
    if (this.records.size >= this.max && !this.evictOldestFinished()) return { kind: 'conflict' };
    const record: OperationRecord = { op, owner, fingerprint: fp, status: 'received', at: this.now() };
    this.records.set(op, record);
    return { kind: 'fresh', record: { ...record } };
  }

  /** An operation already forgotten (expired) is left forgotten. */
  finish(op: string, status: OperationStatus, reason?: OperationReason): void {
    const r = this.records.get(op);
    if (!r) return;
    r.status = status;
    if (reason) r.reason = reason; else delete r.reason;
  }

  get(op: string): OperationRecord | undefined {
    this.expire();
    const r = this.records.get(op);
    return r && { ...r };
  }

  private expire(): void {
    const limit = this.now() - this.ttlMs;
    for (const [op, r] of this.records) if (r.at < limit) this.records.delete(op);
  }

  private evictOldestFinished(): boolean {
    for (const [op, r] of this.records) {
      if (r.status !== 'received') { this.records.delete(op); return true; }
    }
    return false;
  }
}
