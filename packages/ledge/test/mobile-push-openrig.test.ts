import { describe, expect, it } from 'vitest';
import { PushPayloadSchema, type Escalation } from '@ledge/protocol';
import { escalationPush } from '../src/mobile/push/triggers.js';
const escalation: Escalation = { id: 'q1', machine: 'local', source: 'operator', from: '@lead', intent: 'decision', summary: 'Choisir /home/private/file', questions: [{ id: 'question', question: 'Base ?', options: [{ id: 'sqlite', label: 'SQLite' }, { id: 'postgres', label: 'Postgres' }] }], createdAt: '2026-11-01T10:00:00.000Z', state: 'grace' };
describe('OpenRig notifications', () => {
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
