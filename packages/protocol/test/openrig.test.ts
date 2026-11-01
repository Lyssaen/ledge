import { describe, it, expect } from 'vitest';
import * as P from '../src/index.js';
import { DaemonInfoSchema, OpenRigStatusSchema, RigSpecInfoSchema, ALWAYS_USER, EXCHANGES_MAX, EscalationSchema, RIG_RESULT_CODES, SessionSchema, parseClientMessage, parseServerMessage } from '../src/index.js';

const now = '2026-10-30T10:00:00.000Z';
const seat = { ref: 'dev-build@starter', address: '@build', name: 'build', runtime: 'claude-code', state: 'working' as const };
const rig = { id: 'r1', name: 'starter', machine: 'local', cwd: '/w', projectId: null, offProject: true, lifecycle: 'running' as const, kernel: false, seats: [seat], repos: [] };
const opt = (id: string, recommended?: boolean) => ({ id, label: id, ...(recommended ? { recommended } : {}) });
const esc = (questions: unknown[]) => ({ id: 'q1', source: 'rig', machine: 'local', rigId: 'r1', from: 'dev-build@starter', intent: 'decision', summary: 's', questions, createdAt: now, state: 'pending' });
const exchange = { id: 'e1', machine: 'local', rigId: 'r1', from: '@a', to: '@b', kind: 'message', text: 'hi', at: now };

