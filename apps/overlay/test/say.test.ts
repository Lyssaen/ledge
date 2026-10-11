import { describe, it, expect } from 'vitest';
import { pickSay, pickSpeaker, sayKindOf, type SayCandidate } from '../src/surface/say';

describe('sayKindOf', () => {
  it('maps a live session to the speech situation', () => {
    expect(sayKindOf({ state: 'waiting_permission', pending: { kind: 'permission' } })).toBe('approval');
    expect(sayKindOf({ state: 'waiting_input', pending: { kind: 'question' } })).toBe('question');
    expect(sayKindOf({ state: 'waiting_permission', pending: { kind: 'diff' } })).toBe('diff');
    expect(sayKindOf({ state: 'waiting_permission', pending: { kind: 'plan' } })).toBe('plan');
    expect(sayKindOf({ state: 'error' })).toBe('error');
    expect(sayKindOf({ state: 'idle' })).toBeNull();
    expect(sayKindOf({ state: 'working' })).toBeNull();
  });
});

describe('pickSay', () => {
  const variants = ['A', 'B', 'C', 'D'] as const;
  it('picks the same line for the same seed', () => {
    expect(pickSay(variants, 'b:finished:t1')).toBe(pickSay(variants, 'b:finished:t1'));
  });
  it('can pick a different line when the seed changes', () => {
    const seen = new Set(Array.from({ length: 20 }, (_, i) => pickSay(variants, `seed-${i}`)));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('pickSpeaker', () => {
  it('keeps a single speaker and prefers the more urgent kind', () => {
    const ledge: SayCandidate = { id: 'ledge', kind: 'ledge', seed: 'q1' };
    const finished: SayCandidate = { id: 'b', kind: 'finished', seed: 'b:fin' };
    const approval: SayCandidate = { id: 'a', kind: 'approval', seed: 'a:ok' };
    expect(pickSpeaker([ledge])).toEqual(ledge);
    expect(pickSpeaker([ledge, finished, approval])).toEqual(approval);
    expect(pickSpeaker([finished, ledge])).toEqual(ledge);
    expect(pickSpeaker([])).toBeNull();
  });
});
