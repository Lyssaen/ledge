import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Escalation, LedgeThreadItem } from '@ledge/protocol';
import { createAnswers, type AnswerPort, type Answers } from '../src/daemon/openrig/answer.js';
import type { EscalationPatch } from '../src/daemon/openrig/bridge.js';
import { createMemory, type Memory } from '../src/daemon/brain/memory.js';
import { parseMandate, DEFAULT_MANDATE, type Mandate } from '../src/daemon/brain/mandate.js';
import type { BrainEvent } from '../src/daemon/brain/inbox.js';
import { createDeciding, GRACE_CAP_MS, type Deciding } from '../src/daemon/brain/decide.js';

const T0 = Date.parse('2026-10-31T10:00:00.000Z');
const esc = (over: Partial<Escalation> = {}): Escalation => ({ id: 'qi-1', source: 'rig', machine: 'local', rigId: 'r1', from: 'dev@factory', intent: 'decision',
  summary: 'On fusionne la branche ?', questions: [{ id: 'q1', question: 'Fusion', options: [{ id: 'merge', label: 'Merge' }, { id: 'rebase', label: 'Rebase' }] }],
  createdAt: new Date(T0).toISOString(), state: 'pending', ...over });

/** The bridge's escalation book: patches laid over, `undefined` keys removed. */
function book(list: Escalation[]) {
  const m = new Map(list.map(e => [e.id, e]));
  const patches: [string, EscalationPatch][] = [];
  return { m, patches,
    escalation: (id: string) => m.get(id),
    patchEscalation(id: string, p: EscalationPatch) {
      const cur = m.get(id); if (!cur) return undefined;
      const next = { ...cur, ...p } as Escalation;
      for (const k of Object.keys(p) as (keyof Escalation)[]) if (p[k] === undefined) delete next[k];
      m.set(id, next); patches.push([id, p]); return next;
    } };
}

let dir: string; let b: ReturnType<typeof book>; let replies: unknown[]; let answers: Answers; let answerCalls: unknown[][];
let thread: LedgeThreadItem[]; let inboxPushed: BrainEvent[]; let memory: Memory; let mandate: Mandate; let on: boolean; let deciding: Deciding;
let failApprove: number;
const fakeOpenRigReplies = () => replies;
const kinds = (t: LedgeThreadItem[]) => t.map(i => i.kind);

function make() {
  const port: AnswerPort = {
    escalation: b.escalation, patch: b.patchEscalation, status: () => ({ machine: 'local', state: 'running' }),
    cli: () => ({ queueCreate: async () => ({ ok: true, qitemId: 'reply' }) }),
    http: () => ({ async action(body) { if (failApprove > 0) { failApprove--; return { status: 500, json: { error: 'boom' } }; } replies.push(body); return { status: 200, json: { ok: true } }; } }),
    replyRow: () => undefined, setReplyRow: () => {},
  };
  const real = createAnswers({ port, path: { kind: 'approve-only' }, localMachine: 'local', now: () => new Date(Date.now()).toISOString() });
  answers = { answer: (...a) => { answerCalls.push(a); return real.answer(...a); }, correct: (...a) => real.correct(...a), onAnswered: fn => real.onAnswered(fn) };
  let n = 0;
  deciding = createDeciding({ escalations: b, answers,
    thread: { append: item => { const full = { ...item, id: `t${++n}`, at: new Date(Date.now()).toISOString() } as LedgeThreadItem; thread.push(full); return full; } },
    memory, inbox: { push: e => { inboxPushed.push(e); return true; } }, mandate: () => mandate, brainOn: () => on });
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(T0);
  dir = mkdtempSync(join(tmpdir(), 'ledge-decide-'));
  b = book([esc(), esc({ id: 'qi-up', intent: 'update', questions: [], summary: 'Tests verts' }),
    esc({ id: 'ask-3', source: 'ask', from: 'otto', questions: [], summary: 'On merge ?' }),
    esc({ id: 'qi-arch', summary: 'Quel stockage ?' }), esc({ id: 'qi-2' })]);
  replies = []; answerCalls = []; thread = []; inboxPushed = []; failApprove = 0; on = true;
  let u = 0;
  memory = createMemory({ dir, now: () => new Date(Date.now()).toISOString(), uuid: () => `d${++u}` });
  mandate = parseMandate(DEFAULT_MANDATE);
  make();
});
afterEach(() => { deciding.dispose(); vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }); });

