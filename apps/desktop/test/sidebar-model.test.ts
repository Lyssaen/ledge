import { describe, expect, it } from 'vitest';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { projectOf } from '@ledge/fleet';
import { TWO_PROJECTS } from './helpers';
import { attentionOf, branchOf, eyeGroups, filterArchived, isLive, quickDecide, treeModel } from '../src/shell/sidebar/model';

const idOf = (s: ReturnType<typeof fakeSession>) => projectOf(s, TWO_PROJECTS);

describe('treeModel', () => {
  it('folds a single branch into the project and names it repo · branch', () => {
    const otto = fakeSession('otto', { cwd: '/w/ledge', branch: 'desktop', repo: 'harness-assistant' });
    const [g] = treeModel([otto], TWO_PROJECTS, idOf);
    expect(g).toMatchObject({ id: 'ledge', name: 'Ledge', repo: 'harness-assistant', flatten: true });
    expect(g!.branches).toEqual([expect.objectContaining({ branch: 'desktop', worktree: false, sessions: [otto] })]);
  });

  it('splits two branches and marks a linked worktree', () => {
    const a = fakeSession('a', { cwd: '/w/ledge', branch: 'desktop', repo: 'harness-assistant' });
    const b = fakeSession('b', { cwd: '/w/ledge', branch: 'release-0.6', worktree: true, repo: 'harness-assistant' });
    const [g] = treeModel([a, b], TWO_PROJECTS, idOf);
    expect(g!.flatten).toBe(false);
    expect(g!.branches.map(x => [x.branch, x.worktree, x.sessions.map(s => s.id)])).toEqual([
      ['desktop', false, [a.id]],
      ['release-0.6', true, [b.id]]
    ]);
  });

  it('treats a missing branch as main and keeps Sans projet flat', () => {
    const kit = fakeSession('kit', { cwd: '/tmp' });
    const [none] = treeModel([kit], TWO_PROJECTS, idOf).filter(g => g.id === null);
    expect(none).toMatchObject({ flatten: true });
    expect(none!.branches[0]!.branch).toBe('main');
    expect(none!.branches[0]!.sessions).toEqual([kit]);
  });

  it('keeps an empty project so the sidebar can still launch into it', () => {
    const ids = treeModel([], TWO_PROJECTS, idOf).map(g => g.id);
    expect(ids).toEqual(['ledge', 'pay']);
  });
});

describe('attentionOf', () => {
  it('oldest wait first, a helper-routed request is the helper', () => {
    const otto = fakeSession('otto', {
      state: 'waiting_permission', lastActivityAt: '2026-10-18T10:00:00.000Z',
      pending: { kind: 'permission', text: 'npm test', source: 'hook', helperId: 'h1' },
      helpers: [{ id: 'h1', kind: 'Explore', task: 'Lire', state: 'waiting_permission' }]
    });
    const kit = fakeSession('kit', { name: 'Kit', cwd: '/tmp', state: 'waiting_input', lastActivityAt: '2026-10-18T10:12:00.000Z', pending: { kind: 'question', text: 'Quel port ?', source: 'hook' } });
    const nova = fakeSession('nova', { state: 'working' });
    const items = attentionOf([nova, kit, otto], new Map([[otto.id, { since: '2026-10-18T09:48:00.000Z' }]]));
    expect(items.map(i => [i.session.name, i.helper?.kind, i.kind])).toEqual([
      ['Otto', 'Explore', 'approval'],
      ['Kit', undefined, 'question']
    ]);
    expect(items[0]!.since).toBe('2026-10-18T09:48:00.000Z');
  });
});

describe('quickDecide', () => {
  const pending = (kind: 'permission' | 'diff' | 'plan' | 'question', text = 'npm test') =>
    ({ kind, text, source: 'hook' as const });
  it('is Yes/No only for a permission or a diff, never a plan, a question, offline, or read-only', () => {
    const perm = fakeSession('a', { state: 'waiting_permission', pending: pending('permission') });
    const diff = fakeSession('b', { state: 'waiting_permission', pending: pending('diff', 'edit') });
    const plan = fakeSession('c', { state: 'waiting_permission', pending: pending('plan', '# Plan') });
    const question = fakeSession('d', { state: 'waiting_input', pending: pending('question', '?') });
    expect([perm, diff, plan, question, { ...perm, offline: true }, { ...perm, source: 'hook_only' as const }].map(quickDecide)).toEqual([
      true, true, false, false, false, false
    ]);
  });
});

