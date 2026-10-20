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
// `credential.register` and the push operations name no session, so they have no `id`. device.forget joins with the phone's code for it.
export type OpMessage = Exclude<Extract<PhoneClientMessage, { op: string }>, { type: 'device.forget' }>;

export interface Op {
  op: string;
  message: OpMessage;
  phase: OpPhase;
  reason?: OperationReason;
  /** When the phone first sent it. */
  at: string;
  /** The PC said `received` (or a final status): it may have applied the op. Absent on an op that never got that far. */
  received?: boolean;
  /** The PC's boot id known when it said so; absent when none was known (a daemon without boot ids). */
  boot?: string;
}

export const OPS_KEY = 'ledge.mobile.operations';
/** Finished operations kept, for the outcome of a request and the thread's « taken ». */
export const KEEP_FINISHED = 50;
/** An operation still without a result after this long is uncertain. */
export const UNCERTAIN_MS = 10_000;

/**
 * Operations that stay in this page's memory. Push changes: replayed after a reload they could undo a later choice, and
 * they carry the endpoint (a secret). A chat relay or launch: after a reload nothing leaves without a new gesture.
 */
const isVolatile = (m: { type: string }) => m.type === 'push.subscribe' || m.type === 'push.unsubscribe' || m.type === 'chat.relay' || m.type === 'chat.launch';

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
export const expectKey = (m: OpMessage): string | undefined => 'expect' in m ? m.expect?.key : undefined;

/**
 * How long an instruction or an interrupt of unknown outcome may still be sent again (the same as the thread's
 * window). Neither names a request, so past this an old intent could act on a later, unrelated turn, and the PC
 * may have forgotten the op (it keeps results 24 h, 500 at most) and apply it a second time. An answer to a request
 * names it by its key, so the PC refuses it as `stale` once the request changed: it is always sent again.
 */
export const RESEND_MAX_MS = 300_000;

/**
 * Whether an operation is sent again. One too old stays uncertain for good (« vérifiez le terminal »). The PC keeps
 * its operation registry in memory: one without `expect` that the PC received under another boot may have been
 * applied by the process that is gone, and nothing says so now. It stays uncertain too. Without a boot to compare
 * (`boot` null: a daemon that sends none), the age rule alone applies.
 */
export function resendable(o: Op, boot: string | null, now: number = Date.now()): boolean {
  if (!isLive(o.phase)) return false;
  if (expectKey(o.message) !== undefined) return true;
  if (now - Date.parse(o.at) >= RESEND_MAX_MS) return false;
  return !o.received || boot === null || o.boot === boot;
}

/**
 * Double-send guard. An answer to a request is refused while another one to that request is on its way, uncertain or
 * applied. An instruction or an interrupt names no request: it is refused while another of the same kind on that
 * session may still be sent again (`resendable`); a finished one, or one too old to be sent again, does not stop a
 * later, deliberate one.
 */
export function isNew(ops: Record<string, Op>, m: OpMessage, boot: string | null, now: number = Date.now()): boolean {
  if (ops[m.op]) return false;
  // A registration or a push change names no session: only its own op id dedupes it (a new attempt is a new op).
  if (!('id' in m)) return true;
  const key = expectKey(m);
  return !Object.values(ops).some(o => {
    if (!('id' in o.message) || o.message.id !== m.id) return false;
    if (key !== undefined) return expectKey(o.message) === key && (isLive(o.phase) || o.phase === 'applied');
    return o.message.type === m.type && expectKey(o.message) === undefined && resendable(o, boot, now);
  });
}

const OpSchema = z.object({
  op: z.string().uuid(),
  message: PhoneClientMessageSchema,
  phase: z.enum(['sending', 'uncertain', 'applied', 'rejected', 'failed']),
  reason: OperationReasonSchema.optional(),
  at: z.string().datetime(),
  received: z.boolean().optional(),
  boot: z.string().optional()
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
      if (!p.success || !('op' in p.data.message) || p.data.message.op !== p.data.op || isVolatile(p.data.message)) continue;
      const { reason, ...rest } = p.data;
      ops[p.data.op] = { ...rest, message: p.data.message as OpMessage, phase: p.data.phase === 'sending' ? 'uncertain' : p.data.phase, ...(reason ? { reason } : {}) };
    }
    return ops;
  } catch { return {}; }
}

export function saveOps(ops: Record<string, Op>, storage?: Storage): void {
  try { localStore(storage)?.setItem(OPS_KEY, JSON.stringify(Object.fromEntries(Object.entries(ops).filter(([, o]) => !isVolatile(o.message))))); } catch { /* storage full or blocked: the live state still works */ }
}

export function clearOps(storage?: Storage): void {
  try { localStore(storage)?.removeItem(OPS_KEY); } catch { /* ignore */ }
}
