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
