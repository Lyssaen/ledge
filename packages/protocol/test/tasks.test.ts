import { describe, it, expect } from 'vitest';
import { decisionEscalationId, decisionMirrored, isDecisionEscalation, TaskSchema, ThreadItemSchema, transmissions, type Task } from '../src/index.js';

const A = '2026-10-26T10:00:00.000Z', B = '2026-10-26T10:00:01.000Z', C = '2026-10-26T10:00:02.000Z';
const task = (over: Partial<Task>): Task => ({
  id: 't1', title: 'Relire', giver: 'max', giverName: 'Max', owner: 'nova', ownerName: 'Nova', state: 'open', at: A, updatedAt: A, log: [], ...over
});

describe('task transmissions', () => {
  it('lists the transmissions of a task, in log order, with their log index', () => {
    const t = task({ log: [
      { at: A, by: 'Max', what: 'confiée à Nova', op: 'give', from: 'max', to: 'nova', fromName: 'Max', toName: 'Nova' },
      { at: B, by: 'Nova', what: 'prise', op: 'take' },
      { at: C, by: 'Nova', what: 'passée à Pim : relis', op: 'pass', from: 'nova', to: 'pim', fromName: 'Nova', toName: 'Pim', note: 'relis' }
    ] });
    expect(transmissions(t)).toEqual([
      { index: 0, at: A, op: 'give', from: 'max', to: 'nova', fromName: 'Max', toName: 'Nova' },
      { index: 2, at: C, op: 'pass', from: 'nova', to: 'pim', fromName: 'Nova', toName: 'Pim', note: 'relis' }
    ]);
  });
  it('finds none in a log written before transmissions existed', () => {
    const old = task({ log: [{ at: A, by: 'Max', what: 'confiée à Nova' }] });
    expect(transmissions(old)).toEqual([]);
    expect(TaskSchema.parse(old).log[0]).toEqual({ at: A, by: 'Max', what: 'confiée à Nova' });
  });
  it('parses a notice carrying taskOp and outgoing', () => {
    const n = { kind: 'notice', id: 'task-t1-0', at: A, turn: 3, notice: 'other', task: 't1', taskOp: 'give', outgoing: true, name: 'Nova', text: 'x' };
    expect(ThreadItemSchema.parse(n)).toMatchObject({ taskOp: 'give', outgoing: true });
  });
});

describe('decisionMirrored', () => {
  it('is true when the task\'s escalation task-<id> exists, false for another one or none', () => {
    const t = task({ id: 't5d6e7f', owner: 'ledge' });
    expect(decisionEscalationId(t.id)).toBe('task-t5d6e7f');
    expect(decisionMirrored(t, [{ id: 'ask-1' }, { id: 'task-t5d6e7f' }])).toBe(true);
    expect(decisionMirrored(t, [{ id: 'task-t000000' }, { id: 'ask-t5d6e7f' }])).toBe(false);
    expect(decisionMirrored(t, [])).toBe(false);
    expect(isDecisionEscalation({ id: 'task-t5d6e7f' })).toBe(true); expect(isDecisionEscalation({ id: 'ask-1' })).toBe(false);
  });
});
