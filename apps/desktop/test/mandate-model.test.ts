import { describe, expect, it } from 'vitest';
import type { LedgeDecision } from '@ledge/protocol';
import { decisionsToday } from '../src/chat/mandate/model';

/** A local instant of `day` at hh:mm. */
const at = (day: string, h: number, m = 0) => { const [y, mo, d] = day.split('-').map(Number); return new Date(y!, mo! - 1, d!, h, m).toISOString(); };
const dec = (id: string, iso: string, by: 'ledge' | 'user' = 'ledge'): LedgeDecision => ({ id, escalationId: `e-${id}`, by, category: 'git', summary: id, answers: {}, at: iso });

describe('decisionsToday', () => {
  const list = [dec('late', at('2026-10-31', 23, 50)), dec('mine', at('2026-10-31', 12), 'user'), dec('early', at('2026-10-31', 0, 5)), dec('yesterday', at('2026-10-30', 23, 59))];
  it('keeps the decisions of the local day, in the order given', () => {
    expect(decisionsToday(list, '2026-10-31').map(d => d.id)).toEqual(['late', 'mine', 'early']);
  });
  it('filters by who decided', () => {
    expect(decisionsToday(list, '2026-10-31', 'ledge').map(d => d.id)).toEqual(['late', 'early']);
    expect(decisionsToday(list, '2026-10-31', 'user').map(d => d.id)).toEqual(['mine']);
  });
  it('nothing for another day', () => expect(decisionsToday(list, '2026-11-01')).toEqual([]));
});
