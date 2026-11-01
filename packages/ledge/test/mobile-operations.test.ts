import { describe, it, expect } from 'vitest';
import type { PhoneClientMessage } from '@ledge/protocol';
import { OperationRegistry, fingerprint, type PhoneOperation } from '../src/mobile/operations.js';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('OperationRegistry', () => {
  it('replays a known operation with its stored status', () => {
    const r = new OperationRegistry();
    expect(r.begin('dev1', uid(1), 'fp')).toMatchObject({ kind: 'fresh', record: { op: uid(1), owner: 'dev1', status: 'received' } });
    expect(r.begin('dev1', uid(1), 'fp')).toMatchObject({ kind: 'replay', record: { status: 'received' } });
    r.finish(uid(1), 'applied');
    expect(r.begin('dev1', uid(1), 'fp')).toMatchObject({ kind: 'replay', record: { status: 'applied' } });
  });

  it('keeps the reason of a refusal', () => {
    const r = new OperationRegistry();
    r.begin('dev1', uid(1), 'fp');
    r.finish(uid(1), 'rejected', 'conflict');
    expect(r.get(uid(1))).toMatchObject({ status: 'rejected', reason: 'conflict' });
  });

  it('another fingerprint or another owner is a conflict', () => {
    const r = new OperationRegistry();
    r.begin('dev1', uid(1), 'fp');
    expect(r.begin('dev1', uid(1), 'other')).toEqual({ kind: 'conflict' });
    expect(r.begin('dev2', uid(1), 'fp')).toEqual({ kind: 'conflict' });
  });

  it('fingerprints the attachments of a message, in order', () => {
    const m = (attachments?: string[]) => ({ type: 'session.reply', op: uid(1), id: 's', text: 'x', ...(attachments ? { attachments } : {}) }) as unknown as PhoneOperation;
    const a = 'a'.repeat(64), b = 'b'.repeat(64);
    const r = new OperationRegistry();
    r.begin('dev1', uid(1), fingerprint(m([a])));
    expect(r.begin('dev1', uid(1), fingerprint(m([a])))).toMatchObject({ kind: 'replay' });
    expect(r.begin('dev1', uid(1), fingerprint(m([b])))).toEqual({ kind: 'conflict' });
    expect(fingerprint(m())).toBe(fingerprint(m([])));
  });

  it('forgets a record after 24 h and 1 ms', () => {
    let now = 1_000;
    const r = new OperationRegistry({ now: () => now });
    r.begin('d', uid(1), 'fp');
    now += 86_400_000;
    expect(r.begin('d', uid(1), 'fp').kind).toBe('replay');
    now += 1;
    expect(r.begin('d', uid(1), 'fp').kind).toBe('fresh');
  });

  it('forgets the oldest finished record past the maximum', () => {
    const r = new OperationRegistry();
    for (let i = 0; i <= 500; i++) { r.begin('d', uid(i), 'fp'); r.finish(uid(i), 'applied'); }
    expect(r.get(uid(0))).toBeUndefined();
    expect(r.get(uid(1))).toBeDefined();
    expect(r.get(uid(500))).toBeDefined();
  });

  it('is full when 500 records are still received: nothing is forgotten, the new one conflicts', () => {
    const r = new OperationRegistry();
    for (let i = 0; i < 500; i++) r.begin('d', uid(i), 'fp');
    expect(r.begin('d', uid(500), 'fp')).toEqual({ kind: 'conflict' });
    expect(r.get(uid(500))).toBeUndefined();
    expect(r.get(uid(0))).toBeDefined();
    expect(r.begin('d', uid(0), 'fp').kind).toBe('replay');
  });

  it('purges expired records before checking capacity', () => {
    let now = 0;
    const r = new OperationRegistry({ now: () => now, max: 2 });
    r.begin('d', uid(1), 'fp');
    r.begin('d', uid(2), 'fp');
    now += 86_400_001;
    expect(r.begin('d', uid(3), 'fp').kind).toBe('fresh');
  });

  it('finish on an unknown operation does nothing', () => {
    expect(() => new OperationRegistry().finish(uid(1), 'applied')).not.toThrow();
  });
});

