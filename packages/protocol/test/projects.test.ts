import { describe, it, expect } from 'vitest';
import { PROJECT_COLORS, ProjectsSchema, normalizePath, parseClientMessage, parseServerMessage, projectsProblems, type ProjectColor, type Projects, type Repo } from '../src/index.js';

const p = (id: string, name: string, repos: Repo[] = [], color: ProjectColor = 'blue') => ({ id, name, color, description: '', repos });
const r = (machine: string, path: string): Repo => ({ machine, path });

describe('projects schema', () => {
  it('has the eight mockup colours in order', () => {
    expect(Object.entries(PROJECT_COLORS)).toEqual([['blue', '#3b82f6'], ['green', '#10b981'], ['amber', '#f59e0b'], ['violet', '#8b5cf6'], ['teal', '#14b8a6'], ['pink', '#ec4899'], ['red', '#ef4444'], ['slate', '#64748b']]);
  });
  it('normalizes paths', () => {
    expect(normalizePath('/w/ledge/')).toBe('/w/ledge');
    expect(normalizePath('/w//ledge///app')).toBe('/w/ledge/app');
    expect(normalizePath('  /w/ledge  ')).toBe('/w/ledge');
    expect(normalizePath('/')).toBe('/');
  });
  it('accepts a valid set and trims names, defaults the description', () => {
    const out = ProjectsSchema.parse({ projects: [{ id: 'ledge', name: '  Ledge ', color: 'blue', repos: [r('local', '/w/ledge')] }], rules: [{ machine: 'devbox', path: '/srv/x', project: 'ledge' }] });
    expect(out.projects[0]).toEqual({ id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [r('local', '/w/ledge')] });
  });
  it('refuses an empty name, an unknown colour, a relative or non-normalized path, a bad id', () => {
    for (const bad of [p('a', '   '), { ...p('a', 'A'), color: 'orange' }, p('a', 'A', [r('local', 'w/x')]), p('a', 'A', [r('local', '/w/x/')]), p('A B', 'A')])
      expect(ProjectsSchema.safeParse({ projects: [bad], rules: [] }).success).toBe(false);
  });
  it('names every cross-project problem', () => {
    const state = { projects: [p('a', 'Ledge', [r('local', '/w/x')]), p('a', 'ledge ', [r('local', '/w/x')])], rules: [{ machine: 'local', path: '/w/y', project: 'zz' }, { machine: 'local', path: '/w/y', project: 'a' }] };
    expect(projectsProblems(state as Projects).map(x => x.code).sort()).toEqual(['duplicate_id', 'duplicate_name', 'duplicate_repo', 'duplicate_rule', 'unknown_project']);
    expect(ProjectsSchema.safeParse(state).success).toBe(false);
  });
  it('lets the same path live on two machines', () => {
    expect(projectsProblems({ projects: [p('a', 'A', [r('local', '/w/x')]), p('b', 'B', [r('devbox', '/w/x')])], rules: [] })).toEqual([]);
  });
  it('carries projects both ways', () => {
    const projects = { projects: [p('a', 'A')], rules: [] };
    expect(parseServerMessage({ type: 'projects', projects })).toEqual({ type: 'projects', projects });
    expect(parseClientMessage({ type: 'projects.set', projects })).toEqual({ type: 'projects.set', projects });
    expect(() => parseClientMessage({ type: 'projects.set', projects: { projects: [p('a', ''), p('a', 'B')], rules: [] } })).toThrow();
  });
});
