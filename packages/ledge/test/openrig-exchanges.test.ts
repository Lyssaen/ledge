import { describe, expect, it } from 'vitest';
import { createExchangeLog, exchangeFromEvent, exchangeFromOutbox } from '../src/daemon/openrig/exchanges.js';

const at = '2026-10-31T10:00:00.000Z';
const ctx = { machine: 'local', rigOf: (r: string) => (r.endsWith('@starter') ? 'starter' : undefined), at };
const q = (o: Record<string, unknown>) => ({ seq: 1, type: 'queue.created', qitemId: '42', sourceSession: 'dev-build@starter', destinationSession: 'dev-lead@starter', summary: 'ship it', ...o });

describe('exchangeFromEvent', () => {
  it('maps a seat-to-seat queue.created to a task', () => {
    expect(exchangeFromEvent(q({}), ctx)).toEqual({ id: 'q-42', machine: 'local', rigId: 'starter', from: 'dev-build@starter', to: 'dev-lead@starter', kind: 'task', text: 'ship it', at });
  });
  it('maps queue.handed_off to a handoff', () => {
    expect(exchangeFromEvent(q({ type: 'queue.handed_off' }), ctx)).toMatchObject({ id: 'h-42', kind: 'handoff' });
  });
  it('ignores human rows (escalations)', () => {
    expect(exchangeFromEvent(q({ destinationSession: 'ledge@external' }), ctx)).toBeNull();
    expect(exchangeFromEvent(q({ destinationSession: 'operator-human@kernel' }), ctx)).toBeNull();
    expect(exchangeFromEvent(q({ tier: 'human-gate' }), ctx)).toBeNull();
  });
  it('ignores other events and unknown rigs', () => {
    expect(exchangeFromEvent(q({ type: 'queue.updated' }), ctx)).toBeNull();
    expect(exchangeFromEvent(q({ sourceSession: 'a@x', destinationSession: 'b@y' }), ctx)).toBeNull();
  });
  it('uses the receiver rig when the sender has none', () => {
    expect(exchangeFromEvent(q({ sourceSession: 'a@x' }), ctx)?.rigId).toBe('starter');
  });
});

describe('exchangeFromOutbox', () => {
  const body = 'From: a@starter\nTo: b@starter\nSent: now\n---\nhello there\n---\n↩ Reply: rig send';
  const row = { outboxId: 'outbox-1', senderSession: 'a@starter', destinationSession: 'b@starter', body };
  it('extracts the text between the --- lines', () => {
    expect(exchangeFromOutbox(row, ctx)).toMatchObject({ id: 'o-outbox-1', kind: 'message', text: 'hello there', rigId: 'starter', at });
  });
  it('falls back to the whole body', () => {
    expect(exchangeFromOutbox({ ...row, body: 'plain' }, ctx)?.text).toBe('plain');
  });
  it('skips wake intents and human rows', () => {
    expect(exchangeFromOutbox({ ...row, outboxId: 'wake-intent-1' }, ctx)).toBeNull();
    expect(exchangeFromOutbox({ ...row, destinationSession: 'ledge@external' }, ctx)).toBeNull();
  });
  it('takes at from a row timestamp, else ctx.at', () => {
    expect(exchangeFromOutbox({ ...row, createdAt: '2026-10-31T09:00:00.000Z' }, ctx)?.at).toBe('2026-10-31T09:00:00.000Z');
    expect(exchangeFromOutbox({ ...row, createdAt: 'garbage' }, { ...ctx, at: undefined })?.at).toMatch(/^\d{4}-/);
  });
});

describe('createExchangeLog', () => {
  const mk = (i: number) => ({ id: `q-${i}`, machine: 'local', rigId: 'r', from: 'a', to: 'b', kind: 'task' as const, text: 't', at });
  it('dedupes by id', () => {
    const log = createExchangeLog();
    expect(log.add(mk(1))).toBe(true); expect(log.add(mk(1))).toBe(false);
  });
  it('keeps the last 200, oldest first', () => {
    const log = createExchangeLog();
    for (let i = 0; i < 205; i++) log.add(mk(i));
    const l = log.list('r');
    expect(l).toHaveLength(200); expect(l[0]!.id).toBe('q-5'); expect(l[199]!.id).toBe('q-204');
  });
  it('forgetRig clears a rig', () => {
    const log = createExchangeLog(); log.add(mk(1)); log.forgetRig('r');
    expect(log.list('r')).toEqual([]); expect(log.add(mk(1))).toBe(true);
  });
});