describe('openrig contract', () => {
  it('EscalationSchema takes 1 question with 3 options, refuses 5 questions and a 1-option question', () => {
    const q = (i: number, n = 3) => ({ id: `k${i}`, question: '?', options: [opt('a', true), opt('b'), opt('c')].slice(0, n) });
    expect(EscalationSchema.safeParse(esc([q(1)])).success).toBe(true);
    expect(EscalationSchema.safeParse(esc([1, 2, 3, 4, 5].map((i) => q(i)))).success).toBe(false);
    expect(EscalationSchema.safeParse(esc([q(1, 1)])).success).toBe(false);
  });
  it('ALWAYS_USER and constants', () => {
    expect(ALWAYS_USER).toEqual(['design', 'architecture', 'critical']);
    expect(EXCHANGES_MAX).toBe(200);
    expect(RIG_RESULT_CODES).toEqual(['rig_managed', 'already_answered', 'openrig_down', 'unsupported', 'mandate', 'unreachable', 'failed', 'invalid']);
  });
  it('server messages parse', () => {
    const e = esc([]);
    for (const m of [
      { type: 'rig.snapshot', machine: 'local', rigs: [rig] },
      { type: 'openrig.status', status: { machine: 'local', state: 'running', version: '0.6.14', human: 'registered' } },
      { type: 'rig.updated', rig }, { type: 'rig.removed', machine: 'local', rigId: 'r1' },
      { type: 'rig.exchange', exchange }, { type: 'rig.exchanges', machine: 'local', rigId: 'r1', items: [exchange] },
      { type: 'escalation.updated', escalation: e }, { type: 'escalation.removed', id: 'q1' },
      { type: 'rig.result', rid: 'x', ok: false, code: 'unreachable', reason: 'down' },
      { type: 'ledge.thread.item', item: { kind: 'ledge', id: 'i', at: now, text: 't' } },
      { type: 'ledge.thread.history', items: [], before: 'i1' },
      { type: 'decisions', items: [] }, { type: 'rules', items: [] }, { type: 'mandate', text: 't', path: '/p' },
      { type: 'brain.status', status: { state: 'on', tool: 'claude' } },
      { type: 'rig.plan', rid: 'x', plan: { id: 'p', machine: 'local', spec: 's', goal: 'g', where: { kind: 'off-project', name: 'n' }, cwd: '/w', seats: [{ address: '@a', runtime: 'claude-code', autonomy: 'auto' }], writes: [], command: 'rig up', required: false } },
    ]) expect(() => parseServerMessage(m), m.type).not.toThrow();
    expect(() => parseServerMessage({ type: 'rig.result', rid: 'x', ok: false, code: 'bogus' })).toThrow();
  });
  it('accepts a seat needing intervention in a rig update', () => {
    expect(parseServerMessage({ type: 'rig.updated', rig: { ...rig, seats: [{ ...seat, state: 'attention' }] } })).toMatchObject({ rig: { seats: [{ state: 'attention' }] } });
  });
  it('parses versioned remote brain delegation messages', () => {
    expect(parseClientMessage({ type: 'brain.delegate.claim', rid: 'r', id: 'e' })).toMatchObject({ type: 'brain.delegate.claim' });
    expect(parseClientMessage({ type: 'brain.delegate.decide', rid: 'r', id: 'e', token: 't', answers: { q: 'a' }, category: 'git' })).toMatchObject({ type: 'brain.delegate.decide' });
    expect(parseClientMessage({ type: 'brain.delegate.release', rid: 'r', id: 'e', token: 't', advice: 'Ask' })).toMatchObject({ type: 'brain.delegate.release' });
    expect(parseServerMessage({ type: 'brain.delegate.result', rid: 'r', ok: true, token: 't', graceUntil: now })).toMatchObject({ type: 'brain.delegate.result' });
    expect(() => parseClientMessage({ type: 'brain.delegate.decide', rid: 'r', id: 'e', token: '', answers: {}, category: 'git' })).toThrow();
  });
  it('rig.prepare caps the goal at 8000 characters', () => {
    const m = (goal: string) => ({ type: 'rig.prepare', rid: 'x', machine: 'local', spec: 's', goal, where: { kind: 'off-project', name: 'n' } });
    expect(parseClientMessage(m('g'.repeat(8000)))).toMatchObject({ type: 'rig.prepare' });
    expect(() => parseClientMessage(m('g'.repeat(8001)))).toThrow();
  });
  it('client messages parse', () => {
    for (const m of [
      { type: 'rig.exchanges.request', machine: 'local', rigId: 'r1' },
      { type: 'rig.act', rid: 'x', machine: 'local', rigId: 'r1', verb: 'restart' },
      { type: 'rig.prepare', rid: 'x', machine: 'local', spec: 's', goal: 'g', where: { kind: 'project', projectId: 'p', repo: 'r', branch: 'b', copy: false } },
      { type: 'rig.launch', rid: 'x', planId: 'p' }, { type: 'rig.adopt', rid: 'x', machine: 'local', rigId: 'r1', projectId: 'p' },
      { type: 'rig.send', rid: 'x', machine: 'local', seatRef: 'dev-build@starter', text: 'go' },
      { type: 'escalation.answer', rid: 'x', id: 'q1', answers: { text: 'ok' }, by: 'user' },
      { type: 'ledge.say', rid: 'x', text: 't' }, { type: 'ledge.thread.request' }, { type: 'ledge.thread.request', before: 'i1' },
      { type: 'mandate.update', rid: 'x', text: 't' }, { type: 'rule.set', rid: 'x', id: 'r', status: 'rejected' },
      { type: 'decision.revisit', rid: 'x', id: 'd' }, { type: 'category.escalate', rid: 'x', category: 'code' },
      { type: 'brain.set', rid: 'x', enabled: true, tool: 'claude' },
      { type: 'session.event', id: 's', event: { name: 'Stop', at: now, source: 'hook' }, openrig: { sessionName: 'dev-build@starter' } },
    ]) expect(() => parseClientMessage(m), m.type).not.toThrow();
  });
  it('session.event parses without openrig and refuses an empty sessionName', () => {
    const ev = { name: 'Stop', at: now, source: 'hook' };
    expect(parseClientMessage({ type: 'session.event', id: 's', event: ev }).type).toBe('session.event');
    expect(() => parseClientMessage({ type: 'session.event', id: 's', event: ev, openrig: { sessionName: '' } })).toThrow();
  });
  it('thread cursor is a plain item id', () => {
    expect(() => parseClientMessage({ type: 'ledge.thread.request', before: 'item-42' })).not.toThrow();
    expect(() => parseServerMessage({ type: 'ledge.thread.history', items: [], before: 'item-42' })).not.toThrow();
  });
  it('SessionSchema keeps rig; DaemonInfo takes openrig', () => {
    const rigRef = { machine: 'local', rigId: 'r1', rigName: 'starter', seat: 'dev-build@starter', pod: 'dev', member: 'build' };
    const base = { id: 's', name: 'n', tool: 'claude', cwd: '/', project: 'p', title: 't', source: 'hook_only', state: 'idle', tmuxSession: 't', startedAt: now, lastActivityAt: now };
    const parsed = SessionSchema.safeParse({ ...base, rig: rigRef });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data?.rig).toEqual(rigRef);
    expect(P.SessionRigSchema.parse(rigRef)).toEqual(rigRef);
    expect(P.DaemonInfoSchema.parse({ version: '1', install: 'npm', systemd: false, openrig: true }).openrig).toBe(true);
  });
  it('no export collision with decisions.ts / projects.ts', () => {
    expect(P.DecisionSchema.options).toEqual(['accept', 'deny', 'always']);
    expect(P.LedgeDecisionSchema).toBeDefined();
    expect(P.LedgeRuleSchema).toBeDefined();
  });
  it('RigSpecInfoSchema takes registry, refuses an unknown source; rig.specs messages parse', () => {
    expect(RigSpecInfoSchema.safeParse({ id: 'x', name: 'x', source: 'registry', seats: [] }).success).toBe(true);
    expect(RigSpecInfoSchema.safeParse({ id: 'x', name: 'x', source: 'other', seats: [] }).success).toBe(false);
    expect(parseClientMessage({ type: 'rig.specs.request', requestId: 'r', machineId: 'm' }).type).toBe('rig.specs.request');
    expect(parseServerMessage({ type: 'rig.specs', requestId: 'r', machine: 'local', specs: [{ id: 'x', name: 'x', source: 'builtin', seats: [{ address: '@a', member: 'a', pod: 'p', runtime: 'codex' }] }], error: 'unsupported' }).type).toBe('rig.specs');
  });
});

