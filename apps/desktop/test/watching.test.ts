import { describe, expect, it } from 'vitest';
import { watchedSession } from '../src/notify/watching';

const base = { focused: true, terminal: true, placeId: 'local:a', helper: undefined as string | undefined, active: 'local:a#agent', agentTab: 'local:a#agent' };
describe('watchedSession', () => {
  it('the live agent tab on the session page counts', () => expect(watchedSession(base)).toBe('local:a'));
  it('a subagent page does not', () => expect(watchedSession({ ...base, helper: 'h1' })).toBeNull());
  it('another tab does not', () => expect(watchedSession({ ...base, active: 'local:a#shell-1' })).toBeNull());
  it('a hidden pane does not', () => expect(watchedSession({ ...base, terminal: false })).toBeNull());
  it('an unfocused window does not', () => expect(watchedSession({ ...base, focused: false })).toBeNull());
  it('no session shown does not', () => expect(watchedSession({ ...base, placeId: null })).toBeNull());
});
