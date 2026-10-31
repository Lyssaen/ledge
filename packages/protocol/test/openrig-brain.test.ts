import { describe, it, expect } from 'vitest';
import { SessionSchema, BrainStatusSchema, ClientMessageSchema, ServerMessageSchema, EscalationSchema, LedgeDecisionSchema,
  BRAIN_OPS, BRAIN_RESULT_CODES, MANDATE_CATEGORY_TAGS, MandateCategorySchema, ChatTurnSchema } from '../src/index.js';

const now = '2026-10-30T10:00:00.000Z';
const base = { id: '7f3a', name: 'Ledge', tool: 'claude', cwd: '/w', project: 'w', title: 'Ledge', tmuxSession: 'ledge-7f3a', state: 'idle', helpers: [], startedAt: now, lastActivityAt: now, source: 'launcher' };

describe('brain contract', () => {
  it('a session may be the brain', () => {
    expect(SessionSchema.parse({ ...base, brain: true }).brain).toBe(true);
    expect(SessionSchema.safeParse({ ...base, brain: false }).success).toBe(false);
  });
  it('brain status says whether it was ever enabled', () => {
    expect(BrainStatusSchema.parse({ state: 'off', tool: 'claude', enabled: null }).enabled).toBeNull();
    expect(BrainStatusSchema.parse({ state: 'on', tool: 'claude' }).enabled).toBeUndefined();
    expect(BrainStatusSchema.parse({ state: 'down', tool: 'codex', enabled: true, restarts: 3, reason: 'x' }).restarts).toBe(3);
    expect(BrainStatusSchema.safeParse({ state: 'on', tool: 'bogus' }).success).toBe(false);
    expect(BrainStatusSchema.safeParse({ state: 'on', tool: 'claude', restarts: -1 }).success).toBe(false);
  });
  it('brain.cmd carries op and args', () => {
    expect(ClientMessageSchema.parse({ type: 'brain.cmd', rid: 'r', by: 'brain', key: 'k', op: 'decide', args: ['qi-1', '--answer', 'q1=merge'] })).toBeTruthy();
    expect(ClientMessageSchema.safeParse({ type: 'brain.cmd', rid: 'r', by: 'b', key: 'k', op: 'say', args: Array(41).fill('a') }).success).toBe(false);
  });
  it('an unknown op is rejected', () => {
    expect(() => ClientMessageSchema.parse({ type: 'brain.cmd', rid: 'r', by: 'b', key: 'k', op: 'rm', args: [] })).toThrow();
    expect(BRAIN_OPS).toEqual(['say', 'decide', 'ask', 'rig', 'send', 'propose', 'remember', 'who', 'rigs', 'escalations', 'rules']);
  });
  it('brain.result codes', () => {
    expect(BRAIN_RESULT_CODES).toEqual(['not_brain', 'identity', 'mandate', 'grace', 'invalid', 'refused', 'already_answered', 'failed', 'unreachable', 'openrig_down']);
    for (const code of BRAIN_RESULT_CODES) expect(ServerMessageSchema.parse({ type: 'brain.result', rid: 'r', ok: false, line: 'x', code }).type).toBe('brain.result');
    expect(ServerMessageSchema.parse({ type: 'brain.result', rid: 'r', ok: true, line: 'ok' })).toBeTruthy();
    expect(ServerMessageSchema.safeParse({ type: 'brain.result', rid: 'r', ok: false, line: 'x', code: 'nope' }).success).toBe(false);
  });
  it('brain.set takes first and a real tool', () => {
    expect(ClientMessageSchema.parse({ type: 'brain.set', rid: 'r', enabled: true, tool: 'codex', first: true })).toMatchObject({ first: true });
    expect(ClientMessageSchema.safeParse({ type: 'brain.set', rid: 'r', enabled: true, first: false }).success).toBe(false);
    expect(ClientMessageSchema.safeParse({ type: 'brain.set', rid: 'r', enabled: true, tool: 'bogus' }).success).toBe(false);
  });
  it('escalation carries the decision being corrected', () => {
    const e = { id: 'q1', source: 'rig', machine: 'local', from: 'a@b', intent: 'decision', summary: 's', questions: [], createdAt: now, state: 'pending', correcting: 'd1' };
    expect(EscalationSchema.parse(e).correcting).toBe('d1');
  });
  it('a decision names its seat and rig', () => {
    const d = LedgeDecisionSchema.parse({ id: 'd', escalationId: 'q', by: 'ledge', category: 'git', summary: 's', answers: {}, at: now, from: 'dev@r', rigId: 'r1' });
    expect(d.from).toBe('dev@r'); expect(d.rigId).toBe('r1');
  });
  it('category tags cover every category', () => {
    expect(Object.keys(MANDATE_CATEGORY_TAGS).sort()).toEqual([...MandateCategorySchema.options].sort());
    expect(MANDATE_CATEGORY_TAGS.git).toEqual(['merge', 'branches']);
    expect(MANDATE_CATEGORY_TAGS.critical).toEqual(['données', 'sécurité', 'suppression', 'coûts']);
  });
  it('a chat turn may carry a rig launch card (brain, lot 7)', () => {
    const turn = { qid: 'b1', question: '', askedAt: now, steps: [], answer: 'Je propose…', answeredAt: now };
    expect(ChatTurnSchema.parse({ ...turn, rigLaunch: { goal: 'G', spec: 'factory', project: 'ledge', machine: 'local' } }).rigLaunch).toEqual({ goal: 'G', spec: 'factory', project: 'ledge', machine: 'local' });
    expect(ChatTurnSchema.safeParse({ ...turn, rigLaunch: { goal: '' } }).success).toBe(false);
    expect(ChatTurnSchema.safeParse({ ...turn, rigLaunch: { spec: 'factory' } }).success).toBe(false);
  });
});