describe('grace', () => {
  test('with the brain on, a new decision enters grace for 60 s', () => {
    deciding.arrived(b.escalation('qi-1')!);
    expect(b.escalation('qi-1')).toMatchObject({ state: 'grace', graceUntil: new Date(T0 + 60_000).toISOString() });
    expect(inboxPushed).toEqual([expect.objectContaining({ kind: 'escalation', escalation: expect.objectContaining({ id: 'qi-1', state: 'grace' }) })]);
  });

  test('with the brain off, it stays pending without advice', () => {
    on = false;
    deciding.arrived(b.escalation('qi-1')!);
    expect(b.escalation('qi-1')!.state).toBe('pending');
    expect(b.escalation('qi-1')!.graceUntil).toBeUndefined();
    expect(b.escalation('qi-1')!.advice).toBeUndefined();
    expect(inboxPushed).toEqual([]);
  });

  test('an update and a free ask are pushed for information and stay pending', () => {
    deciding.arrived(b.escalation('qi-up')!); deciding.arrived(b.escalation('ask-3')!);
    expect(b.escalation('qi-up')!.state).toBe('pending'); expect(b.escalation('ask-3')!.state).toBe('pending');
    expect(inboxPushed.map(e => e.kind)).toEqual(['escalation', 'escalation']);
  });

  test('grace past 10 min without action falls back to pending', async () => {
    deciding.arrived(b.escalation('qi-1')!);
    await vi.advanceTimersByTimeAsync(GRACE_CAP_MS - 1);
    expect(b.escalation('qi-1')!.state).toBe('grace');
    await vi.advanceTimersByTimeAsync(1);
    expect(b.escalation('qi-1')!.state).toBe('pending');
    expect(b.escalation('qi-1')!.graceUntil).toBeUndefined();
  });

  test('release puts every grace back to pending', async () => {
    deciding.arrived(b.escalation('qi-1')!); deciding.arrived(b.escalation('qi-2')!);
    await deciding.decide('qi-1', { q1: 'merge' }, 'git', {});
    deciding.release('down');
    expect(b.escalation('qi-1')).toMatchObject({ state: 'pending' }); expect(b.escalation('qi-2')).toMatchObject({ state: 'pending' });
    expect(b.escalation('qi-1')!.graceUntil).toBeUndefined();
    await vi.advanceTimersByTimeAsync(GRACE_CAP_MS);
    expect(answerCalls).toHaveLength(0);   // the deferred decision was dropped
  });
});

