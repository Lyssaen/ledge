import type { LaunchRequest } from './form';

/** Spec §9.2: no `session.launched` within 15 s is a failure. */
export const LAUNCH_TIMEOUT_MS = 15_000;

export type LaunchError = { kind: 'daemon'; message: string } | { kind: 'offline' } | { kind: 'lost' } | { kind: 'timeout' };
export type LaunchStage = 'closed' | 'form' | 'starting' | 'failed';
export interface Flow {
  stage: LaunchStage;
  /** The request being started or that failed (Retry sends it again); kept when Edit returns to the form, null once the screen is closed or freshly opened. */
  request: LaunchRequest | null;
  error: LaunchError | null;
  /** Bumped on every send: a timeout only fails the attempt it was armed for. */
  attempt: number;
  /** Answers still owed by cancelled or timed-out attempts, per machine. This assumes the daemon answers in order on one
   *  connection, so the next ones from that machine are theirs: skipped, never taken for a newer attempt's. The daemon
   *  actually handles messages concurrently (server.ts:396-405), so answers may come back out of order. The worst case
   *  is then that the abandoned attempt's session gets selected instead of the retry's; both sessions exist. Likewise, an abandoned attempt that is never answered makes the retry's real answer get
   *  eaten as the late one; the retry then times out, the debt returns and this repeats until the connection drops. */
  late: Record<string, number>;
}
export const START: Flow = { stage: 'closed', request: null, error: null, attempt: 0, late: Object.create(null) };

export type FlowEvent =
  | { type: 'open' } | { type: 'close' } | { type: 'edit' }
  | { type: 'start'; request: LaunchRequest } | { type: 'retry' } | { type: 'unsent' }
  | { type: 'launched'; machine: string; id: string } | { type: 'refused'; machine: string; message: string }
  | { type: 'timeout'; attempt: number } | { type: 'dropped'; machine: string };
export interface Step { flow: Flow; send?: LaunchRequest; launched?: string }

/** Null-prototype maps: a machine named `constructor` or `__proto__` owes nothing until it really owes. */
const debts = (src: Record<string, number>): Record<string, number> => Object.assign(Object.create(null), src);
const owe = (late: Record<string, number>, machine: string) => { const next = debts(late); next[machine] = (late[machine] ?? 0) + 1; return next; };
function settle(late: Record<string, number>, machine: string, all = false): Record<string, number> {
  const next = debts(late);
  const left = all ? 0 : (late[machine] ?? 0) - 1;
  if (left > 0) next[machine] = left; else delete next[machine];
  return next;
}
const send = (f: Flow, request: LaunchRequest): Step =>
  ({ flow: { ...f, stage: 'starting', request, error: null, attempt: f.attempt + 1 }, send: request });

/** One event at a time; `flow` is the same object when nothing changes. */
export function step(f: Flow, e: FlowEvent): Step {
  switch (e.type) {
    case 'open': return { flow: f.stage === 'closed' ? { ...f, stage: 'form', request: null, error: null } : f };
    case 'close': {
      if (f.stage === 'closed') return { flow: f };
      // Cancelling a start closes the screen; the daemon may still answer, and that answer is skipped (spec §9.2).
      const late = f.stage === 'starting' && f.request ? owe(f.late, f.request.machine) : f.late;
      return { flow: { ...f, stage: 'closed', request: null, error: null, late } };
    }
    case 'edit': return { flow: f.stage === 'failed' ? { ...f, stage: 'form', error: null } : f };
    case 'start': return f.stage === 'form' ? send(f, e.request) : { flow: f };
    case 'retry': return f.stage === 'failed' && f.request ? send(f, f.request) : { flow: f };
    case 'unsent': return { flow: f.stage === 'starting' ? { ...f, stage: 'failed', error: { kind: 'offline' } } : f };
    case 'launched':
    case 'refused': {
      if (f.late[e.machine]) return { flow: { ...f, late: settle(f.late, e.machine) } };
      if (f.stage !== 'starting' || f.request?.machine !== e.machine) return { flow: f };
      if (e.type === 'launched') return { flow: { ...f, stage: 'closed', request: null, error: null }, launched: e.id };
      return { flow: { ...f, stage: 'failed', error: { kind: 'daemon', message: e.message } } };
    }
    case 'timeout':
      if (f.stage !== 'starting' || e.attempt !== f.attempt || !f.request) return { flow: f };
      return { flow: { ...f, stage: 'failed', error: { kind: 'timeout' }, late: owe(f.late, f.request.machine) } };
    case 'dropped': {
      // The daemon answers on the socket that asked: once it is gone, nothing more will come from that attempt.
      const owed = e.machine in f.late;
      const lost = f.stage === 'starting' && f.request?.machine === e.machine;
      if (!owed && !lost) return { flow: f };
      const late = owed ? settle(f.late, e.machine, true) : f.late;
      return { flow: lost ? { ...f, late, stage: 'failed', error: { kind: 'lost' } } : { ...f, late } };
    }
  }
}
