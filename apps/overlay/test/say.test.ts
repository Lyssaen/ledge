import { describe, it, expect } from 'vitest';
import { ledgeSentence, pickSay, pickSpeaker, sayKindOf, type SayCandidate } from '../src/surface/say';
import { MESSAGES } from '../src/i18n/messages';
import { fakeSession } from './mockDaemon';

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
  it('rigask outranks point, point outranks ledge, approval outranks all', () => {
    const ledge: SayCandidate = { id: 'ledge', kind: 'ledge', seed: 'q1' };
    const point: SayCandidate = { id: 'local|point:p1', kind: 'point', seed: 'p1' };
    const rigask: SayCandidate = { id: 'local|rig.ask:r1', kind: 'rigask', seed: 'r1' };
    const approval: SayCandidate = { id: 'a', kind: 'approval', seed: 'a:ok' };
    expect(pickSpeaker([ledge, point, rigask])).toEqual(rigask);
    expect(pickSpeaker([ledge, point])).toEqual(point);
    expect(pickSpeaker([ledge, point, rigask, approval])).toEqual(approval);
  });
});

describe('ledgeSentence', () => {
  it('names the session and says what it wants, in Ledge\'s words', () => {
    const t = MESSAGES.fr;
    expect(ledgeSentence(fakeSession('a', { name: 'Nova', state: 'waiting_permission', pending: { kind: 'permission', text: 'pnpm -r test -u', tool: 'Bash', source: 'hook' } }), t))
      .toEqual({ who: 'Nova', rest: 'veut lancer `pnpm -r test -u`' });
    expect(ledgeSentence(fakeSession('b', { name: 'Pim', state: 'waiting_input', pending: { kind: 'question', text: 'Quelle stratégie ?', source: 'hook' } }), t))
      .toEqual({ who: 'Pim', rest: 'te demande\u00a0: Quelle stratégie ?' });
    expect(ledgeSentence(fakeSession('c', { name: 'Rex', state: 'waiting_permission', pending: { kind: 'permission', text: 'src/a.ts', tool: 'Edit', source: 'hook' } }), MESSAGES.en))
      .toEqual({ who: 'Rex', rest: 'wants to use Edit: `src/a.ts`' });
  });
});
