import { describe, expect, it } from 'vitest';
import { watchedSession } from '../src/notify/watching';

const base = { focused: true, agentView: true, placeId: 'local:a', helper: undefined as string | undefined };
describe('watchedSession', () => {
  it('the session page on its Terminal view counts', () => expect(watchedSession(base)).toBe('local:a'));
  it('a subagent page does not', () => expect(watchedSession({ ...base, helper: 'h1' })).toBeNull());
  it('the thread view does not', () => expect(watchedSession({ ...base, agentView: false })).toBeNull());
  it('an unfocused window does not', () => expect(watchedSession({ ...base, focused: false })).toBeNull());
  it('no session shown does not', () => expect(watchedSession({ ...base, placeId: null })).toBeNull());
});
