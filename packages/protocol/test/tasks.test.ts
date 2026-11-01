import { describe, it, expect } from 'vitest';
import { TaskSchema, ThreadItemSchema, transmissions, type Task } from '../src/index.js';

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