describe('decide', () => {
  test('a decide before graceUntil is applied at graceUntil', async () => {
    deciding.arrived(b.escalation('qi-1')!);
    const r = await deciding.decide('qi-1', { q1: 'merge' }, 'git', { why: 'règle du 26/10' });
    expect(r.ok).toBe(true);
    expect(r.line).toMatch(/^Noté : je l'applique à \d\d:\d\d:\d\d si l'utilisateur n'a pas répondu\.$/); expect(answerCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(answerCalls).toEqual([['qi-1', { q1: 'merge' }, 'ledge', {}]]);
    expect(kinds(thread)).toContain('decided');
    const [d] = memory.decisions();
    expect(d).toMatchObject({ by: 'ledge', category: 'git', escalationId: 'qi-1', answers: { q1: 'merge' }, why: 'règle du 26/10', from: 'dev@factory', rigId: 'r1' });
    expect(thread.find(i => i.kind === 'decided')).toMatchObject({ decisionId: d!.id });
    // the cap timer is gone with the decision
    await vi.advanceTimersByTimeAsync(GRACE_CAP_MS);
    expect(b.escalation('qi-1')!.state).toBe('answered');
  });

  test('user answer during grace wins and drops the deferred decide', async () => {
    deciding.arrived(b.escalation('qi-1')!);
    await deciding.decide('qi-1', { q1: 'merge' }, 'git', {});
    await vi.advanceTimersByTimeAsync(59_000);
    await answers.answer('qi-1', { q1: 'rebase' }, 'user');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fakeOpenRigReplies()).toHaveLength(1);
    expect(inboxPushed.at(-1)).toMatchObject({ kind: 'answered' });
    expect(memory.decisions()).toEqual([expect.objectContaining({ by: 'user', category: 'code', answers: { q1: 'rebase' } })]);
  });

  test('a decide after graceUntil is applied at once, with its rule', async () => {
    deciding.arrived(b.escalation('qi-1')!);
    await vi.advanceTimersByTimeAsync(61_000);
    const r = await deciding.decide('qi-1', { q1: 'merge' }, 'git', { rule: 'r1' });
    expect(r.ok).toBe(true);
    expect(answerCalls).toEqual([['qi-1', { q1: 'merge' }, 'ledge', { rule: 'r1' }]]);
    expect(memory.decisions()[0]).toMatchObject({ by: 'ledge', rule: 'r1' });
  });

  test('a second decide replaces the first deferred one', async () => {
    deciding.arrived(b.escalation('qi-1')!);
    await deciding.decide('qi-1', { q1: 'merge' }, 'git', {});
    await vi.advanceTimersByTimeAsync(10_000);
    await deciding.decide('qi-1', { q1: 'rebase' }, 'git', { why: 'mieux' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(answerCalls).toEqual([['qi-1', { q1: 'rebase' }, 'ledge', {}]]);
    expect(memory.decisions()).toHaveLength(1);
  });

  test('a guarded decide becomes an ask and tells the brain', async () => {
    deciding.arrived(b.escalation('qi-arch')!);
    const r = await deciding.decide('qi-arch', { q1: 'merge' }, 'architecture', {});
    expect(r).toMatchObject({ ok: false, code: 'mandate' });
    expect(b.escalation('qi-arch')).toMatchObject({ state: 'pending', category: 'architecture' });
    expect(b.escalation('qi-arch')!.graceUntil).toBeUndefined();
    expect(inboxPushed.at(-1)).toMatchObject({ kind: 'refused', escalationId: 'qi-arch' });
    await vi.advanceTimersByTimeAsync(GRACE_CAP_MS);
    expect(answerCalls).toHaveLength(0);
  });

  test('an unknown category is refused without inventing one', async () => {
    deciding.arrived(b.escalation('qi-1')!);
    const r = await deciding.decide('qi-1', { q1: 'merge' }, 'deploy', {});
    expect(r).toMatchObject({ ok: false, code: 'mandate' });
    expect(b.escalation('qi-1')!.state).toBe('pending');
    expect(b.escalation('qi-1')!.category).toBeUndefined();
  });

  test('invalid answers are refused', async () => {
    deciding.arrived(b.escalation('qi-1')!);
    expect(await deciding.decide('qi-1', { q1: 'squash' }, 'git', {})).toMatchObject({ ok: false, code: 'invalid' });
    expect(b.escalation('qi-1')!.state).toBe('grace');
  });

  test('a decide on a free ask is invalid', async () => {
    deciding.arrived(b.escalation('ask-3')!);
    expect(await deciding.decide('ask-3', { text: 'oui' }, 'git', {})).toMatchObject({ ok: false, code: 'invalid' });
    expect(answerCalls).toHaveLength(0);
  });

  test('unknown and answered escalations', async () => {
    expect(await deciding.decide('nope', {}, 'git', {})).toMatchObject({ ok: false, code: 'failed' });
    await answers.answer('qi-2', { q1: 'merge' }, 'user');
    expect(await deciding.decide('qi-2', { q1: 'merge' }, 'git', {})).toMatchObject({ ok: false, code: 'already_answered' });
  });

  test('a deferred decision that fails to leave tells the brain why', async () => {
    deciding.arrived(b.escalation('qi-1')!);
    await deciding.decide('qi-1', { q1: 'merge' }, 'git', {});
    failApprove = 1;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(answerCalls).toHaveLength(1);
    expect(memory.decisions()).toHaveLength(0);
    expect(inboxPushed.at(-1)).toMatchObject({ kind: 'state', text: expect.stringMatching(/qi-1.*OpenRig a répondu 500/) });
    expect(b.escalation('qi-1')!.state).toBe('grace');
    await vi.advanceTimersByTimeAsync(GRACE_CAP_MS);
    expect(b.escalation('qi-1')!.state).toBe('pending');
  });

  test('an immediate failure returns the answer code', async () => {
    deciding.arrived(b.escalation('qi-1')!);
    await vi.advanceTimersByTimeAsync(61_000);
    failApprove = 1;
    expect(await deciding.decide('qi-1', { q1: 'merge' }, 'git', {})).toMatchObject({ ok: false, code: 'failed' });
  });
});

describe('ask', () => {
  test('ask sets category and advice, back to pending, and clears grace', async () => {
    deciding.arrived(b.escalation('qi-1')!);
    expect(deciding.ask('qi-1', 'git', 'Je pencherais pour merge')).toMatchObject({ ok: true });
    expect(b.escalation('qi-1')).toMatchObject({ state: 'pending', category: 'git', advice: 'Je pencherais pour merge' });
    expect(b.escalation('qi-1')!.graceUntil).toBeUndefined();
  });

  test('ask on an unknown category is invalid', () => {
    deciding.arrived(b.escalation('qi-1')!);
    expect(deciding.ask('qi-1', 'deploy', 'avis')).toMatchObject({ ok: false, code: 'invalid' });
    expect(b.escalation('qi-1')!.state).toBe('grace');
  });

  test('ask without advice is invalid; ask on an unknown escalation fails', () => {
    expect(deciding.ask('qi-1', 'git', '  ')).toMatchObject({ ok: false, code: 'invalid' });
    expect(deciding.ask('nope', 'git', 'avis')).toMatchObject({ ok: false, code: 'failed' });
  });
});

describe('user answers', () => {
  const second = esc({ id: 'qi-9' });
  test('two identical user answers propose a fallback rule when the brain is off', async () => {
    on = false; b.m.set('qi-9', second);
    await answers.answer('qi-1', { q1: 'merge' }, 'user');
    await answers.answer('qi-9', { q1: 'merge' }, 'user');
    expect(memory.rules()).toEqual([expect.objectContaining({ status: 'proposed', text: 'Fusion → Merge', category: 'code', from: 'd1,d2' })]);
  });

  test('with the brain on, it is asked to word the rule', async () => {
    b.m.set('qi-9', second);
    await answers.answer('qi-1', { q1: 'merge' }, 'user');
    await answers.answer('qi-9', { q1: 'merge' }, 'user');
    expect(memory.rules()).toEqual([]);
    expect(inboxPushed.find(e => e.kind === 'state')).toMatchObject({ text: expect.stringContaining('ledge brain remember') });
    expect(inboxPushed.find(e => e.kind === 'state')).toMatchObject({ text: expect.stringContaining('--from d1,d2') });
  });

  test('a ledge answer is not recorded again by onAnswered', async () => {
    await answers.answer('qi-1', { q1: 'merge' }, 'ledge');
    expect(memory.decisions()).toEqual([]);
  });
});
