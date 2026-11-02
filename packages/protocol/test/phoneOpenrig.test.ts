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
    expect(PhoneRigSchema.safeParse({ ...rig, engine: 'ledge' }).success).toBe(true);
    expect(PhoneRigSchema.safeParse({ ...rig, engine: 'openrig' }).success).toBe(true);
    expect(PhoneRigSchema.safeParse({ ...rig, engine: 'other' }).success).toBe(false);
  });
  it('reads a rig record with fields it does not know (a newer daemon) and keeps none of them (lot F M1)', () => {
    const seat = { ref: 'dev@team-a1b2', address: '@dev', name: 'dev', runtime: 'claude', state: 'working', future: 1 };
    const launch = { planId: 'p', goal: 'g', lead: '@lead', startedAt: at, future: 1 };
    const parsed = PhoneRigSchema.parse({ ...rig, cwd: '/private', machine: 'remote', future: { x: 1 }, seats: [seat], launch });
    expect(parsed).not.toHaveProperty('cwd');
    expect(parsed).not.toHaveProperty('machine');
    expect(parsed).not.toHaveProperty('future');
    expect(parsed.seats[0]).not.toHaveProperty('future');
    expect(parsed.launch).not.toHaveProperty('future');
    const caps = Object.fromEntries(['claude', 'codex', 'cursor', 'omp'].map(k => [k, { freeTextAnswer: false, chooseOption: false, viewTerminal: false }]));
    const snap = PhoneServerMessageSchema.safeParse({ type: 'snapshot', protocol: 1, sessions: [], capabilities: caps, daemon: { version: '1', name: 'pc', openrig: true }, rigs: [{ ...rig, future: 1, seats: [seat] }] });
    expect(snap.success).toBe(true);
    expect(PhoneServerMessageSchema.safeParse({ type: 'rig.updated', rig: { ...rig, future: 1 } }).success).toBe(true);
    // Operations the phone sends stay strict.
    expect(PhoneClientMessageSchema.safeParse({ type: 'rig.act', op, key: 'key', verb: 'down', future: 1 }).success).toBe(false);
    expect(PhoneClientMessageSchema.safeParse({ type: 'rig.prepare', op, goal: 'go', project: null, future: 1 }).success).toBe(false);
  });
  it('carries a Ledge team\'s id on its rig, optionally (lot F I4)', () => {
    expect(PhoneRigSchema.parse({ ...rig, engine: 'ledge', teamId: 'team-a1b2' }).teamId).toBe('team-a1b2');
    expect(PhoneRigSchema.parse(rig).teamId).toBeUndefined();
  });
  it('says the teams engine in force in the snapshot\'s daemon, optionally (lot F I2)', () => {
    const caps = Object.fromEntries(['claude', 'codex', 'cursor', 'omp'].map(k => [k, { freeTextAnswer: false, chooseOption: false, viewTerminal: false }]));
    const snap = (daemon: object) => PhoneServerMessageSchema.safeParse({ type: 'snapshot', protocol: 1, sessions: [], capabilities: caps, daemon: { version: '1', name: 'pc', ...daemon } });
    for (const teamsEngine of ['ledge', 'openrig']) {
      const r = snap({ teamsEngine });
      expect(r.success && r.data.type === 'snapshot' && r.data.daemon.teamsEngine).toBe(teamsEngine);
    }
    expect(snap({}).success).toBe(true);
    expect(snap({ teamsEngine: 'other' }).success).toBe(false);
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
  it('validates the read-only receipt request and response', () => {
    const answer = { type: 'escalation.answer', op, id: 'q1', answers: { q1: 'a' } };
    expect(PhoneClientMessageSchema.safeParse({ type: 'answer.receipt.request', answer }).success).toBe(true);
    expect(PhoneClientMessageSchema.safeParse({ type: 'answer.receipt.request', answer: { ...answer, assertion: {} } }).success).toBe(false);
    expect(PhoneServerMessageSchema.safeParse({ type: 'answer.receipt', op, status: 'applied' }).success).toBe(true);
    expect(PhoneServerMessageSchema.safeParse({ type: 'answer.receipt', op, status: 'invented' }).success).toBe(false);
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
