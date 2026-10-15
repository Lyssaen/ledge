import { describe, expect, it } from 'vitest';
import { matches } from '../src/model/operations';
import { checkFreeAnswer, OTHER_MAX } from '../src/model/freeAnswer';

describe('checkFreeAnswer', () => {
  it('trims and accepts one plain line', () => expect(checkFreeAnswer('  Thème sombre 👩‍💻  ')).toEqual({ text: 'Thème sombre 👩‍💻', problem: null }));
  it('refuses empty, too long, line breaks, control characters and bidi overrides', () => {
    expect(checkFreeAnswer('   ').problem).toBe('empty');
    expect(checkFreeAnswer('x'.repeat(OTHER_MAX + 1)).problem).toBe('long');
    expect(checkFreeAnswer('x'.repeat(OTHER_MAX)).problem).toBeNull();
    for (const bad of ['a\nb', 'a\r', 'a\tb', 'a\u001b[31m', 'a\u0085', 'a‮b', 'a​b', 'ok\n']) expect(checkFreeAnswer(bad).problem).toBe('untypable');
  });
});

describe('matches an answer', () => {
  const op = { operationId: '11111111-1111-4111-8111-111111111111', sessionId: 'a', pendingId: 'p', pendingVersion: 1, kind: 'answer' as const, text: 'hello', phase: 'sending' as const, startedAt: 'x' };
  const msg = { type: 'session.reply' as const, id: 'a', text: 'hello', pendingId: 'p', pendingVersion: 1, operationId: op.operationId };
  it('tells a free answer from an option number', () => {
    expect(matches(op, msg)).toBe(true);
    expect(matches(op, { ...msg, other: true })).toBe(false);
    expect(matches({ ...op, other: true }, msg)).toBe(false);
    expect(matches({ ...op, other: true }, { ...msg, other: true })).toBe(true);
  });
});
