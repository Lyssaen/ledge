import { describe, it, expect } from 'vitest';
import { groupSessions, headersBefore, tildePath } from '../src/surface/groups';
import { fakeSession } from './mockDaemon';

const a = fakeSession('a', { repo: 'ledge', repoPath: '/home/u/ledge', cwd: '/home/u/ledge', branch: 'main' });
const b = fakeSession('b', { repo: 'ledge', repoPath: '/home/u/ledge', cwd: '/home/u/ledge/.claude/worktrees/x', branch: 'worktree-x', worktree: true });
const c = fakeSession('c', { project: 'notes', cwd: '/home/u/notes' });

describe('groupSessions', () => {
  it('groups by repository path in first-seen order, folders without a repository on their own', () => {
    const g = groupSessions([a, c, b]);
    expect(g.map(x => [x.label, x.sessions.map(s => s.id)])).toEqual([['ledge', ['a', 'b']], ['notes', ['c']]]);
    expect(g[0]!.path).toBe('/home/u/ledge');
  });
  it('counts the headers above a row', () => {
    const g = groupSessions([a, c, b]);
    expect(headersBefore(g, 'a')).toBe(1); expect(headersBefore(g, 'b')).toBe(1); expect(headersBefore(g, 'c')).toBe(2); expect(headersBefore(g, 'zz')).toBe(0);
  });
  it('shortens the home folder', () => { expect(tildePath('/home/u/ledge')).toBe('~/ledge'); expect(tildePath('/srv/x')).toBe('/srv/x'); });
});
