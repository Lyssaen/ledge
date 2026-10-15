import { describe, it, expect } from 'vitest';
import type { Session } from '@ledge/protocol';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { NO_SENDS, blocked, markOf, reduceSends, replyBlock, requestKey } from '../src/conversation/sends';

const ask: Session['pending'] = { kind: 'permission', text: 'Run git push?', tool: 'Bash', source: 'hook' };
const otto = fakeSession('local:otto', { state: 'waiting_permission', pending: ask });

describe('reduceSends', () => {
  it('a decision stays sent while the same request waits, whatever else changes', () => {
    let s = reduceSends(NO_SENDS, { type: 'sent', session: otto, kind: 'decision', errorSeq: 0 });
    expect(s.sent['local:otto']).toMatchObject({ kind: 'decision', request: requestKey(otto) });
    s = reduceSends(s, { type: 'sessions', sessions: [{ ...otto, lastActivityAt: '2026-10-09T18:05:00.000Z' }] });
    expect(s.sent['local:otto']).toBeDefined();
    s = reduceSends(s, { type: 'sessions', sessions: [{ ...otto, state: 'working', pending: undefined }] });
    expect(s.sent['local:otto']).toBeUndefined();
  });
  it('a reply or a command stays sent until the session changes', () => {
    let s = reduceSends(NO_SENDS, { type: 'sent', session: otto, kind: 'reply', text: 'Oui', errorSeq: 0 });
    expect(reduceSends(s, { type: 'sessions', sessions: [otto] })).toBe(s);
    s = reduceSends(s, { type: 'sessions', sessions: [{ ...otto, lastActivityAt: '2026-10-09T18:05:00.000Z' }] });
    expect(s.sent['local:otto']).toBeUndefined();
  });
  it('a frozen session keeps its send in flight; a removed one drops it', () => {
    const s = reduceSends(NO_SENDS, { type: 'sent', session: otto, kind: 'kill', errorSeq: 0 });
    expect(reduceSends(s, { type: 'sessions', sessions: [{ ...otto, offline: true, lastActivityAt: 'x' }] }).sent['local:otto']).toBeDefined();
    expect(reduceSends(s, { type: 'sessions', sessions: [] }).sent).toEqual({});
  });
  it('only a newer error carrying the session id reopens it (Review Focus 2)', () => {
    const s = reduceSends(NO_SENDS, { type: 'sent', session: otto, kind: 'reply', text: 'Oui', errorSeq: 4 });
    expect(reduceSends(s, { type: 'error', error: { id: 'local:nova', message: 'x', seq: 5 } })).toBe(s);
    expect(reduceSends(s, { type: 'error', error: { message: 'no id', seq: 6 } })).toBe(s);
    expect(reduceSends(s, { type: 'error', error: { id: 'local:otto', message: 'old', seq: 4 } })).toBe(s);
    const f = reduceSends(s, { type: 'error', error: { id: 'local:otto', message: 'Request expired', seq: 5 } });
    expect(f.sent).toEqual({});
    expect(f.failed['local:otto']).toEqual({ kind: 'reply', message: 'Request expired', text: 'Oui', request: null });
    expect(reduceSends(f, { type: 'error', error: { id: 'local:otto', message: 'again', seq: 6 } })).toBe(f);
  });
  it('a new send clears the failure; a changed request drops a decision failure; forget drops it', () => {
    const sent = reduceSends(NO_SENDS, { type: 'sent', session: otto, kind: 'decision', errorSeq: 0 });
    const f = reduceSends(sent, { type: 'error', error: { id: 'local:otto', message: 'Request expired', seq: 1 } });
    expect(f.failed['local:otto']?.request).toBe(requestKey(otto));
    expect(reduceSends(f, { type: 'sent', session: otto, kind: 'decision', errorSeq: 1 }).failed).toEqual({});
    expect(reduceSends(f, { type: 'sessions', sessions: [otto] })).toBe(f);
    expect(reduceSends(f, { type: 'sessions', sessions: [{ ...otto, pending: undefined, state: 'working' }] }).failed).toEqual({});
    expect(reduceSends(f, { type: 'forget', id: 'local:otto' }).failed).toEqual({});
  });
});

describe('request key and mark', () => {
  it('the request key names the kind, text and helper of the pending request', () => {
    expect(requestKey(fakeSession('a'))).toBeNull();
    expect(requestKey(otto)).toBe('permission\nRun git push?\n');
    expect(requestKey({ ...otto, pending: { ...ask, helperId: 'h1' } })).toBe('permission\nRun git push?\nh1');
  });
  it('the mark moves with state, activity, last reply, request and topic', () => {
    const m = markOf(otto);
    expect(markOf({ ...otto, topic: 'x' })).not.toBe(m);
    expect(markOf({ ...otto, lastReply: { text: 'ok', at: '2026-10-09T18:02:00.000Z' } })).not.toBe(m);
    expect(markOf({ ...otto })).toBe(m);
  });
});

describe('blocked and replyBlock', () => {
  it('offline wins, hook-only sessions are read-only', () => {
    expect(blocked(otto)).toBeNull();
    expect(blocked({ ...otto, offline: true, source: 'hook_only' })).toBe('offline');
    expect(blocked({ ...otto, source: 'hook_only' })).toBe('readonly');
  });
  it('free text waits while a permission, plan or diff is asked; options take free text only with Claude', () => {
    expect(replyBlock(otto)).toBe('request');
    expect(replyBlock(fakeSession('a', { state: 'idle' }))).toBeNull();
    const q = { kind: 'question' as const, text: 'Which one?', options: ['A', 'B'], source: 'pane' as const };
    expect(replyBlock(fakeSession('a', { state: 'waiting_input', pending: q }))).toBeNull();
    expect(replyBlock(fakeSession('a', { state: 'waiting_input', tool: 'codex', pending: q }))).toBe('options');
    expect(replyBlock({ ...otto, offline: true })).toBe('offline');
  });
});
