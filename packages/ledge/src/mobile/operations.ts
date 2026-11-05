// Makes a phone's writes idempotent: an operation id (a uuid the phone picks) runs once, and a retry gets the stored outcome.
// In memory only, so a daemon restart forgets every operation.
import type { CloseHow, OperationReason, OperationStatus, PhoneClientMessage } from '@ledge/protocol';

export type PhoneOperation = Extract<PhoneClientMessage, { op: string }>;

/** What an operation came to: the answer the phone gets. `how`: how a `session.close` ended the agent. */
export type Outcome = { status: Extract<OperationStatus, 'applied' | 'rejected' | 'failed'>; reason?: OperationReason; how?: CloseHow; report?: Report;
  /** The operation's own detailed end, sent after its result and again on a replay (an OpenRig answer's `openrig.answered`). */ detail?: unknown };

/** An applied `session.broadcast`: the names that got it, and those that did not, with why. */
export interface Report { sent: string[]; refused: { name: string; reason: string }[] }

export interface OperationRecord { op: string; owner: string; fingerprint: string; status: OperationStatus; reason?: OperationReason; how?: CloseHow; report?: Report; detail?: unknown; at: number }

export type BeginResult = { kind: 'fresh' | 'replay'; record: OperationRecord } | { kind: 'conflict' };

/** What the operation does, never its id. */
export function fingerprint(m: PhoneOperation): string {
  // Read as the union of every message's fields: a field the message lacks is null. The signed parts of a credential are not part of it.
  const f = m as { id?: string; decision?: string; note?: string; text?: string; expect?: { key: string } | null; credential?: { id: string }; requestId?: string; answers?: unknown; subscription?: { endpoint: string }; key?: string; qid?: string; rows?: number[]; row?: number; task?: string; attachments?: string[] };
  return JSON.stringify([m.type, f.id ?? null, f.decision ?? null, f.note ?? null, f.text ?? null, f.expect?.key ?? null, f.credential?.id ?? null, f.requestId ?? null, f.answers ?? null, f.subscription?.endpoint ?? null, f.key ?? null, f.qid ?? null, f.rows ?? null,
    ...(f.row !== undefined || f.task !== undefined ? [f.row ?? null, f.task ?? null] : []),
    ...(f.attachments?.length ? [f.attachments] : []),
    // A model change is its model and effort: the same id for another model is another operation (null, the agent's default, too).
    ...(m.type === 'session.model' ? [m.model, m.effort] : []),
    ...(m.type === 'session.broadcast' ? [m.sessions] : []),
    // A hold is its terminal: the same id for another terminal is another operation.
    ...(m.type === 'term.hold' ? [m.tid] : []),
    // An OpenRig answer is its row and its answer (never its assertion, which changes): the same id for another is another operation.
    ...(m.type === 'openrig.answer' ? [m.qitemId, m.answer] : []),
    // Settings are their values: the same id for other values is another operation.
    ...(m.type === 'device.prefs' ? [m.prefs] : []),
    ...(m.type === 'context.set' ? [m.near] : []),
    // A project change is its project and values (never its assertion): the same id for other values is another operation.
    ...(m.type === 'project.edit' ? [m.id, m.name ?? null, m.color ?? null] : []),
    ...(m.type === 'project.order' ? [m.ids] : []),
    ...(m.type === 'project.create' ? [m.name, m.color] : []),
    ...(m.type === 'project.delete' ? [m.id, m.moveTo] : []),
    ...(m.type === 'project.folder.add' ? [m.id, m.path] : []),
    ...(m.type === 'project.folder.remove' ? [m.id, m.machine, m.path] : [])]);
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
  finish(op: string, status: OperationStatus, reason?: OperationReason, how?: CloseHow, report?: Report, detail?: unknown): void {
    const r = this.records.get(op);
    if (!r) return;
    if (report) r.report = report; else delete r.report;
    r.status = status;
    if (reason) r.reason = reason; else delete r.reason;
    if (how) r.how = how; else delete r.how;
    if (detail !== undefined) r.detail = detail; else delete r.detail;
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
