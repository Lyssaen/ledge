import { describe, it, expect } from 'vitest';
import { groupSessions } from '@ledge/fleet';
import { displayOrder, headersBefore, tildePath } from '../src/surface/groups';
import { fakeSession } from './mockDaemon';

const a = fakeSession('a', { repo: 'ledge', repoPath: '/home/u/ledge', cwd: '/home/u/ledge', branch: 'main' });
const b = fakeSession('b', { repo: 'ledge', repoPath: '/home/u/ledge', cwd: '/home/u/ledge/.claude/worktrees/x', branch: 'worktree-x', worktree: true });
const c = fakeSession('c', { project: 'notes', cwd: '/home/u/notes' });

describe('display helpers', () => {
  it('counts the headers above a row', () => {
    const g = groupSessions([a, c, b]);
    expect(headersBefore(g, 'a')).toBe(1); expect(headersBefore(g, 'b')).toBe(1); expect(headersBefore(g, 'c')).toBe(2); expect(headersBefore(g, 'zz')).toBe(0);
  });
  it('displays interleaved repositories group by group', () => { expect(displayOrder([a, c, b]).map(s => s.id)).toEqual(['a', 'b', 'c']); });
  it('shortens the home folder', () => { expect(tildePath('/home/u/ledge')).toBe('~/ledge'); expect(tildePath('/srv/x')).toBe('/srv/x'); });
});
