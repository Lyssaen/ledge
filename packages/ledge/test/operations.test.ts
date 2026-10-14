import { describe, it, expect } from 'vitest';
import type { ClientMessage } from '@ledge/protocol';
import { OperationRegistry, fingerprint } from '../src/daemon/operations.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

describe('OperationRegistry', () => {
  it('a fresh operation is never fresh twice; replay returns the stored record', () => {
    const r = new OperationRegistry();
    const first = r.begin(A, 'dev1', 'fp');
    expect(first).toMatchObject({ kind: 'fresh', record: { id: A, owner: 'dev1', status: 'received' } });
    r.finish(A, 'applied');
    const again = r.begin(A, 'dev1', 'fp');
    expect(again).toMatchObject({ kind: 'replay', record: { status: 'applied' } });
  });

  it('records the reason of a refusal', () => {
    const r = new OperationRegistry();
    r.begin(A, 'dev1', 'fp');
    expect(r.finish(A, 'rejected', 'stale')).toMatchObject({ status: 'rejected', reason: 'stale' });
    expect(r.get(A, 'dev1')?.reason).toBe('stale');
  });

  it('the same id with another payload is a conflict', () => {
    const r = new OperationRegistry();
    r.begin(A, 'dev1', 'fp');
    expect(r.begin(A, 'dev1', 'other')).toEqual({ kind: 'conflict' });
  });

  it('the same id from another device is a conflict', () => {
    const r = new OperationRegistry();
    r.begin(A, 'dev1', 'fp');
    expect(r.begin(A, 'dev2', 'fp')).toEqual({ kind: 'conflict' });
  });

  it('a device cannot read another device\'s operation', () => {
    const r = new OperationRegistry();
    r.begin(A, 'dev1', 'fp');
    expect(r.get(A, 'dev1')).toBeDefined();
    expect(r.get(A, 'dev2')).toBeUndefined();
    expect(r.get(A, 'local')).toBeUndefined();
  });

  it('an operation older than 24 h is forgotten', () => {
    let now = 1_000;
    const r = new OperationRegistry({ now: () => now });
    r.begin(A, 'dev1', 'fp');
    r.finish(A, 'applied');
    now += 86_400_000;
    expect(r.get(A, 'dev1')).toBeDefined();
    now += 1;
    expect(r.get(A, 'dev1')).toBeUndefined();
    expect(r.begin(A, 'dev1', 'fp').kind).toBe('fresh');
  });

  it('eviction keeps operations still received', () => {
    let now = 0;
    const r = new OperationRegistry({ now: () => ++now, max: 2 });
    r.begin(A, 'd', 'fp'); // stays received
    r.begin(B, 'd', 'fp');
    r.finish(B, 'applied');
    r.begin(C, 'd', 'fp');
    expect(r.get(A, 'd')?.status).toBe('received');
    expect(r.get(B, 'd')).toBeUndefined();
    expect(r.get(C, 'd')?.status).toBe('received');
  });

  it('finish on an unknown id throws', () => {
    expect(() => new OperationRegistry().finish(A, 'applied')).toThrow();
  });
});

describe('fingerprint', () => {
  const base = { type: 'session.decide', id: 's1', decision: 'accept', pendingId: 'p', pendingVersion: 2 } as ClientMessage;
  it('ignores the assertion and the operation id', () => {
    const withExtras = { ...base, operationId: A, assertion: { id: 'x' } } as unknown as ClientMessage;
    expect(fingerprint(withExtras)).toBe(fingerprint(base));
  });
  it('changes with each decision-relevant field', () => {
    const f = fingerprint(base);
    expect(fingerprint({ ...base, decision: 'deny' } as ClientMessage)).not.toBe(f);
    expect(fingerprint({ ...base, pendingVersion: 3 } as ClientMessage)).not.toBe(f);
    expect(fingerprint({ ...base, pendingId: 'q' } as ClientMessage)).not.toBe(f);
    expect(fingerprint({ ...base, id: 's2' } as ClientMessage)).not.toBe(f);
    const reply = { type: 'session.reply', id: 's1', text: 'a' } as ClientMessage;
    expect(fingerprint({ ...reply, text: 'b' } as ClientMessage)).not.toBe(fingerprint(reply));
  });
});
