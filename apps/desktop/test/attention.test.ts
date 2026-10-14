import { describe, it, expect } from 'vitest';
import { needsAttention, visibleSessions } from '../src/fleet/attention';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
describe('attention', () => {
  it('waiting states need it, offline ones never', () => {
    expect(needsAttention(fakeSession('a', { state: 'waiting_permission' }))).toBe(true);
    expect(needsAttention(fakeSession('b', { state: 'waiting_input' }))).toBe(true);
    expect(needsAttention(fakeSession('c', { state: 'working' }))).toBe(false);
    expect(needsAttention(fakeSession('d', { state: 'waiting_input', offline: true }))).toBe(false);
  });
  it('the filter keeps order', () => {
    const list = [fakeSession('a', { state: 'working' }), fakeSession('b', { state: 'waiting_input' }), fakeSession('c', { state: 'waiting_permission' })];
    expect(visibleSessions(list, true).map(s => s.id)).toEqual(['b', 'c']);
    expect(visibleSessions(list, false)).toBe(list);
  });
});
