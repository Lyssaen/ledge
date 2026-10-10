import { describe, it, expect } from 'vitest';
import { changeOf, isPending, sameRequest } from '../src/daemon/changes';
import { isPending as asksIsPending } from '../src/surface/useDaemonAsks';
import { fakeSession } from './mockDaemon';

const s = (extra = {}) => fakeSession('a', extra);
const ask = { kind: 'permission', text: 'npm test', source: 'hook' } as const;

describe('changeOf', () => {
  it('first sight is a join', () => { expect(changeOf(undefined, s())).toEqual({ kind: 'joined', id: 'a' }); });
  it('working to idle is a finish; a launch (starting to idle) or idle again without working in between is not', () => {
    expect(changeOf(s({ state: 'working' }), s({ state: 'idle' }))).toEqual({ kind: 'finished', id: 'a' });
    expect(changeOf(s({ state: 'starting' }), s({ state: 'idle' }))).toBeNull();
    expect(changeOf(s({ state: 'idle' }), s({ state: 'idle' }))).toBeNull();
    expect(changeOf(s({ state: 'waiting_permission', pending: ask }), s({ state: 'idle' }))).toBeNull();
  });
  it('a new request is an ask, typed by the state; the same request again is nothing', () => {
    expect(changeOf(s({ state: 'working' }), s({ state: 'waiting_permission', pending: ask }))).toEqual({ kind: 'asked', id: 'a', ask: 'approval' });
    expect(changeOf(s({ state: 'working' }), s({ state: 'waiting_input', pending: { kind: 'question', text: 'Which?', source: 'hook' } }))).toEqual({ kind: 'asked', id: 'a', ask: 'question' });
    expect(changeOf(s({ state: 'waiting_permission', pending: ask }), s({ state: 'waiting_permission', pending: ask }))).toBeNull();
  });
  it('into error, or an exit with a non-zero code, is a failure; a clean exit is a leave', () => {
    expect(changeOf(s({ state: 'working' }), s({ state: 'error', lastError: 'boom' }))).toEqual({ kind: 'failed', id: 'a' });
    expect(changeOf(s({ state: 'working' }), s({ state: 'exited', exitCode: 2 }))).toEqual({ kind: 'failed', id: 'a' });
    expect(changeOf(s({ state: 'working' }), s({ state: 'exited', exitCode: 0 }))).toEqual({ kind: 'left', id: 'a', exitCode: 0 });
    expect(changeOf(s({ state: 'working' }), s({ state: 'exited', exitCode: null }))).toEqual({ kind: 'left', id: 'a', exitCode: null });
    expect(changeOf(s({ state: 'exited', exitCode: 0 }), s({ state: 'exited', exitCode: 0 }))).toBeNull();
  });
  it('a preview or activity update is nothing', () => {
    expect(changeOf(s({ state: 'working' }), s({ state: 'working', lastActivityAt: '2026-10-09T18:05:00.000Z' }))).toBeNull();
  });
});

describe('shared request helpers', () => {
  it('live in changes.ts, re-exported unchanged by useDaemonAsks', () => {
    expect(asksIsPending).toBe(isPending);
    const q = { kind: 'question' as const, text: 'Which?', source: 'hook' as const };
    expect(sameRequest(q, { ...q })).toBe(true);
    expect(sameRequest(q, { ...q, text: 'Other?' })).toBe(false);
    expect(sameRequest(undefined, q)).toBe(false);
  });
});
