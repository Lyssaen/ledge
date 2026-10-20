import type { OperationReason, PhoneSession } from '@ledge/protocol';
import { expectKey, type Op } from '../state/operations';

export type Outcome =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'applied'; decision?: 'accept' | 'deny' | 'always'; answer?: string }
  | { kind: 'rejected'; reason: OperationReason }
  | { kind: 'failed'; reason: OperationReason }
  | { kind: 'uncertain' }
  | { kind: 'handledElsewhere' }
  | { kind: 'changed' };

export interface OutcomeTarget { sessionId: string; key: string }

/** What the phone can honestly say about one request: its own operation first, else what the PC shows now. */
export function outcomeFor(target: OutcomeTarget, sessions: PhoneSession[], ops: Record<string, Op>): Outcome {
  const pending = sessions.find(s => s.id === target.sessionId)?.pending;
  const same = pending?.key === target.key;
  const mine = Object.values(ops)
    .filter(o => o.message.id === target.sessionId && expectKey(o.message) === target.key)
    .sort((a, b) => a.at.localeCompare(b.at));
  const o = mine.find(x => x.phase === 'applied') ?? mine[mine.length - 1];
  if (o) {
    const m = o.message;
    switch (o.phase) {
      case 'sending': return { kind: 'sending' };
      case 'uncertain': return { kind: 'uncertain' };
      case 'applied': return {
        kind: 'applied',
        ...(m.type === 'session.decide' ? { decision: m.decision } : {}),
        ...(m.type === 'session.reply' ? { answer: m.text } : {})
      };
      case 'rejected':
        // Another request took its place: show that one, or say this one was handled.
        if (o.reason === 'stale' && !same) return pending?.key ? { kind: 'changed' } : { kind: 'handledElsewhere' };
        return { kind: 'rejected', reason: o.reason ?? 'invalid' };
      case 'failed': return { kind: 'failed', reason: o.reason ?? 'invalid' };
    }
  }
  return same ? { kind: 'idle' } : { kind: 'handledElsewhere' };
}
