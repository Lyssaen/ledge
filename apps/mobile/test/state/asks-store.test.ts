import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PhoneServerMessage } from '@ledge/protocol';
import { askEndOf } from '../../src/model/atoi';
import { UNCERTAIN_MS } from '../../src/state/operations';
import { createStore, type MobileStore } from '../../src/state/store';
import { fakeLink, MemoryStorage, snapshot } from './helpers';

const stores: MobileStore[] = [];
afterEach(() => { for (const s of stores.splice(0)) s.close(); });

function setup(openrig = true) {
  const f = fakeLink('ready');
  const store = createStore(f.link, new MemoryStorage());
  stores.push(store);
  const snap = snapshot([]) as Extract<PhoneServerMessage, { type: 'snapshot' }>;
  f.deliver({ ...snap, daemon: { ...snap.daemon, ...(openrig ? { openrig: true } : {}) } } as PhoneServerMessage);
  return { ...f, store };
}

const assertion = { id: 'AQ', clientDataJSON: 'AQ', authenticatorData: 'AQ', signature: 'AQ' };
const choice = { kind: 'choice', questionId: 'q', optionId: 'now' } as const;

describe('answering an OpenRig ask (store.answerAsk)', () => {
  it('sends the answer with the assertion over it, and nothing on a PC without OpenRig', () => {
    const t = setup();
    const op = t.store.answerAsk('r1', choice, { assertion });
    expect(op).not.toBeNull();
    expect(t.of('openrig.answer')).toEqual([expect.objectContaining({ op, qitemId: 'r1', answer: choice, assertion })]);
    expect(askEndOf('r1', t.store.getState().ops)).toEqual({ kind: 'sending', answer: choice });

    const without = setup(false);
    expect(without.store.answerAsk('r1', { kind: 'seen' })).toBeNull();
    expect(without.of('openrig.answer')).toEqual([]);
  });

  it('a second tap while the first answer goes sends nothing', () => {
    const t = setup();
    t.store.answerAsk('r1', choice, { assertion });
    expect(t.store.answerAsk('r1', choice, { assertion })).toBeNull();
    expect(t.of('openrig.answer')).toHaveLength(1);
  });

  it('keeps the end `openrig.answered` gives on the op: sent, recorded, already, refused, failed', () => {
    const cases: [Partial<Extract<PhoneServerMessage, { type: 'openrig.answered' }>>, ReturnType<typeof askEndOf>][] = [
      [{ ok: true, outcome: 'answered' }, { kind: 'sent', answer: choice }],
      [{ ok: true, outcome: 'recorded', remaining: ['q2'] }, { kind: 'recorded', answer: choice }],
      [{ ok: true, outcome: 'already' }, { kind: 'already' }],
      [{ ok: false, error: 'closed' }, { kind: 'already' }],
      [{ ok: false, rejected: 'assertion_expired' }, { kind: 'refused', answer: choice, reason: 'assertion_expired' }],
      [{ ok: false, error: 'openrig_stopped' }, { kind: 'failed', answer: choice, error: 'openrig_stopped' }]
    ];
    for (const [end, expected] of cases) {
      const t = setup();
      const op = t.store.answerAsk('r1', choice, { assertion })!;
      t.deliver({ type: 'openrig.answered', op, qitemId: 'r1', ...end } as PhoneServerMessage);
      expect(askEndOf('r1', t.store.getState().ops)).toEqual(expected);
    }
  });
});

describe('an answer of unknown outcome (store.resendAsk)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('sends the same operation again, so the PC replays its end; nothing when no answer is uncertain', () => {
    vi.useFakeTimers();
    const t = setup();
    const op = t.store.answerAsk('r1', choice, { assertion })!;
    expect(t.store.resendAsk('r1')).toBe(false);
    vi.advanceTimersByTime(UNCERTAIN_MS);
    expect(askEndOf('r1', t.store.getState().ops)).toEqual({ kind: 'uncertain', answer: choice });
    expect(t.store.resendAsk('r2')).toBe(false);
    expect(t.store.resendAsk('r1')).toBe(true);
    const sent = t.of('openrig.answer');
    expect(sent.map(m => m.op)).toEqual([op, op]);
    expect(sent[1]).toEqual(sent[0]);
  });

  it('an end the PC gave as « uncertain » is no operation to send again', () => {
    const t = setup();
    const op = t.store.answerAsk('r1', choice, { assertion })!;
    t.deliver({ type: 'openrig.answered', op, qitemId: 'r1', ok: false, error: 'uncertain', message: 'lost' } as PhoneServerMessage);
    expect(askEndOf('r1', t.store.getState().ops)).toEqual({ kind: 'uncertain', answer: choice });
    expect(t.store.resendAsk('r1')).toBe(false);
  });
});
