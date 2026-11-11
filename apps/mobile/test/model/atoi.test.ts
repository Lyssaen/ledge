import { describe, expect, it } from 'vitest';
import type { HumanAsk, PhoneSession } from '@ledge/protocol';
import { atoiOrder, cardMode, nextAfter, stepFrom, type AtoiTarget } from '../../src/model/atoi';
import { requestsOf } from '../../src/model/requests';
import { pending, session } from './fixtures';

const at = (min: number) => new Date(Date.parse('2026-10-14T10:00:00.000Z') + min * 60_000).toISOString();
const ask = (id: string, extra: Partial<HumanAsk> = {}): HumanAsk => ({
  id, kind: 'decision', alert: false, priority: 'routine', from: { seat: 'pilot-lead@ledge-dev', rig: 'ledge-dev', role: 'pilot.lead' },
  summary: id, body: '', bodyTruncated: false, detail: null, evidenceRef: null, questions: [], createdAt: at(0), updatedAt: at(0), ...extra
} as HumanAsk);
const req = (id: string): AtoiTarget => ({ name: 'request', sessionId: id, key: `k${id}` });
const rig = (id: string): AtoiTarget => ({ name: 'ask', id });

describe('« À toi »\'s order on a wide screen (m1-a-toi.html §12)', () => {
  it('lists the sessions\' requests, then the asks by priority, without a piece of news', () => {
    const items = requestsOf([
      session('a', { state: 'waiting_permission', lastActivityAt: at(5), pending: pending({ key: 'ka' }) }),
      session('b', { state: 'waiting_permission', lastActivityAt: at(1), pending: pending({ key: 'kb' }) })
    ]);
    const order = atoiOrder(items, [ask('old', { createdAt: at(0) }), ask('news', { kind: 'update' }), ask('urgent', { priority: 'urgent', createdAt: at(9) })]);
    expect(order).toEqual([...items.map(i => ({ name: 'request', sessionId: i.sessionId, key: i.key })), rig('urgent'), rig('old')]);
    expect(order.filter(t => t.name === 'ask')).not.toContainEqual(rig('news'));
  });
});

describe('the next one once decided (nextAfter)', () => {
  const order = [req('a'), req('b'), rig('r')];

  it('is the one after, while the decided one is still listed', () => {
    expect(nextAfter(order, req('a'))).toEqual(req('b'));
    expect(nextAfter(order, req('b'))).toEqual(rig('r'));
  });

  it('counts from where it was once it left the list', () => {
    expect(nextAfter([req('a'), rig('r')], req('b'), order)).toEqual(rig('r'));
  });

  it('goes back to the first one left after the last, and to none when nothing is left', () => {
    expect(nextAfter(order, rig('r'))).toEqual(req('a'));
    expect(nextAfter([rig('r')], rig('r'))).toBeNull();
    expect(nextAfter([], req('a'), [req('a')])).toBeNull();
  });

  it('a request replaced in place (same session, new key) is the same entry, never its own next', () => {
    expect(nextAfter([{ name: 'request', sessionId: 'a', key: 'ka2' }, req('b')], req('a'))).toEqual(req('b'));
  });
});

describe('↑ / ↓ (stepFrom)', () => {
  const order = [req('a'), req('b'), rig('r')];

  it('moves one entry, and stops at both ends', () => {
    expect(stepFrom(order, req('a'), 1)).toEqual(req('b'));
    expect(stepFrom(order, req('b'), -1)).toEqual(req('a'));
    expect(stepFrom(order, rig('r'), 1)).toEqual(rig('r'));
    expect(stepFrom(order, req('a'), -1)).toEqual(req('a'));
  });

  it('starts from the top when nothing listed is open, and gives none on an empty list', () => {
    expect(stepFrom(order, null, 1)).toEqual(req('a'));
    expect(stepFrom(order, rig('gone'), -1)).toEqual(req('a'));
    expect(stepFrom([], null, 1)).toBeNull();
  });
});

describe('what a card decides in the list (cardMode)', () => {
  const item = (p: Parameters<typeof pending>[0], tool: PhoneSession['tool'] = 'claude') =>
    requestsOf([session('a', { tool, state: p?.kind === 'question' ? 'waiting_input' : 'waiting_permission', pending: pending(p) })])[0]!;

  it('an OMP dialog with options, or an ask of several questions, is examined, not decided in the list (Q65)', () => {
    expect(cardMode(item({ kind: 'question', text: 'Quelle relance ?', options: ['a', 'b'] }, 'omp'), { decide: false }, false)).toEqual({ kind: 'examine' });
    const ask = item({ kind: 'question', text: 'Deux questions', requestId: 'r', questions: [{ id: 'q1', question: 'A ?', options: [{ label: 'x' }], multi: false }] } as never, 'omp');
    expect(cardMode(ask, { questions: true }, false)).toEqual({ kind: 'examine' });
  });

  it('a permission offers « Toujours » where the agent does, never on a high-impact accept', () => {
    expect(cardMode(item({}), undefined, false)).toEqual({ kind: 'permission', always: true });
    expect(cardMode(item({ risk: 'high', riskReason: 'pushes' }), undefined, false)).toEqual({ kind: 'high' });
  });
});
