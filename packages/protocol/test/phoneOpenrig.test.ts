import { describe, expect, it } from 'vitest';
import { PhoneRigSchema, PhoneEscalationSchema, PhoneThreadItemSchema, PhoneClientMessageSchema, PhoneServerMessageSchema, rigSubject, PHONE_PROTOCOL } from '../src/phone.js';
const op = 'a931d7a0-0098-432a-90c8-57e54ab8ed1a';
const at = '2026-11-01T10:00:00.000Z';
const rig = { key: '0123456789abcdef', name: 'starter', project: null, offProject: true, lifecycle: 'running', kernel: false, seats: [], repos: 0 };
const escalation = { id: 'q1', source: 'rig', from: 'build@starter', intent: 'decision', summary: 'Choisir', questions: [{ id: 'q1', question: 'Choisir', options: [{ id: 'a', label: 'A', recommended: true }, { id: 'b', label: 'B' }] }], createdAt: at, state: 'pending' };
describe('phone OpenRig protocol', () => {
  it('keeps protocol 1 and accepts a legacy snapshot', () => {
    expect(PHONE_PROTOCOL).toBe(1);
    expect(PhoneServerMessageSchema.safeParse({ type: 'snapshot', protocol: 1, sessions: [], capabilities: Object.fromEntries(['claude', 'codex', 'cursor', 'omp'].map(k => [k, { freeTextAnswer: false, chooseOption: false, viewTerminal: false }])), daemon: { version: '1', name: 'pc' } }).success).toBe(true);
  });
  it('rejects private rig paths and machine fields', () => {
    expect(PhoneRigSchema.safeParse(rig).success).toBe(true);
    expect(PhoneRigSchema.safeParse({ ...rig, cwd: '/private' }).success).toBe(false);
    expect(PhoneRigSchema.safeParse({ ...rig, machine: 'remote' }).success).toBe(false);
  });
  it('preserves queued delivery and rejects escalation routing details', () => {
    const queued = { ...escalation, state: 'answered', answer: { by: 'user', answers: { q1: 'a' }, at, delivery: 'queued' } };
    expect(PhoneEscalationSchema.parse(queued).answer?.delivery).toBe('queued');
    expect(PhoneEscalationSchema.safeParse({ ...queued, machine: 'remote', evidenceRef: '/secret' }).success).toBe(false);
  });
  it('does not accept assertions on answer or prepare, and limits rig actions', () => {
    expect(PhoneClientMessageSchema.safeParse({ type: 'escalation.answer', op, id: 'q1', answers: { q1: 'a' }, assertion: {} }).success).toBe(false);
    expect(PhoneClientMessageSchema.safeParse({ type: 'escalation.answer', op, id: 'q1', answers: { q1: 'a', q2: 'a', q3: 'a', q4: 'a', q5: 'a' } }).success).toBe(false);
    expect(PhoneClientMessageSchema.safeParse({ type: 'rig.prepare', op, goal: 'go', project: null, assertion: {} }).success).toBe(false);
    expect(PhoneClientMessageSchema.safeParse({ type: 'rig.act', op, key: 'key', verb: 'up' }).success).toBe(false);
    expect(PhoneClientMessageSchema.safeParse({ type: 'rig.act', op, key: 'key', verb: 'down' }).success).toBe(true);
  });
  it('binds the passkey subject to the precise rig operation', () => {
    expect(rigSubject({ type: 'rig.launch', op, planId: 'P' })).toBe('launch@P');
    expect(rigSubject({ type: 'rig.act', op, key: 'K', verb: 'restart', seatRef: 'build@starter' })).toBe('restart@K/build@starter');
  });
  it('limits thread exchange groups to twenty', () => {
    const item = { kind: 'exchanges', id: 'i', at, rigKey: 'K', rigName: 'r', from: at, to: at, count: 21, items: Array.from({ length: 21 }, (_, i) => ({ id: String(i), rigKey: 'K', from: 'a', to: 'b', kind: 'message', text: 'x', at })) };
    expect(PhoneThreadItemSchema.safeParse(item).success).toBe(false);
    expect(PhoneThreadItemSchema.safeParse({ ...item, items: item.items.slice(0, 3) }).success).toBe(true);
  });
});
