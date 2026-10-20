import { describe, expect, it } from 'vitest';
import type { PhoneSession } from '@ledge/protocol';
import { agentsOf } from '../../src/model/agents';
import { pending as pend, session as s, T } from './fixtures';

describe('agentsOf', () => {
  it('groups by repository and puts the task title before the bot name', () => {
    const groups = agentsOf([
      s('a', { repo: 'ledge', topic: 'Recherche de sessions', name: 'Bix', branch: 'session-search' }),
      s('b', { repo: 'site', project: 'site' }),
      s('c', { repo: 'ledge', topic: 'Badge', worktree: true })
    ]);
    expect(groups.map(g => [g.label, g.rows.map(r => r.sessionId)])).toEqual([['ledge', ['a', 'c']], ['site', ['b']]]);
    expect(groups[0]!.rows[0]).toMatchObject({ task: 'Recherche de sessions', botName: 'Bix', branch: 'session-search' });
    expect(groups[1]!.rows[0]!.task).toBe('site');
    expect(groups[0]!.rows[1]).toMatchObject({ worktree: true });
  });

  it('a folder outside any repository is grouped by its project', () => {
    const groups = agentsOf([s('a', { project: 'notes' }), s('b', { repo: 'notes' }), s('c', { project: 'notes' })]);
    expect(groups.map(g => [g.label, g.rows.map(r => r.sessionId)])).toEqual([['notes', ['a', 'c']], ['notes', ['b']]]);
  });

  it('two sessions of the same repository keep distinct titles and branches', () => {
    const [g] = agentsOf([
      s('a', { repo: 'ledge', topic: 'Un', branch: 'one' }),
      s('b', { repo: 'ledge', topic: 'Deux', branch: 'two' })
    ]);
    expect(g!.rows.map(r => [r.task, r.branch])).toEqual([['Un', 'one'], ['Deux', 'two']]);
  });

  it('labels every state with text, not only colour', () => {
    const row = (x: Partial<PhoneSession>) => agentsOf([s('x', x)])[0]!.rows[0]!;
    expect(row({ state: 'working' }).status).toEqual({ tone: 'info', label: 'Au travail' });
    expect(row({ state: 'idle' }).status).toEqual({ tone: 'ok', label: 'Disponible' });
    expect(row({ state: 'exited' }).status).toEqual({ tone: 'muted', label: 'Terminée' });
    expect(row({ state: 'error' }).status).toEqual({ tone: 'danger', label: 'Erreur' });
    expect(row({ state: 'waiting_permission', pending: pend() }).status).toEqual({ tone: 'attention', label: 'Autorisation' });
    expect(row({ state: 'waiting_input', pending: pend({ kind: 'question', text: 'Quel thème ?', riskReason: 'question' }) }).status).toEqual({ tone: 'attention', label: 'Question' });
    expect(row({ state: 'waiting_permission', pending: pend({ risk: 'high', riskReason: 'pushes' }) }).status).toEqual({ tone: 'attention', label: 'Impact élevé' });
    expect(row({ state: 'waiting_permission', pending: pend({ key: '' }) }).status.label).toBe('Autorisation');
  });

  it('last: the waiting request, else the first line of the reply, else a working line', () => {
    const last = (x: Partial<PhoneSession>) => agentsOf([s('x', x)])[0]!.rows[0]!.last;
    expect(last({ state: 'waiting_input', pending: pend({ kind: 'question', text: 'Quel thème ?' }) })).toBe('Quel thème ?');
    expect(last({ state: 'waiting_permission', pending: pend({ text: '\npnpm test\nsecond' }) })).toBe('pnpm test');
    expect(last({ lastReply: { text: '\nLa recherche est prête.\nDétails', at: T } })).toBe('La recherche est prête.');
    expect(last({ state: 'working' })).toBe('Travaille sur les dernières modifications.');
    expect(last({ state: 'idle' })).toBe('');
  });

  it('carries unread and the pending request', () => {
    const [g] = agentsOf([s('a', { unread: true }), s('b', { state: 'waiting_permission', pending: pend() }), s('c')]);
    expect(g!.rows.map(r => r.unread)).toEqual([true, false, false]);
    expect(g!.rows[1]!.pending).toMatchObject({ key: 'p1', sessionId: 'b' });
  });
});
