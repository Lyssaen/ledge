import { describe, it, expect } from 'vitest';
import { EscalationSchema } from '@ledge/protocol';
import type { Ask } from '@ledge/protocol';
import { isHumanRow, rowToEscalation, createEscalationBook } from '../src/daemon/openrig/escalations';
import { askToEscalation } from '../src/daemon/openrig/asks';

const ctx = { machine: 'local', rigOf: (r: string) => (r.endsWith('@starter') ? 'starter' : undefined) };
const q = { id: 'q1', question: 'Which db?', options: [{ id: 'a', label: 'Postgres', recommended: true }, { id: 'b', label: 'SQLite' }, { id: 'c', label: 'Mongo' }] };
const row = (o: Record<string, unknown> = {}) => ({ qitemId: 'qi-1', sourceSession: 'dev-build@starter', destinationSession: 'ledge@external', state: 'pending', summary: 'Pick', body: 'Pick', humanQuestions: [q], createdAt: '2026-10-30 22:22:34', ...o });

describe('rowToEscalation', () => {
  it('maps a rig row', () => {
    const e = rowToEscalation(row(), ctx);
    expect(e).toMatchObject({ id: 'qi-1', source: 'rig', from: 'dev-build@starter', rigId: 'starter', intent: 'decision', state: 'pending', machine: 'local', createdAt: '2026-10-30T22:22:34.000Z' });
    expect(e.questions[0]?.options.map(o => o.id)).toEqual(['a', 'b', 'c']);
    expect(e.questions[0]?.options[0]?.recommended).toBe(true);
    expect(e.detail).toBeUndefined();
    expect(EscalationSchema.safeParse(e).success).toBe(true);
  });
  it('operator destination, kernel source, update intent, detail', () => {
    expect(rowToEscalation(row({ destinationSession: 'operator-human@kernel' }), ctx).source).toBe('operator');
    expect(rowToEscalation(row(), { ...ctx, isKernelSeat: r => r === 'dev-build@starter' }).source).toBe('operator');
    const u = rowToEscalation(row({ humanQuestions: undefined, body: 'long body' }), ctx);
    expect(u).toMatchObject({ intent: 'update', questions: [], detail: 'long body' });
  });
  it('stays schema-valid on malformed input', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ ...q, id: `q${i}`, options: Array.from({ length: 6 }, (_, j) => ({ id: `o${j}`, label: 'x' })) }));
    const e = rowToEscalation(row({ humanQuestions: [...many, { id: 'bad', question: 'x', options: [{ id: 'a', label: 'a' }] }], createdAt: 'garbage' }), ctx);
    expect(e.questions).toHaveLength(4);
    expect(e.questions[0]?.options).toHaveLength(4);
    expect(EscalationSchema.safeParse(e).success).toBe(true);
  });
});

describe('isHumanRow', () => {
  it('detects human rows', () => {
    expect(isHumanRow(row())).toBe(true);
    expect(isHumanRow(row({ destinationSession: 'operator-human@kernel' }))).toBe(true);
    expect(isHumanRow(row({ destinationSession: 'qa@starter', tier: 'human-gate' }))).toBe(true);
    expect(isHumanRow(row({ destinationSession: 'qa@starter' }))).toBe(false);
  });
});

describe('book', () => {
  it('upsert dedups, replace reports removed', () => {
    const b = createEscalationBook(); const e = rowToEscalation(row(), ctx);
    expect(b.upsert(e)).toEqual(e); expect(b.upsert({ ...e })).toBeNull();
    expect(b.upsert({ ...e, summary: 'changed' })?.summary).toBe('changed');
    expect(b.replace([])).toEqual({ updated: [], removed: ['qi-1'] });
    expect(b.replace([e]).updated).toHaveLength(1); expect(b.replace([e]).updated).toEqual([]);
    expect(b.remove('qi-1')).toBe(true); expect(b.remove('qi-1')).toBe(false); expect(b.all()).toEqual([]);
  });
});

describe('askToEscalation', () => {
  const ask: Ask = { id: 'a1abcde'.slice(0, 7), from: 's1', fromName: 'raw', question: 'Ship?', options: 'yes / no', at: '2026-10-30T10:00:00.000Z', state: 'open' };
  const actx = { machine: 'local', nameOf: (id: string) => (id === 's1' ? 'Otto' : undefined) };
  it('maps', () => {
    const e = askToEscalation({ ...ask, id: 'a1' as never }, actx);
    expect(e).toMatchObject({ id: 'ask-a1', source: 'ask', from: 'Otto', intent: 'decision', summary: 'Ship?', detail: 'yes / no', questions: [], state: 'pending', createdAt: ask.at });
    expect(EscalationSchema.safeParse(e).success).toBe(true);
  });
  it('states, answer, fallback name, no detail', () => {
    const a = askToEscalation({ ...ask, options: '', state: 'answered', answer: { text: 'yes', at: '2026-10-30T11:00:00.000Z' } }, { ...actx, nameOf: () => undefined });
    expect(a).toMatchObject({ state: 'answered', from: 'raw', answer: { by: 'user', answers: { text: 'yes' }, at: '2026-10-30T11:00:00.000Z' } });
    expect(a.detail).toBeUndefined();
    expect(askToEscalation({ ...ask, state: 'dropped' }, actx).state).toBe('closed');
  });
});