describe('lot 5 contract', () => {
  const L = { planId: 'p1', goal: 'ship it', lead: 'lead@starter', startedAt: '2026-10-31T10:00:00.000Z' };
  const RIG = { id: 'r1', name: 'starter', machine: 'local', cwd: '/tmp/x', projectId: null, offProject: true, lifecycle: 'running', kernel: false, seats: [], repos: [] };
  it('RigSchema accepts launch and keeps it', () => expect(P.RigSchema.parse({ ...RIG, launch: L }).launch).toEqual(L));
  it('RigSchema accepts a rig without launch', () => expect(P.RigSchema.parse(RIG).launch).toBeUndefined());
  it('RIG_NAME refuses ../x, a b, Factory, 41 chars and accepts a-b', () => {
    for (const bad of ['../x', 'a b', 'Factory', 'a'.repeat(41), '-a', '']) expect(P.RIG_NAME.test(bad), bad).toBe(false);
    for (const ok of ['a-b', 'a'.repeat(40), '0x']) expect(P.RIG_NAME.test(ok), ok).toBe(true);
  });
  it('lot 6 contract: unreachable state, answer delivery, openrigFleet', () => {
    expect(OpenRigStatusSchema.parse({ machine: 'ec2', state: 'unreachable' })).toEqual({ machine: 'ec2', state: 'unreachable' });
    expect(OpenRigStatusSchema.parse({ machine: 'ec2', state: 'absent', install: 'npm i' }).install).toBe('npm i');
    const answer = { by: 'user', answers: { q1: 'a' }, at: now, delivery: 'queued' };
    expect(EscalationSchema.parse({ ...esc([]), answer }).answer?.delivery).toBe('queued');
    expect(EscalationSchema.safeParse({ ...esc([]), answer: { ...answer, delivery: 'later' } }).success).toBe(false);
    expect(DaemonInfoSchema.parse({ version: '1', install: 'npm', systemd: true, openrigFleet: true }).openrigFleet).toBe(true);
  });
});
