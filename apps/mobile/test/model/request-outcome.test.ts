import { describe, expect, it } from 'vitest';
import type { PhonePending } from '@ledge/protocol';
import { outcomeFor } from '../../src/model/requestOutcome';
import type { Op, OpPhase } from '../../src/state/operations';
import { pending, session } from './fixtures';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const target = { sessionId: 'a', key: 'p1' };
const decide = (op: string, phase: OpPhase, extra: Partial<Op> = {}): Op =>
  ({ op, message: { type: 'session.decide', op, id: 'a', decision: 'deny', expect: { key: 'p1', kind: 'permission', text: 'pnpm test' } }, phase, at: '2026-10-14T10:00:00.000Z', ...extra });
const ops = (...list: Op[]) => Object.fromEntries(list.map(o => [o.op, o]));
const sessions = (p?: PhonePending) => [session('a', { state: 'waiting_permission', ...(p ? { pending: p } : {}) })];

describe('outcomeFor', () => {
  it('is idle for the request still waiting, with nothing sent', () => {
    expect(outcomeFor(target, sessions(pending()), {})).toEqual({ kind: 'idle' });
  });
  it('is handled elsewhere once the request is gone, or another took its place', () => {
    expect(outcomeFor(target, sessions(), {})).toEqual({ kind: 'handledElsewhere' });
    expect(outcomeFor(target, sessions(pending({ key: 'p2' })), {})).toEqual({ kind: 'handledElsewhere' });
  });
  it('follows this phone\'s operation on that request', () => {
    expect(outcomeFor(target, sessions(pending()), ops(decide(A, 'sending')))).toEqual({ kind: 'sending' });
    expect(outcomeFor(target, sessions(pending()), ops(decide(A, 'uncertain')))).toEqual({ kind: 'uncertain' });
    expect(outcomeFor(target, sessions(), ops(decide(A, 'applied')))).toEqual({ kind: 'applied', decision: 'deny' });
    expect(outcomeFor(target, sessions(pending()), ops(decide(A, 'rejected', { reason: 'confirm_required' })))).toEqual({ kind: 'rejected', reason: 'confirm_required' });
    expect(outcomeFor(target, sessions(pending()), ops(decide(A, 'failed')))).toEqual({ kind: 'failed', reason: 'invalid' });
  });
  it('an applied operation wins over a later one', () => {
    expect(outcomeFor(target, sessions(), ops(decide(A, 'applied'), decide(B, 'rejected', { reason: 'stale', at: '2026-10-14T10:01:00.000Z' })))).toMatchObject({ kind: 'applied' });
  });
  it('an answer carries its text', () => {
    const answer: Op = { op: A, message: { type: 'session.reply', op: A, id: 'a', text: 'Sombre', expect: { key: 'p1', kind: 'question', text: '?' } }, phase: 'applied', at: '2026-10-14T10:00:00.000Z' };
    expect(outcomeFor(target, sessions(), ops(answer))).toEqual({ kind: 'applied', answer: 'Sombre' });
  });
  it('a stale refusal shows the new request when there is one', () => {
    const stale = decide(A, 'rejected', { reason: 'stale' });
    expect(outcomeFor(target, sessions(pending({ key: 'p2' })), ops(stale))).toEqual({ kind: 'changed' });
    expect(outcomeFor(target, sessions(), ops(stale))).toEqual({ kind: 'handledElsewhere' });
    expect(outcomeFor(target, sessions(pending()), ops(stale))).toEqual({ kind: 'rejected', reason: 'stale' });
  });
});
