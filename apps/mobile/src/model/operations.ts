import type { ClientMessage, OperationReason, OperationStatus } from '@ledge/protocol';
import type { Link } from '../state/store';

/** Where a phone-made operation stands. `uncertain`: the connection was lost before its outcome was known. */
export type Phase = 'sending' | 'received' | 'applied' | 'rejected' | 'failed' | 'uncertain' | 'unknown';

export interface OpState {
  operationId: string;
  sessionId: string;
  pendingId?: string;
  pendingVersion?: number;
  kind: 'decide' | 'answer' | 'message' | 'interrupt';
  decision?: 'accept' | 'deny';
  text?: string;
  /** An answer typed in free text (`session.reply { other: true }`), not an option number. */
  other?: boolean;
  phase: Phase;
  reason?: OperationReason;
  startedAt: string;
}

export type OpEvent =
  | { type: 'sent'; op: OpState }
  | { type: 'received'; operationId: string }
  | { type: 'result'; operationId: string; status: OperationStatus; reason?: OperationReason }
  | { type: 'link'; link: Link }
  | { type: 'resumed' };

export const OPS_KEY = 'ledge.mobile.operations';
const KEEP_FINISHED = 50;

const isOpen = (p: Phase) => p === 'sending' || p === 'received';
const isFinished = (p: Phase) => p === 'applied' || p === 'rejected' || p === 'failed' || p === 'unknown';

const touch = (s: Record<string, OpState>, id: string, f: (o: OpState) => OpState): Record<string, OpState> => {
  const o = s[id];
  if (!o) return s;
  const n = f(o);
  return n === o ? s : { ...s, [id]: n };
};
const lose = (s: Record<string, OpState>): Record<string, OpState> => {
  if (!Object.values(s).some(o => isOpen(o.phase))) return s;
  return Object.fromEntries(Object.entries(s).map(([id, o]) => [id, isOpen(o.phase) ? { ...o, phase: 'uncertain' as const } : o]));
};

/**
 * Pure bookkeeping. Only `sent` creates an operation, and it is the caller's own send that raises it:
 * no other event can make a decision (a lost connection only makes it uncertain, never a retry).
 */
export function opsReducer(s: Record<string, OpState>, e: OpEvent): Record<string, OpState> {
  switch (e.type) {
    case 'sent': return { ...s, [e.op.operationId]: { ...e.op, phase: 'sending' } };
    case 'received': return touch(s, e.operationId, o => o.phase === 'sending' || o.phase === 'uncertain' ? { ...o, phase: 'received' } : o);
    case 'result': return touch(s, e.operationId, o => {
      if (isFinished(o.phase)) return o;
      const { reason: _old, ...rest } = o;
      switch (e.status) {
        case 'received': return { ...rest, phase: 'received' };
        case 'applied': return { ...rest, phase: 'applied' };
        case 'unknown': return { ...rest, phase: 'unknown' };
        case 'rejected': case 'failed': return { ...rest, phase: e.status, ...(e.reason ? { reason: e.reason } : {}) };
      }
    });
    case 'link': return e.link === 'online' ? s : lose(s);
    case 'resumed': return lose(s);
  }
}

/** Operations whose outcome must be asked of the daemon (`operation.status`); never to be sent again. */
export function toCheck(s: Record<string, OpState>): string[] {
  return Object.values(s).filter(o => o.phase === 'uncertain').map(o => o.operationId);
}

const live = (p: Phase) => p === 'sending' || p === 'received' || p === 'uncertain';

/**
 * Double-send guard: a new operation, and no live or applied one already answers the same request. An instruction
 * or an interrupt names no request: it is refused while another of the same kind is still in flight or of unknown
 * delivery on that session (a finished one does not stop a later, deliberate one).
 */
export function isNew(s: Record<string, OpState>, op: OpState): boolean {
  if (s[op.operationId]) return false;
  if (op.pendingId === undefined) return !Object.values(s).some(o => o.kind === op.kind && o.sessionId === op.sessionId && live(o.phase));
  return !Object.values(s).some(o => o.sessionId === op.sessionId && o.pendingId === op.pendingId && o.pendingVersion === op.pendingVersion && (live(o.phase) || o.phase === 'applied'));
}

/** The outgoing message and the tracked operation must describe the same thing. */
export function matches(op: OpState, msg: ClientMessage): boolean {
  if (msg.type === 'session.decide') return op.kind === 'decide' && msg.operationId === op.operationId && msg.id === op.sessionId && msg.pendingId === op.pendingId && msg.pendingVersion === op.pendingVersion && msg.decision === op.decision;
  if (msg.type === 'session.reply') {
    // An answer names its request; an instruction ('message') names none.
    const kindOk = op.kind === 'answer' ? op.pendingId !== undefined : op.kind === 'message' && op.pendingId === undefined && op.pendingVersion === undefined;
    return kindOk && msg.operationId === op.operationId && msg.id === op.sessionId && msg.pendingId === op.pendingId && msg.pendingVersion === op.pendingVersion && msg.text === op.text && (msg.other ?? false) === (op.other ?? false);
  }
  if (msg.type === 'session.interrupt') return op.kind === 'interrupt' && op.pendingId === undefined && msg.operationId === op.operationId && msg.id === op.sessionId;
  return false;
}

export const newOperationId = (): string => crypto.randomUUID();

/** Unfinished operations and the last 50 finished ones. */
export function pruneOps(s: Record<string, OpState>): OpState[] {
  const all = Object.values(s);
  const finished = all.filter(o => isFinished(o.phase)).slice(-KEEP_FINISHED);
  const keep = new Set(finished.map(o => o.operationId));
  return all.filter(o => !isFinished(o.phase) || keep.has(o.operationId));
}

export function saveOps(s: Record<string, OpState>, storage?: Storage): void {
  try { (storage ?? globalThis.localStorage)?.setItem(OPS_KEY, JSON.stringify(pruneOps(s))); } catch { /* storage full or blocked */ }
}

/** After a reload the connection that carried an open operation is gone: its outcome is uncertain. */
export function loadOps(storage?: Storage): Record<string, OpState> {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(OPS_KEY);
    const list = raw ? JSON.parse(raw) as unknown : null;
    if (!Array.isArray(list)) return {};
    const s: Record<string, OpState> = {};
    for (const o of list as OpState[]) if (o && typeof o.operationId === 'string' && typeof o.sessionId === 'string') s[o.operationId] = o;
    return lose(s);
  } catch { return {}; }
}
