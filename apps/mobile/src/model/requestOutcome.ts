import type { OperationReason, Session } from '@ledge/protocol';
import type { OpState } from './operations';

export type Outcome =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'applied'; decision?: 'accept' | 'deny'; answer?: string }
  | { kind: 'rejected'; reason: OperationReason }
  | { kind: 'failed'; reason: OperationReason }
  | { kind: 'uncertain' }
  | { kind: 'unknown'; stillPending: boolean }
  | { kind: 'handledElsewhere' }
  | { kind: 'changed' };

export interface OutcomeTarget { sessionId: string; pendingId: string; pendingVersion?: number }

/** What the phone can honestly say about one request: its own operation first, else what the PC shows now. */
export function outcomeFor(target: OutcomeTarget, sessions: Session[], ops: Record<string, OpState>): Outcome {
  const pending = sessions.find(s => s.id === target.sessionId)?.pending;
  const same = pending?.id === target.pendingId;
  const sameVersion = same && (target.pendingVersion === undefined || (pending?.version ?? 1) === target.pendingVersion);
  const mine = Object.values(ops)
    .filter(o => o.sessionId === target.sessionId && o.pendingId === target.pendingId && (target.pendingVersion === undefined || o.pendingVersion === undefined || o.pendingVersion === target.pendingVersion))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const o = mine.find(x => x.phase === 'applied') ?? mine[mine.length - 1];
  if (o) {
    switch (o.phase) {
      case 'sending': case 'received': return { kind: 'sending' };
      case 'applied': return { kind: 'applied', ...(o.decision ? { decision: o.decision } : {}), ...(o.text !== undefined && o.kind !== 'decide' ? { answer: o.text } : {}) };
      case 'rejected': if (!same && (o.reason === 'stale' || o.reason === 'changed')) return { kind: 'handledElsewhere' }; return { kind: 'rejected', reason: o.reason ?? 'invalid' };
      case 'failed': return { kind: 'failed', reason: o.reason ?? 'invalid' };
      case 'uncertain': return { kind: 'uncertain' };
      case 'unknown': return { kind: 'unknown', stillPending: sameVersion };
    }
  }
  if (!same) return { kind: 'handledElsewhere' };
  return sameVersion ? { kind: 'idle' } : { kind: 'changed' };
}
