import { describe, expect, it } from 'vitest';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { projectOf } from '@ledge/fleet';
import { TWO_PROJECTS } from './helpers';
import { attentionOf, branchOf, filterArchived, isFinished, quickDecide, treeModel } from '../src/shell/sidebar/model';

const idOf = (s: ReturnType<typeof fakeSession>) => projectOf(s, TWO_PROJECTS);

const rigOf = (id: string) => ({ machine: 'local', rigId: id, rigName: id, seat: 's', pod: 'p', member: 'm' });
const aRig = (id: string, state: 'ready' | 'stopped' = 'ready', sessionId?: string) => ({ id, name: id, machine: 'local', cwd: '/w', projectId: null, offProject: false, lifecycle: 'running' as const, kernel: false,
  seats: [{ ref: 's@x', address: '@s', name: 's', runtime: 'claude-code', state, ...(sessionId ? { sessionId } : {}) }], repos: [] });

describe('treeModel', () => {
  it('a session paired to a known rig leaves Projets', () => {
    const otto = fakeSession('otto', { cwd: '/w/ledge' });
    const build = fakeSession('build', { cwd: '/w/ledge', rig: rigOf('r1') });
    const groups = treeModel([otto, build], TWO_PROJECTS, idOf, [aRig('r1', 'ready', build.id)]);
    expect(groups.flatMap(g => g.branches.flatMap(b => b.sessions)).map(s => s.id)).toEqual([otto.id]);
  });

  it('a session paired to an unknown rig stays in Projets', () => {
    const build = fakeSession('build', { cwd: '/w/ledge', rig: rigOf('gone') });
    const groups = treeModel([build], TWO_PROJECTS, idOf, [aRig('r1')]);
    expect(groups.flatMap(g => g.branches.flatMap(b => b.sessions)).map(s => s.id)).toEqual([build.id]);
  });

  it('a session whose seat is stopped stays in Projets', () => {
    const build = fakeSession('build', { cwd: '/w/ledge', rig: rigOf('r1') });
    const groups = treeModel([build], TWO_PROJECTS, idOf, [aRig('r1', 'stopped', build.id)]);
    expect(groups.flatMap(g => g.branches.flatMap(b => b.sessions)).map(s => s.id)).toEqual([build.id]);
  });

  it('the brain session is not listed in Projets, with or without rigs', () => {
    const otto = fakeSession('otto', { cwd: '/w/ledge' });
    const brain = fakeSession('Ledge', { cwd: '/home/u/.ledge/brain', brain: true });
    const ids = (rigs?: ReturnType<typeof aRig>[]) => treeModel([otto, brain], TWO_PROJECTS, idOf, rigs).flatMap(g => g.branches.flatMap(b => b.sessions)).map(s => s.id);
    expect(ids()).toEqual([otto.id]);
    expect(ids([aRig('r1')])).toEqual([otto.id]);
  });

  it('without rigs, nothing is filtered', () => {
    const build = fakeSession('build', { cwd: '/w/ledge', rig: rigOf('r1') });
    expect(treeModel([build], TWO_PROJECTS, idOf).flatMap(g => g.branches.flatMap(b => b.sessions))).toEqual([build]);
  });

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
    expect(items.map(i => (i.kind === 'escalation' ? ['escalation'] : [i.session.name, i.helper?.kind, i.kind]))).toEqual([
      ['Otto', 'Explore', 'approval'],
      ['Kit', undefined, 'question']
    ]);
    expect(items[0]!.since).toBe('2026-10-18T09:48:00.000Z');
  });

  it('the brain session never lands in À toi', () => {
    const brain = fakeSession('brain', { name: 'Ledge', brain: true, state: 'waiting_input', pending: { kind: 'question', text: 'Trust?', source: 'hook' } });
    expect(attentionOf([brain], new Map())).toEqual([]);
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
  it('branchOf and isFinished', () => {
    expect(branchOf({})).toBe('main');
    expect(branchOf({ branch: '  desktop ' })).toBe('desktop');
    expect(isFinished(fakeSession('a', { state: 'exited' }))).toBe(true);
    expect(isFinished(fakeSession('a', { state: 'idle' }))).toBe(true);
    expect(isFinished(fakeSession('a', { state: 'exited', offline: true }))).toBe(false);
    expect(isFinished(fakeSession('a', { state: 'working' }))).toBe(false);
    // A turn ended while a background subagent still works: the agent is not done until the subagent stops.
    const helper = { id: 'h1', kind: 'general-purpose', task: 'search', state: 'working' as const };
    expect(isFinished(fakeSession('a', { state: 'idle', helpers: [helper] }))).toBe(false);
    expect(isFinished(fakeSession('a', { state: 'idle', helpers: [{ ...helper, state: 'exited' }] }))).toBe(true);
  });
  it('filterArchived matches name, task and project', () => {
    const old = fakeSession('old', { name: 'Nova', topic: 'Migration', archivedAt: '2026-10-18T10:00:00.000Z' });
    expect(filterArchived([old], 'migr', () => 'Payment').map(s => s.id)).toEqual([old.id]);
    expect(filterArchived([old], 'zzz', () => 'Payment')).toEqual([]);
    expect(filterArchived([old], '', () => 'Payment')).toEqual([old]);
  });
});
