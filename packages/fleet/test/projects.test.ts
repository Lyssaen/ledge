import { describe, it, expect } from 'vitest';
import { ProjectsSchema, projectOf as protocolProjectOf, type Project, type Projects } from '@ledge/protocol';
import { newProjectId, projectOf, withoutProject, withProject, withRule } from '../src/projects';

const A: Project = { id: 'a', name: 'A', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] };
const B: Project = { id: 'b', name: 'B', color: 'green', description: '', repos: [{ machine: 'local', path: '/w/ledge/docs' }, { machine: 'devbox', path: '/w/api' }] };
const state: Projects = { projects: [A, B], rules: [{ machine: 'local', path: '/tmp/scratch', project: 'b' }] };
const at = (cwd: string, machineId?: string) => ({ cwd, machineId });

describe('projectOf', () => {
  it('is the protocol function, re-exported', () => { expect(projectOf).toBe(protocolProjectOf); });
});

describe('edits', () => {
  it('withProject replaces in place or appends', () => {
    expect(withProject(state, { ...A, name: 'A2' }).projects.map(p => p.name)).toEqual(['A2', 'B']);
    expect(withProject(state, { ...A, id: 'c', name: 'C', repos: [] }).projects.map(p => p.id)).toEqual(['a', 'b', 'c']);
  });
  it('withoutProject moves rules and repos, or drops them', () => {
    const moved = withoutProject(state, 'b', 'a');
    expect(moved.projects.map(p => p.id)).toEqual(['a']);
    expect(moved.projects[0]!.repos).toEqual([...A.repos, ...B.repos]);
    expect(moved.rules).toEqual([{ machine: 'local', path: '/tmp/scratch', project: 'a' }]);
    expect(withoutProject(state, 'b', null)).toEqual({ projects: [A], rules: [] });
  });
  it('withRule replaces the rule for the same folder and normalizes it', () => {
    expect(withRule(state, { machine: 'local', path: '/tmp/scratch/', project: 'a' }).rules).toEqual([{ machine: 'local', path: '/tmp/scratch', project: 'a' }]);
  });
  it('every edit result passes the schema', () => {
    for (const s of [withoutProject(state, 'b', 'a'), withRule(state, { machine: 'devbox', path: '/srv', project: 'a' })]) expect(ProjectsSchema.safeParse(s).success).toBe(true);
  });
});

describe('newProjectId', () => {
  it('slugs the name and avoids taken ids', () => {
    expect(newProjectId('Payment Service', [])).toBe('payment-service');
    expect(newProjectId('Payment Service', ['payment-service', 'payment-service-2'])).toBe('payment-service-3');
    expect(newProjectId('Entrepôt données', [])).toBe('entrepot-donnees');
    expect(newProjectId('!!!', [])).toBe('project');
  });
});
