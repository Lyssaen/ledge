import { describe, expect, it } from 'vitest';
import type { Escalation, Rig } from '@ledge/protocol';
import { PhoneRigSchema, PhoneEscalationSchema } from '@ledge/protocol';
import { rigKey, toPhoneRig, toPhoneEscalation } from '../src/mobile/orchestrator.js';
const rig: Rig = { id: 'same', machine: 'local', name: 'starter', cwd: '/home/private/repo', projectId: null, offProject: true, lifecycle: 'running', kernel: false, repos: [{ path: '/home/private/repo', name: 'repo', modified: 0 }], seats: [{ ref: 'dev@starter', address: '@dev', name: 'dev', runtime: 'codex', state: 'attention' }] };
const esc: Escalation = { id: 'q', machine: 'local', rigId: 'same', source: 'rig', from: 'dev@starter', intent: 'decision', summary: 'Choose', detail: 'Inspect /home/private/secret', evidenceRef: '/private', createdAt: '2026-11-01T10:00:00.000Z', questions: [{ id: 'a', question: 'Which?', options: [{ id: 'x', label: 'x' }, { id: 'y', label: 'y' }] }], state: 'answered', answer: { by: 'user', answers: { a: 'x' }, at: '2026-11-01T10:01:00.000Z', delivery: 'queued' } };
describe('phone OpenRig projections', () => {
 it('uses opaque machine-scoped rig keys', () => { expect(rigKey('local', 'same')).not.toBe(rigKey('remote', 'same')); expect(rigKey('local', 'same')).toMatch(/^[a-f0-9]{16}$/); });
 it('omits machine, cwd and repository paths and keeps attention', () => { const p = toPhoneRig(rig, () => undefined); expect(PhoneRigSchema.safeParse(p).success).toBe(true); expect(JSON.stringify(p)).not.toMatch(/machine|cwd|\/home\/private/); expect(p.seats[0]?.state).toBe('attention'); });
 it('removes routing, sanitises paths and preserves queued delivery', () => { const p = toPhoneEscalation(esc, [], [rig]); expect(PhoneEscalationSchema.safeParse(p).success).toBe(true); expect(JSON.stringify(p)).not.toMatch(/machine|evidenceRef|\/home\/private/); expect(p.answer?.delivery).toBe('queued'); });
});

it('does not silently change an id the phone would later send back', () => {
  expect(() => toPhoneEscalation({ ...esc, id: 'q'.repeat(121) }, [], [rig])).toThrow(/unsafe phone identifier/);
});

it('maps only opaque rig keys and never accepts an unknown one', async () => {
  const { fromPhone } = await import('../src/mobile/orchestrator.js');
  const keys = new Map([[rigKey('local', 'same'), { machine: 'local', rigId: 'same' }], [rigKey('remote', 'same'), { machine: 'remote', rigId: 'same' }]]);
  const op = 'a931d7a0-0098-432a-90c8-57e54ab8ed1a';
  expect(fromPhone({ type: 'rig.act', op, key: rigKey('remote', 'same'), verb: 'down' }, keys)).toMatchObject({ type: 'rig.act', machine: 'remote', rigId: 'same' });
  expect(fromPhone({ type: 'rig.act', op, key: 'unknown', verb: 'down' }, keys)).toEqual({ refused: 'invalid' });
});

it('omits absolute paths from plans and thread text', async () => {
  const { toPhonePlan, toPhoneThreadItem } = await import('../src/mobile/orchestrator.js');
  const plan = toPhonePlan({ id: 'p', machine: 'local', spec: 'starter', goal: 'Inspect /home/owner/private', where: { kind: 'project', projectId: 'p', repo: '/home/owner/private', branch: 'main', copy: true }, cwd: '/home/owner/private', seats: [], writes: ['/home/owner/private/AGENTS.md'], command: 'rig up /home/owner/private', required: false }, () => 'Project');
  const item = toPhoneThreadItem({ kind: 'user', id: 'u', at: '2026-11-01T10:00:00.000Z', text: 'Inspect /home/owner/private' }, { rigs: [], rules: [], decisions: [], escalation: () => undefined, exchanges: () => null });
  expect(JSON.stringify({ plan, item })).not.toMatch(/\/home\/owner|cwd|machine|command|repo/);
});
