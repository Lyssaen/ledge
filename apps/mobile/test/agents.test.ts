import { describe, expect, it } from 'vitest';
import type { Session } from '@ledge/protocol';
import { agentsOf } from '../src/model/agents';

const T = '2026-10-14T10:00:00.000Z';
const s = (id: string, extra: Partial<Session> = {}): Session => ({ id, name: 'Otto', tool: 'claude', cwd: `/w/${id}`, project: 'x', title: 'Otto · x', tmuxSession: null, state: 'idle', helpers: [], startedAt: T, lastActivityAt: T, source: 'launcher', ...extra } as Session);
const pend = (extra: Partial<NonNullable<Session['pending']>> = {}) => ({ id: 'p1', version: 1, since: T, kind: 'permission' as const, text: 'pnpm test', source: 'hook' as const, risk: 'low' as const, ...extra });

describe('agentsOf', () => {
  it('groups by repository and puts the task title before the bot name', () => {
    const groups = agentsOf([
      s('a', { repo: 'ledge', repoPath: '/r/ledge', topic: 'Recherche de sessions', name: 'Bix', branch: 'session-search' }),
      s('b', { repo: 'site', repoPath: '/r/site', project: 'site' }),
      s('c', { repo: 'ledge', repoPath: '/r/ledge', topic: 'Badge', worktree: true })
    ]);
    expect(groups.map(g => [g.label, g.rows.map(r => r.sessionId)])).toEqual([['ledge', ['a', 'c']], ['site', ['b']]]);
    expect(groups[0]!.rows[0]).toMatchObject({ task: 'Recherche de sessions', botName: 'Bix', branch: 'session-search' });
    expect(groups[1]!.rows[0]!.task).toBe('site');
    expect(groups[0]!.rows[1]).toMatchObject({ worktree: true });
  });

  it('two sessions of the same repository keep distinct titles and branches', () => {
    const [g] = agentsOf([
      s('a', { repo: 'ledge', repoPath: '/r/ledge', topic: 'Un', branch: 'one' }),
      s('b', { repo: 'ledge', repoPath: '/r/ledge', topic: 'Deux', branch: 'two' })
    ]);
    expect(g!.rows.map(r => [r.task, r.branch])).toEqual([['Un', 'one'], ['Deux', 'two']]);
  });

  it('labels every state with text, not only colour', () => {
    const row = (x: Partial<Session>) => agentsOf([s('x', x)])[0]!.rows[0]!;
    expect(row({ state: 'working' }).status).toEqual({ tone: 'info', label: 'Au travail' });
    expect(row({ state: 'idle' }).status).toEqual({ tone: 'ok', label: 'Disponible' });
    expect(row({ state: 'exited' }).status).toEqual({ tone: 'muted', label: 'Terminée' });
    expect(row({ state: 'error' }).status).toEqual({ tone: 'danger', label: 'Erreur' });
    expect(row({ state: 'waiting_permission', pending: pend() }).status).toEqual({ tone: 'attention', label: 'Autorisation' });
    expect(row({ state: 'waiting_input', pending: pend({ kind: 'question', text: 'Quel thème ?' }) }).status).toEqual({ tone: 'attention', label: 'Question' });
    expect(row({ state: 'waiting_permission', pending: pend({ risk: 'high' }) }).status).toEqual({ tone: 'attention', label: 'Impact élevé' });
    expect(row({ state: 'waiting_permission', pending: pend({ id: undefined }) }).status.label).toBe('Autorisation');
  });

  it('last: the waiting request, else the first line of the reply, else a working line', () => {
    const last = (x: Partial<Session>) => agentsOf([s('x', x)])[0]!.rows[0]!.last;
    expect(last({ state: 'waiting_input', pending: pend({ kind: 'question', text: 'Quel thème ?' }) })).toBe('Quel thème ?');
    expect(last({ state: 'waiting_permission', pending: pend({ text: '\npnpm test\nsecond' }) })).toBe('pnpm test');
    expect(last({ lastReply: { text: '\nLa recherche est prête.\nDétails', at: T } })).toBe('La recherche est prête.');
    expect(last({ state: 'working' })).toBe('Travaille sur les dernières modifications.');
    expect(last({ state: 'idle' })).toBe('');
  });

  it('carries unread and the pending request', () => {
    const [g] = agentsOf([s('a', { unread: true, repoPath: '/r' }), s('b', { state: 'waiting_permission', pending: pend(), repoPath: '/r' }), s('c', { repoPath: '/r' })]);
    expect(g!.rows.map(r => r.unread)).toEqual([true, false, false]);
    expect(g!.rows[1]!.pending).toMatchObject({ pendingId: 'p1', sessionId: 'b' });
  });
});
