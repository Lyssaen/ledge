import { describe, it, expect } from 'vitest';
import { parseClientMessage, parseServerMessage, PendingSchema, OperationReasonSchema } from '../src/index.js';

const U = '3f2b8c1e-5d4a-4e6b-9c7d-1a2b3c4d5e6f';
const assertion = { id: 'x', rawId: 'x', type: 'public-key', response: { clientDataJSON: 'a', authenticatorData: 'b', signature: 'c' } };

describe('decisions and operations protocol', () => {
  it('the legacy decide still parses', () => expect(parseClientMessage({ type: 'session.decide', id: 'a', decision: 'accept' }).type).toBe('session.decide'));
  it('a full remote decide parses', () => {
    const m = parseClientMessage({ type: 'session.decide', id: 'a', decision: 'accept', pendingId: 'p1-x', pendingVersion: 2, operationId: U, assertion });
    expect(m).toMatchObject({ pendingVersion: 2, operationId: U });
  });
  it('a decide with a bad operationId or version 0 is refused', () => {
    expect(() => parseClientMessage({ type: 'session.decide', id: 'a', decision: 'deny', operationId: 'nope' })).toThrow();
    expect(() => parseClientMessage({ type: 'session.decide', id: 'a', decision: 'deny', pendingVersion: 0 })).toThrow();
  });
  it('an assertion needs authenticatorData and signature', () => {
    expect(() => parseClientMessage({ type: 'session.decide', id: 'a', decision: 'accept', assertion: { ...assertion, response: { clientDataJSON: 'a' } } })).toThrow();
  });
  it('a reply may carry the operation and the request it answers', () => {
    expect(parseClientMessage({ type: 'session.reply', id: 'a', text: 'ok', operationId: U, pendingId: 'p1-x', pendingVersion: 1 }).type).toBe('session.reply');
    expect(parseClientMessage({ type: 'session.reply', id: 'a', text: 'ok' }).type).toBe('session.reply');
  });
  it('decide.prepare is for accept only', () => {
    expect(parseClientMessage({ type: 'decide.prepare', id: 'a', pendingId: 'p1-x', pendingVersion: 1, decision: 'accept' }).type).toBe('decide.prepare');
    expect(() => parseClientMessage({ type: 'decide.prepare', id: 'a', pendingId: 'p1-x', pendingVersion: 1, decision: 'deny' })).toThrow();
  });
  it('operation.status needs a uuid', () => {
    expect(parseClientMessage({ type: 'operation.status', operationId: U }).type).toBe('operation.status');
    expect(() => parseClientMessage({ type: 'operation.status', operationId: 'x' })).toThrow();
  });
  it('decide.challenge carries the request and the options', () => {
    const m = parseServerMessage({ type: 'decide.challenge', id: 'a', pendingId: 'p1-x', pendingVersion: 1, decision: 'accept', options: { challenge: 'c' }, expiresAt: '2026-10-15T10:00:00.000Z' });
    expect(m.type).toBe('decide.challenge');
  });
  it('operation.received and operation.result parse', () => {
    expect(parseServerMessage({ type: 'operation.received', operationId: U }).type).toBe('operation.received');
    expect(parseServerMessage({ type: 'operation.result', operationId: U, status: 'rejected', reason: 'stale' }).type).toBe('operation.result');
    expect(parseServerMessage({ type: 'operation.result', operationId: U, status: 'applied' }).type).toBe('operation.result');
  });
  it('operation.result reasons are a closed list', () => {
    expect(() => parseServerMessage({ type: 'operation.result', operationId: U, status: 'rejected', reason: 'oops' })).toThrow();
    expect(() => parseServerMessage({ type: 'operation.result', operationId: U, status: 'maybe' })).toThrow();
  });
  it('reasons fit an error message (decide.prepare failures)', () => {
    for (const r of OperationReasonSchema.options) expect(parseServerMessage({ type: 'error', id: 'a', message: r }).type).toBe('error');
  });
  it('a pending carries a risk and its reason, both optional', () => {
    const base = { kind: 'permission', text: 't', source: 'hook' };
    expect(PendingSchema.parse(base).risk).toBeUndefined();
    expect(PendingSchema.parse({ ...base, risk: 'high', riskReason: 'pushes' }).riskReason).toBe('pushes');
    expect(() => PendingSchema.parse({ ...base, risk: 'medium' })).toThrow();
    expect(() => PendingSchema.parse({ ...base, riskReason: 'whatever' })).toThrow();
  });
});
