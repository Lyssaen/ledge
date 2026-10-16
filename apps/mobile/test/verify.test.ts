import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage, ServerMessage } from '@ledge/protocol';
import { confirmWithDevice, fetchChallenge, VerifyFailure, type HeldChallenge } from '../src/connection/verify';
import type { InboxItem } from '../src/model/requests';

const item: InboxItem = { sessionId: 's', pendingId: 'p', pendingVersion: 2, kind: 'permission', filter: 'permission', task: 't', botName: 'Kai', tool: 'claude', repo: 'r', since: '2026-10-14T10:00:00Z', text: 'git push --force origin main', risk: 'high', riskReason: 'pushes', readOnly: false };
const challenge = (over: Partial<HeldChallenge> = {}): HeldChallenge => ({ receivedAt: Date.now(), type: 'decide.challenge', id: 's', pendingId: 'p', pendingVersion: 2, decision: 'accept', options: { challenge: 'c' }, expiresAt: new Date(Date.now() + 60_000).toISOString(), ...over });

function bus() {
  const fns = new Set<(m: ServerMessage) => void>();
  const sent: ClientMessage[] = [];
  return { sent, emit: (m: ServerMessage) => fns.forEach(f => f(m)), listeners: () => fns.size, deps: { send: (m: ClientMessage) => { sent.push(m); return true; }, listen: (f: (m: ServerMessage) => void) => { fns.add(f); return () => { fns.delete(f); }; } } };
}

describe('fetchChallenge', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends decide.prepare for this request and version and resolves with the matching challenge', async () => {
    const b = bus();
    const p = fetchChallenge(item, b.deps);
    expect(b.sent).toEqual([{ type: 'decide.prepare', id: 's', pendingId: 'p', pendingVersion: 2, decision: 'accept' }]);
    b.emit(challenge({ pendingVersion: 1 }));
    b.emit(challenge());
    await expect(p).resolves.toMatchObject({ pendingVersion: 2 });
    expect(b.listeners()).toBe(0);
  });
  it('rejects with the reason of an error answering it, instead of waiting', async () => {
    const b = bus();
    const p = fetchChallenge(item, b.deps);
    b.emit({ type: 'error', id: 's', message: 'invalid' });
    await expect(p).rejects.toMatchObject({ reason: 'invalid' });
    expect(b.listeners()).toBe(0);
  });
  it('ignores an error about another session', async () => {
    const b = bus();
    const p = fetchChallenge(item, b.deps);
    b.emit({ type: 'error', id: 'other', message: 'stale' });
    b.emit(challenge());
    await expect(p).resolves.toBeDefined();
  });
  it('rejects offline when nothing could be sent, and on silence', async () => {
    await expect(fetchChallenge(item, { send: () => false, listen: () => () => {} })).rejects.toMatchObject({ reason: 'offline' });
    const b = bus();
    const p = fetchChallenge(item, { ...b.deps, timeoutMs: 1000 });
    const out = expect(p).rejects.toMatchObject({ reason: 'timeout' });
    await vi.advanceTimersByTimeAsync(1000);
    await out;
    expect(b.listeners()).toBe(0);
  });
});

describe('confirmWithDevice', () => {
  const assertion = { id: 'a', rawId: 'a', type: 'public-key', response: {}, clientExtensionResults: {} };

  it('calls startAuthentication before any await in the tap', () => {
    const start = vi.fn(() => new Promise<never>(() => {}));
    void confirmWithDevice(item, challenge(), { startAuthentication: start as never, submit: () => true });
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith({ optionsJSON: { challenge: 'c' } });
  });
  it('submits one accept decision with the assertion and a new operation id', async () => {
    const submit = vi.fn(() => true);
    const r = await confirmWithDevice(item, challenge(), { startAuthentication: (async () => assertion) as never, submit });
    expect(submit).toHaveBeenCalledTimes(1);
    const [op, msg] = submit.mock.calls[0] as unknown as [{ operationId: string; kind: string }, Record<string, unknown>];
    expect(msg).toMatchObject({ type: 'session.decide', id: 's', decision: 'accept', pendingId: 'p', pendingVersion: 2, assertion });
    expect(msg.operationId).toBe(op.operationId);
    expect(r).toEqual({ operationId: op.operationId });
  });
  it('a NotAllowedError (also as a cause) is a cancellation and sends nothing', async () => {
    const submit = vi.fn(() => true);
    const denied = Object.assign(new Error('x'), { name: 'NotAllowedError' });
    await expect(confirmWithDevice(item, challenge(), { startAuthentication: (async () => { throw denied; }) as never, submit })).resolves.toEqual({ cancelled: true });
    await expect(confirmWithDevice(item, challenge(), { startAuthentication: (async () => { throw Object.assign(new Error('w'), { cause: denied }); }) as never, submit })).resolves.toEqual({ cancelled: true });
    expect(submit).not.toHaveBeenCalled();
  });
  it('another failure rejects as webauthn_failed without sending', async () => {
    const submit = vi.fn(() => true);
    await expect(confirmWithDevice(item, challenge(), { startAuthentication: (async () => { throw new Error('boom'); }) as never, submit })).rejects.toMatchObject({ reason: 'webauthn_failed' });
    expect(submit).not.toHaveBeenCalled();
  });
  it('a held challenge older than its minute on the phone clock is refused without the device prompt', async () => {
    const start = vi.fn();
    const submit = vi.fn(() => true);
    await expect(confirmWithDevice(item, challenge({ receivedAt: Date.now() - 56_000 }), { startAuthentication: start as never, submit })).rejects.toBeInstanceOf(VerifyFailure);
    expect(start).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
  it('judges expiry from the receipt, so a phone clock minutes ahead of the PC still works', async () => {
    const b = bus();
    const phone = 1_800_000_000_000;
    const held = fetchChallenge(item, { ...b.deps, now: () => phone });
    b.emit({ ...challenge(), expiresAt: new Date(phone - 10 * 60_000).toISOString() } as ServerMessage);
    const c = await held;
    expect(c.receivedAt).toBe(phone);
    const submit = vi.fn(() => true);
    await expect(confirmWithDevice(item, c, { startAuthentication: (async () => assertion) as never, submit, now: () => phone + 20_000 })).resolves.toBeDefined();
    await expect(confirmWithDevice(item, c, { startAuthentication: (async () => assertion) as never, submit, now: () => phone + 56_000 })).rejects.toMatchObject({ reason: 'assertion_expired' });
  });
  it('does not submit when the request moved on while the device check was open', async () => {
    const submit = vi.fn(() => true);
    await expect(confirmWithDevice(item, challenge(), { startAuthentication: (async () => assertion) as never, submit, stillCurrent: () => false })).rejects.toMatchObject({ reason: 'changed' });
    expect(submit).not.toHaveBeenCalled();
  });
  it('a link that fell after the check rejects as offline', async () => {
    await expect(confirmWithDevice(item, challenge(), { startAuthentication: (async () => assertion) as never, submit: () => false })).rejects.toMatchObject({ reason: 'offline' });
  });
});