describe('fingerprint', () => {
  const decide: PhoneOperation = {
    type: 'session.decide', op: uid(1), id: 's1', decision: 'accept',
    expect: { kind: 'permission', text: 'rm', key: 'k1' }
  } as PhoneOperation;

  it('ignores the operation id', () => {
    expect(fingerprint({ ...decide, op: uid(2) })).toBe(fingerprint(decide));
  });

  it('changes with the expected key', () => {
    const other = { ...decide, expect: { ...(decide as Extract<PhoneClientMessage, { type: 'session.decide' }>).expect, key: 'k2' } } as PhoneOperation;
    expect(fingerprint(other)).not.toBe(fingerprint(decide));
  });

  it('changes with the decision, note, text and session', () => {
    const f = fingerprint(decide);
    expect(fingerprint({ ...decide, decision: 'deny' } as PhoneOperation)).not.toBe(f);
    expect(fingerprint({ ...decide, note: 'n' } as PhoneOperation)).not.toBe(f);
    expect(fingerprint({ ...decide, id: 's2' } as PhoneOperation)).not.toBe(f);
    const reply: PhoneOperation = { type: 'session.reply', op: uid(1), id: 's1', text: 'a', expect: null };
    expect(fingerprint({ ...reply, text: 'b' })).not.toBe(fingerprint(reply));
    // The request a reply answers counts; none seen is one value, whatever the phone wrote for it.
    expect(fingerprint({ ...reply, expect: { kind: 'question', text: 'q', key: 'k1' } })).not.toBe(fingerprint(reply));
    expect(fingerprint({ ...reply, expect: undefined } as unknown as PhoneOperation)).toBe(fingerprint(reply));
  });
});

describe('fingerprint of session.answer', () => {
  const answer = (selected: string): PhoneOperation => ({
    type: 'session.answer', op: uid(1), id: 's1', requestId: 'r1', answers: [{ id: 'q1', selected: [selected] }], expect: { kind: 'question', text: 'q', key: 'k1' }
  });
  it('changes when an answer changes, not with the operation id', () => {
    expect(fingerprint(answer('a'))).not.toBe(fingerprint(answer('b')));
    expect(fingerprint({ ...answer('a'), op: uid(2) })).toBe(fingerprint(answer('a')));
    expect(fingerprint({ ...answer('a'), requestId: 'r2' } as PhoneOperation)).not.toBe(fingerprint(answer('a')));
  });
});

describe('fingerprint of credential.register', () => {
  const reg = (id: string, signature: string): PhoneOperation => ({
    type: 'credential.register', op: uid(1),
    credential: { id, publicKey: 'pk', alg: -7, clientDataJSON: signature, authenticatorData: signature }
  });
  it('depends on the credential id, not on the signed parts', () => {
    expect(fingerprint(reg('cred1', 'a'))).toBe(fingerprint({ ...reg('cred1', 'b'), op: uid(2) }));
    expect(fingerprint(reg('cred1', 'a'))).not.toBe(fingerprint(reg('cred2', 'a')));
  });
});

describe('model changes (#58)', () => {
  const change = (model: string | null, effort: string | null): PhoneOperation => ({ type: 'session.model', op: uid(1), id: 's1', model, effort });

  it('fingerprint differs by model and by effort', () => {
    const f = fingerprint(change('opus', 'high'));
    expect(fingerprint({ ...change('opus', 'high'), op: uid(2) })).toBe(f);
    expect(fingerprint(change('sonnet', 'high'))).not.toBe(f);
    expect(fingerprint(change('opus', 'low'))).not.toBe(f);
    expect(fingerprint(change(null, 'high'))).not.toBe(f);
    expect(fingerprint(change('opus', null))).not.toBe(f);
  });

  it('the registry replays models', () => {
    const r = new OperationRegistry();
    const models = [{ role: 'lead', session: 's1', status: 'scheduled' as const }, { role: 'qa', session: 's2', status: 'refused' as const, reason: 'not_launched' as const }];
    r.begin('dev1', uid(1), 'fp');
    r.finish(uid(1), 'applied', undefined, models);
    expect(r.begin('dev1', uid(1), 'fp')).toMatchObject({ kind: 'replay', record: { status: 'applied', models } });
    // A record finished without models replays none.
    r.begin('dev1', uid(2), 'fp');
    r.finish(uid(2), 'applied');
    expect(r.get(uid(2))).not.toHaveProperty('models');
  });
});
