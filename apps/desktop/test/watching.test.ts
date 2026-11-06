import { describe, expect, it } from 'vitest';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { watchedSession, watchedTab } from '../src/notify/watching';

const base = { focused: true, agentView: true, placeId: 'local:a', helper: undefined as string | undefined };
describe('watchedSession', () => {
  it('the session page on its Terminal view counts', () => expect(watchedSession(base)).toBe('local:a'));
  it('a subagent page does not', () => expect(watchedSession({ ...base, helper: 'h1' })).toBeNull());
  it('the thread view does not', () => expect(watchedSession({ ...base, agentView: false })).toBeNull());
  it('an unfocused window does not', () => expect(watchedSession({ ...base, focused: false })).toBeNull());
  it('no session shown does not', () => expect(watchedSession({ ...base, placeId: null })).toBeNull());
});

/** The IDE (final review, finding 2): the front tab of the focused group decides, from its own view, never the stored preference. */
describe('watchedTab', () => {
  const s = fakeSession('a', { name: 'A', tool: 'claude' });
  const at = { focused: true, session: s, helper: undefined as string | undefined };
  it('a session tab in front on its terminal counts', () => expect(watchedTab({ ...at, front: { kind: 'session', ref: s.id, view: 'terminal' } })).toBe(s.id));
  it('a seat tab too', () => expect(watchedTab({ ...at, front: { kind: 'seat', ref: s.id, view: 'terminal' } })).toBe(s.id));
  it('on its thread it does not', () => expect(watchedTab({ ...at, front: { kind: 'session', ref: s.id, view: 'thread' } })).toBeNull());
  it('a tab with no view of its own takes the session\'s default (the thread)', () => expect(watchedTab({ ...at, front: { kind: 'session', ref: s.id } })).toBeNull());
  it('a Changes tab in front silences nothing', () => expect(watchedTab({ ...at, front: { kind: 'changes', ref: s.id } })).toBeNull());
  it('the Atelier in front silences nothing', () => expect(watchedTab({ ...at, front: { kind: 'atelier', ref: 'main' } })).toBeNull());
  it('no tab, or no session known, silences nothing', () => {
    expect(watchedTab({ ...at, front: undefined })).toBeNull();
    expect(watchedTab({ ...at, session: undefined, front: { kind: 'session', ref: s.id, view: 'terminal' } })).toBeNull();
  });
  it('an unfocused window, or a subagent\'s page, does not', () => {
    expect(watchedTab({ ...at, focused: false, front: { kind: 'session', ref: s.id, view: 'terminal' } })).toBeNull();
    expect(watchedTab({ ...at, helper: 'h1', front: { kind: 'session', ref: s.id, view: 'terminal' } })).toBeNull();
  });
});
