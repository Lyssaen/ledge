import { describe, expect, it } from 'vitest';
import { PushPayloadSchema, type Escalation } from '@ledge/protocol';
import { decidedPush, escalationPush } from '../src/mobile/push/triggers.js';
const escalation: Escalation = { id: 'q1', machine: 'local', source: 'operator', from: '@lead', intent: 'decision', summary: 'Choisir /home/private/file', questions: [{ id: 'question', question: 'Base ?', options: [{ id: 'sqlite', label: 'SQLite' }, { id: 'postgres', label: 'Postgres' }] }], createdAt: '2026-11-01T10:00:00.000Z', state: 'grace' };
describe('OpenRig notifications', () => {
  it('groups Ledge decisions into one quiet notification payload', () => {
    expect(PushPayloadSchema.parse(decidedPush(3, 2))).toMatchObject({ kind: 'decided', count: 3, tag: 'ledge-decided', badge: 2 });
  });
  it('waits until grace ends and sends only once while pending', () => {
    expect(escalationPush(undefined, escalation, 1)).toBeNull();
    const pending = { ...escalation, state: 'pending' as const };
    const push = escalationPush(escalation, pending, 1)!;
    expect(PushPayloadSchema.parse(push)).toEqual(push); expect(push).toMatchObject({ kind: 'escalation', actions: [{ qId: 'question', optId: 'sqlite' }, { qId: 'question', optId: 'postgres' }] });
    expect(push.body).not.toContain('/home/private'); expect(escalationPush(pending, pending, 1)).toBeNull();
  });
  it('offers no immediate actions for multiple questions', () => {
    const pending = { ...escalation, state: 'pending' as const, questions: [...escalation.questions, escalation.questions[0]!] };
    expect(escalationPush(undefined, pending, 1)?.actions).toBeUndefined();
  });
});

describe('grouped decisions', () => {
  it('groups three new Ledge decisions in one minute and ignores human choices', async () => {
    const { vi } = await import('vitest'); const { createDecisionBatch } = await import('../src/mobile/push/decisions.js');
    vi.useFakeTimers();
    try {
      const decisions: import('@ledge/protocol').LedgeDecision[] = []; const sent: number[] = [];
      const batch = createDecisionBatch(() => decisions, n => sent.push(n));
      for (let i = 0; i < 3; i++) { decisions.push({ id: `d${i}`, escalationId: `e${i}`, by: 'ledge', summary: 'ok', answers: {}, at: '2026-11-01T10:00:00.000Z' }); batch.changed(); }
      decisions.push({ id: 'human', escalationId: 'eh', by: 'user', summary: 'ok', answers: {}, at: '2026-11-01T10:00:00.000Z' }); batch.changed();
      expect(sent).toEqual([]); vi.advanceTimersByTime(60_000); expect(sent).toEqual([3]); batch.close();
    } finally { vi.useRealTimers(); }
  });
});
