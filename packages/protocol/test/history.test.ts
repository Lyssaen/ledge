import { describe, it, expect } from 'vitest';
import { ThreadItemSchema, TurnSchema, REPLY_MAX, REPLY_TRUNCATION_MARK, parseClientMessage, parseServerMessage, SessionSchema } from '../src/index.js';

const T = '2026-10-14T10:00:00.000Z';

describe('thread protocol', () => {
  it('a decision turn carries its source', () => expect(TurnSchema.parse({ id: 'perm-1', at: T, kind: 'decision', decision: 'accept', source: 'phone', pendingId: 'p2-x' }).source).toBe('phone'));
  it('a turn names the thread item it comes from', () => expect(TurnSchema.safeParse({ id: '', at: T, kind: 'prompt' }).success).toBe(false));
  it('a capped reply (cap plus the mark) still parses in session.turns', () => {
    const text = 'x'.repeat(REPLY_MAX) + REPLY_TRUNCATION_MARK;
    expect(parseServerMessage({ type: 'session.turns', id: 'a', turns: [{ id: 'reply-1', at: T, kind: 'reply', text }] }).type).toBe('session.turns');
  });
  it('a reply far beyond the cap is refused', () => expect(TurnSchema.safeParse({ id: 'reply-1', at: T, kind: 'reply', text: 'x'.repeat(REPLY_MAX + 17) }).success).toBe(false));
  it('session.interrupt without operationId still parses (overlay)', () => expect(parseClientMessage({ type: 'session.interrupt', id: 'a' }).type).toBe('session.interrupt'));
  it('session.interrupt takes an operationId', () => expect(parseClientMessage({ type: 'session.interrupt', id: 'a', operationId: '3f2b8c1e-5d4a-4e6b-9c7d-1a2b3c4d5e6f' })).toMatchObject({ operationId: expect.any(String) }));
  it('session.history and session.read parse', () => {
    expect(parseClientMessage({ type: 'session.history', id: 'a' }).type).toBe('session.history');
    expect(parseClientMessage({ type: 'session.read', id: 'a', at: T }).type).toBe('session.read');
    expect(() => parseClientMessage({ type: 'session.read', id: 'a', at: 'yesterday' })).toThrow();
  });
  it('a session may be unread', () => {
    const s = { id: 'a', name: 'n', tool: 'claude', cwd: '/', project: 'p', title: 't', tmuxSession: null, state: 'idle', startedAt: T, lastActivityAt: T, source: 'launcher' };
    expect(SessionSchema.parse({ ...s, unread: true }).unread).toBe(true);
    expect(SessionSchema.parse(s).unread).toBeUndefined();
  });
  it('the shared thread records where a decision or a prompt came from, and keeps phone-only notes', () => {
    expect(ThreadItemSchema.parse({ kind: 'permission', id: 'perm-1', at: T, turn: 1, tool: 'Bash', text: 'ls', decision: 'accept', source: 'phone', pendingId: 'p1' })).toMatchObject({ source: 'phone' });
    expect(ThreadItemSchema.parse({ kind: 'prompt', id: 'prompt-1', at: T, turn: 1, text: 'go', source: 'phone' })).toMatchObject({ source: 'phone' });
    expect(ThreadItemSchema.parse({ kind: 'note', id: 'note-1', at: T, turn: 1, note: 'interrupt', source: 'pc' }).kind).toBe('note');
    expect(ThreadItemSchema.safeParse({ kind: 'note', id: 'note-1', at: T, turn: 1, note: 'launch' }).success).toBe(false);
  });
});