describe('filterArchived / helpers', () => {
  it('branchOf, and a live agent: neither ended nor archived (docs/mockups/ledge-projects-eye.html)', () => {
    expect(branchOf({})).toBe('main');
    expect(branchOf({ branch: '  desktop ' })).toBe('desktop');
    for (const state of ['working', 'idle', 'waiting_input', 'waiting_permission', 'error', 'starting'] as const) expect(isLive(fakeSession('a', { state }))).toBe(true);
    expect(isLive(fakeSession('a', { state: 'idle', offline: true }))).toBe(true);
    expect(isLive(fakeSession('a', { state: 'exited' }))).toBe(false);
    expect(isLive(fakeSession('a', { state: 'idle', archivedAt: '2026-10-18T10:00:00.000Z' }))).toBe(false);
  });
  it('the eye: pressed, the projects with a live agent and how many it hides; released, every project, « Sans projet » with sessions', () => {
    const projects = { projects: [
      { id: 'ledge', name: 'Ledge', color: 'green' as const, description: '', repos: [{ machine: 'local', path: '/w/ledge' }] },
      { id: 'paper', name: 'Paper', color: 'amber' as const, description: '', repos: [{ machine: 'local', path: '/w/paper' }] },
      { id: 'empty', name: 'Empty', color: 'pink' as const, description: '', repos: [{ machine: 'local', path: '/w/empty' }] }
    ], rules: [] };
    const idOf = (s: { cwd: string }) => (s.cwd === '/w/ledge' ? 'ledge' : s.cwd === '/w/paper' ? 'paper' : s.cwd === '/w/empty' ? 'empty' : null);
    const sessions = [fakeSession('a', { cwd: '/w/ledge', state: 'idle' }), fakeSession('b', { cwd: '/w/paper', state: 'exited' }), fakeSession('c', { cwd: '/tmp', state: 'exited' })];
    const groups = treeModel(sessions, projects, idOf);
    const names = (r: { shown: { name: string }[] }) => r.shown.map(g => g.name);
    const pressed = eyeGroups(groups, true, { dragging: false });
    expect([names(pressed), pressed.hidden]).toEqual([['Ledge'], 3]);
    const released = eyeGroups(groups, false, { dragging: false });
    expect([names(released), released.hidden]).toEqual([['Ledge', 'Paper', 'Empty', 'Sans projet'], 0]);
    // Released, « Sans projet » shows only with sessions.
    expect(names(eyeGroups(treeModel(sessions.slice(0, 2), projects, idOf), false, { dragging: false }))).toEqual(['Ledge', 'Paper', 'Empty']);
    // A project dragged onto, or the filter, still shows.
    expect(names(eyeGroups(groups, true, { dragging: true }))).toEqual(['Ledge', 'Paper', 'Empty']);
    expect(names(eyeGroups(groups, true, { dragging: false, filter: 'paper' }))).toEqual(['Ledge', 'Paper']);
    // Nobody live: nothing shows, all counted; no session at all: nothing hidden (the tree's « no session yet »).
    const quiet = treeModel(sessions.slice(1), projects, idOf);
    expect([names(eyeGroups(quiet, true, { dragging: false })), eyeGroups(quiet, true, { dragging: false }).hidden]).toEqual([[], 4]);
    expect(eyeGroups(treeModel([], projects, idOf), true, { dragging: false })).toEqual({ shown: [], hidden: 0 });
  });
  it('filterArchived matches name, task and project', () => {
    const old = fakeSession('old', { name: 'Nova', topic: 'Migration', archivedAt: '2026-10-18T10:00:00.000Z' });
    expect(filterArchived([old], 'migr', () => 'Payment').map(s => s.id)).toEqual([old.id]);
    expect(filterArchived([old], 'zzz', () => 'Payment')).toEqual([]);
    expect(filterArchived([old], '', () => 'Payment')).toEqual([old]);
  });
});
