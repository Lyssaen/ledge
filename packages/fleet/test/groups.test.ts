import { describe, it, expect } from 'vitest';
import { groupSessions } from '../src/groups';
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
  it('groups matching Git origins across hosts but not unrelated same-name folders', () => {
    const a = fakeSession('a', { machineId: 'local', repoId: 'github.com/org/repo' });
    const b = fakeSession('b', { machineId: 'server', cwd: '/other/repo', repoId: a.repoId });
    expect(groupSessions([a, b])).toHaveLength(1);
    expect(groupSessions([{ ...a, repoId: undefined }, { ...b, cwd: a.cwd, repoId: undefined }])).toHaveLength(2);
  });

  it('two spellings of one Windows folder make one group', () => {
    const w1 = fakeSession('w1', { project: 'work', cwd: 'C:\\Users\\po\\work' });
    const w2 = fakeSession('w2', { project: 'work', cwd: 'c:/users/po/work' });
    expect(groupSessions([w1, w2]).map(g => g.sessions.map(s => s.id))).toEqual([['w1', 'w2']]);
  });
});
