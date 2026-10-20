// The phone's own operations (a decision, a reply, an interrupt): each named by a uuid it made, so sending it again
// after a lost connection is recognised by the PC, which replays the result it already gave.
import { OperationReasonSchema, PhoneClientMessageSchema, type OperationReason, type PhoneClientMessage } from '@ledge/protocol';
import { z } from 'zod';
import { localStore } from './storage';

/**
 * `sending`: sent, no outcome yet (a `received` result keeps it here). `uncertain`: no outcome after `UNCERTAIN_MS`, or
 * the link broke first; it is sent again, with the same op, at the next ready. The other three are the PC's outcome.
 */
export type OpPhase = 'sending' | 'uncertain' | 'applied' | 'rejected' | 'failed';

/** The messages that are operations. */
export type OpMessage = Extract<PhoneClientMessage, { op: string }>;

export interface Op {
  op: string;
  message: OpMessage;
  phase: OpPhase;
  reason?: OperationReason;
  /** When the phone first sent it. */
  at: string;
}

export const OPS_KEY = 'ledge.mobile.operations';
/** Finished operations kept, for the outcome of a request and the thread's « taken ». */
export const KEEP_FINISHED = 50;
/** An operation still without a result after this long is uncertain. */
export const UNCERTAIN_MS = 10_000;

export const isLive = (p: OpPhase) => p === 'sending' || p === 'uncertain';

export const newOperationId = (): string => crypto.randomUUID();

/** Every unresolved operation, and the `KEEP_FINISHED` latest finished ones. The same object when nothing goes. */
export function pruneOps(ops: Record<string, Op>): Record<string, Op> {
  const finished = Object.values(ops).filter(o => !isLive(o.phase)).sort((a, b) => a.at.localeCompare(b.at));
  if (finished.length <= KEEP_FINISHED) return ops;
  const drop = new Set(finished.slice(0, finished.length - KEEP_FINISHED).map(o => o.op));
  return Object.fromEntries(Object.entries(ops).filter(([id]) => !drop.has(id)));
}

/** The key of the request a message answers; undefined for an instruction (`expect: null`) or an interrupt. */
export const expectKey = (m: OpMessage): string | undefined => m.type === 'session.interrupt' ? undefined : m.expect?.key;

/**
 * How long an instruction or an interrupt of unknown outcome may still be sent again (the same as the thread's
 * window). Neither names a request, so past this an old intent could act on a later, unrelated turn, and the PC
 * may have forgotten the op (it keeps results 24 h, 500 at most) and apply it a second time. An answer to a request
 * names it by its key, so the PC refuses it as `stale` once the request changed: it is always sent again.
 */
export const RESEND_MAX_MS = 300_000;

/** Whether an operation is sent again at the next ready. One too old stays uncertain for good (« vérifiez le terminal »). */
export function resendable(o: Op, now: number = Date.now()): boolean {
  if (!isLive(o.phase)) return false;
  return expectKey(o.message) !== undefined || now - Date.parse(o.at) < RESEND_MAX_MS;
}

/**
 * Double-send guard. An answer to a request is refused while another one to that request is on its way, uncertain or
 * applied. An instruction or an interrupt names no request: it is refused while another of the same kind on that
 * session may still be sent again (`resendable`); a finished one, or one too old to be sent again, does not stop a
 * later, deliberate one.
 */
export function isNew(ops: Record<string, Op>, m: OpMessage, now: number = Date.now()): boolean {
  if (ops[m.op]) return false;
  const key = expectKey(m);
  return !Object.values(ops).some(o => {
    if (o.message.id !== m.id) return false;
    if (key !== undefined) return expectKey(o.message) === key && (isLive(o.phase) || o.phase === 'applied');
    return o.message.type === m.type && expectKey(o.message) === undefined && resendable(o, now);
  });
}

const OpSchema = z.object({
  op: z.string().uuid(),
  message: PhoneClientMessageSchema,
  phase: z.enum(['sending', 'uncertain', 'applied', 'rejected', 'failed']),
  reason: OperationReasonSchema.optional(),
  at: z.string().datetime()
});


/** The operations kept on the phone. One still on its way when the page went is uncertain: its outcome is unknown. */
export function loadOps(storage?: Storage): Record<string, Op> {
  try {
    const raw = localStore(storage)?.getItem(OPS_KEY);
    const v = raw ? JSON.parse(raw) as unknown : null;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const ops: Record<string, Op> = {};
    for (const x of Object.values(v)) {
      const p = OpSchema.safeParse(x);
      if (!p.success || !('op' in p.data.message) || p.data.message.op !== p.data.op) continue;
      const { reason, ...rest } = p.data;
      ops[p.data.op] = { ...rest, message: p.data.message as OpMessage, phase: p.data.phase === 'sending' ? 'uncertain' : p.data.phase, ...(reason ? { reason } : {}) };
    }
    return ops;
  } catch { return {}; }
}

export function saveOps(ops: Record<string, Op>, storage?: Storage): void {
  try { localStore(storage)?.setItem(OPS_KEY, JSON.stringify(ops)); } catch { /* storage full or blocked: the live state still works */ }
}

export function clearOps(storage?: Storage): void {
  try { localStore(storage)?.removeItem(OPS_KEY); } catch { /* ignore */ }
}
