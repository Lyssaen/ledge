import { describe, expect, it } from 'vitest';
import type { Project, ProjectColor, Projects, Repo, Session } from '@ledge/protocol';
import { projectOf, withProject, withoutProject } from '@ledge/fleet';
import { afterSave, alsoIn, COLOR_ORDER, deletion, draftOf, draftProblem, newDraft, removed, saved } from '../src/projects/draft';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';

const r = (machine: string, path: string): Repo => ({ machine, path });
const p = (id: string, color: ProjectColor, name = id, repos: Repo[] = []): Project => ({ id, name, color, description: '', repos });
const session = (extra: Partial<Session>): Session => fakeSession('x', { machineId: 'local', cwd: '/w/ledge', ...extra });

const ledge = p('ledge', 'blue', 'Ledge', [r('local', '/w/ledge')]);
const other = p('other', 'green', 'Other', [r('local', '/w/shared')]);
const state: Projects = { projects: [ledge, other], rules: [{ machine: 'local', path: '/w/ledge/docs', project: 'ledge' }] };
const ottoAtLedge = session({ id: 'local:otto', name: 'Otto', cwd: '/w/ledge/app' });
const milo = session({ id: 'local:milo', name: 'Milo', cwd: '/w/ledge/docs' });
const stray = session({ id: 'local:stray', name: 'Stray', cwd: '/w/elsewhere' });
const sessions = [ottoAtLedge, milo, stray];
const otto = session({ id: 'local:otto', machineId: 'local', cwd: '/w/scratch/notes' });
const sent: Project = { ...ledge, name: 'Ledge Desktop', description: 'd' };

describe('project draft', () => {
  it('colour order is the mockup order', () => {
    expect(COLOR_ORDER).toEqual(['blue', 'green', 'amber', 'violet', 'teal', 'pink', 'red', 'slate']);
  });
  it('a new project takes the first unused colour; from a session, its folder and the session itself', () => {
    expect(newDraft({ projects: [p('a', 'blue'), p('b', 'green')], rules: [] }).color).toBe('amber');
    expect(newDraft({ projects: COLOR_ORDER.map(c => p(c, c)), rules: [] }).color).toBe('blue');
    expect(newDraft(state, otto)).toMatchObject({ repos: [{ machine: 'local', path: '/w/scratch/notes' }], file: ['local:otto'], name: '' });
    expect(newDraft(state)).toMatchObject({ repos: [], file: [] });
  });
  it('draftOf copies the project without sharing its repos', () => {
    const d = draftOf(ledge);
    expect(d).toEqual({ id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [r('local', '/w/ledge')], file: [] });
    expect(d.repos).not.toBe(ledge.repos);
  });
  it('the first problem: gone, empty name, taken name (case and accents), duplicate repo', () => {
    expect(draftProblem({ ...draftOf(ledge), id: 'deleted' }, state)).toEqual({ code: 'gone' });
    expect(draftProblem({ ...newDraft(state), name: '  ' }, state)).toEqual({ code: 'name_empty' });
    expect(draftProblem({ ...newDraft(state), name: 'LÉDGE' }, state)).toEqual({ code: 'name_taken' });
    expect(draftProblem({ ...draftOf(ledge), name: 'Ledge' }, state)).toBeNull();
    expect(draftProblem({ ...draftOf(ledge), name: 'other' }, state)).toEqual({ code: 'name_taken' });
    expect(draftProblem({ ...newDraft(state), name: 'X', repos: [r('local', '/a'), r('local', '/a')] }, state)).toEqual({ code: 'repo_duplicate', index: 1 });
    expect(draftProblem({ ...newDraft(state), name: 'X', repos: [r('local', '/a'), r('lab', '/a')] }, state)).toBeNull();
  });
  it('a repo another project owns is taken (paths normalized, per machine), after a duplicate; the draft\'s own repos are not', () => {
    expect(draftProblem({ ...newDraft(state), name: 'X', repos: [r('local', '/a'), r('local', '/w/shared/')] }, state)).toEqual({ code: 'repo_taken', index: 1, project: 'other' });
    expect(draftProblem({ ...draftOf(ledge), repos: [r('local', '/w/ledge'), r('local', '/w/shared')] }, state)).toEqual({ code: 'repo_taken', index: 1, project: 'other' });
    expect(draftProblem({ ...newDraft(state), name: 'X', repos: [r('lab', '/w/shared')] }, state)).toBeNull();
    expect(draftProblem({ ...draftOf(ledge), repos: [r('local', '/w/ledge')] }, state)).toBeNull();
    expect(draftProblem({ ...newDraft(state), name: 'X', repos: [r('local', '/w/shared'), r('local', '/a'), r('local', '/a')] }, state)).toEqual({ code: 'repo_duplicate', index: 2 });
  });
  it('alsoIn names another project owning the repo, never the draft’s own', () => {
    expect(alsoIn(r('local', '/w/shared'), draftOf(ledge), state)).toBe(other);
    expect(alsoIn(r('local', '/w/ledge'), draftOf(ledge), state)).toBeUndefined();
    expect(alsoIn(r('local', '/w/ledge'), newDraft(state), state)).toBe(ledge);
  });
  it('repo paths are compared and sent normalized', () => {
    expect(draftProblem({ ...newDraft(state), name: 'X', repos: [r('local', '/a/'), r('local', '/a')] }, state)).toEqual({ code: 'repo_duplicate', index: 1 });
    expect(alsoIn(r('local', '/w/shared/'), draftOf(ledge), state)).toBe(other);
    const x = p('x', 'teal', 'X', [r('local', '/w/x')]);
    expect(alsoIn(r('local', '/w/x/'), newDraft(state), { projects: [x], rules: [] })).toBe(x);
    const { next } = afterSave(state, { ...newDraft(state), name: 'Y', repos: [r('local', ' /w/x// ')] }, []);
    expect(next.projects.find(q => q.id === 'y')!.repos).toEqual([r('local', '/w/x')]);
  });
  it('saving keeps the id on rename, slugs a new one, and files the checked sessions', () => {
    expect(afterSave(state, { ...draftOf(ledge), name: 'Ledge Desktop' }, []).id).toBe('ledge');
    const { next, id } = afterSave(state, { ...newDraft(state, otto), name: 'Notes' }, [otto]);
    expect(id).toBe('notes');
    expect(next.projects.find(x => x.id === 'notes')).toMatchObject({ name: 'Notes', repos: [r('local', '/w/scratch/notes')] });
    expect(next.rules).toContainEqual({ machine: 'local', path: '/w/scratch/notes', project: 'notes' });
    expect(afterSave(state, { ...draftOf(ledge), name: 'Ledge Desktop' }, [otto]).next.rules).toEqual(state.rules);
  });
  it('deletion counts the agents at the table and the rules; confirmation reads the broadcast', () => {
    expect(deletion(state, 'ledge', sessions, s => projectOf(s, state))).toEqual({ agents: [ottoAtLedge, milo], rules: 1 });
    expect(saved(withProject(state, sent), sent)).toBe(true);
    expect(saved(state, sent)).toBe(false);
    expect(saved(withProject(state, { ...sent, repos: [] }), sent)).toBe(false);
    expect(removed(withoutProject(state, 'ledge', null), 'ledge')).toBe(true);
    expect(removed(state, 'ledge')).toBe(false);
  });
});
