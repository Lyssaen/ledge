import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_PROJECTS, type Projects } from '@ledge/protocol';
import { readProjects, writeProjects } from '../src/daemon/projects.js';
import { paths } from '../src/paths.js';

const file = () => join(mkdtempSync(join(tmpdir(), 'ledge-projects-')), 'projects.json');
const state: Projects = {
  projects: [
    { id: 'ledge', name: 'Ledge', color: 'blue', description: 'Agents', repos: [{ machine: 'local', path: '/w/ledge' }] },
    { id: 'api', name: 'Payment Service', color: 'green', description: '', repos: [{ machine: 'devbox', path: '/srv/api' }] }
  ],
  rules: [{ machine: 'local', path: '/tmp/scratch', project: 'api' }]
};

describe('projects file', () => {
  it('lives in the ledge dir', () => { expect(paths().projects).toBe(join(paths().dir, 'projects.json')); });
  it('is empty when absent, truncated, invalid or naming a missing project, and a bad file is left alone', () => {
    const f = file();
    expect(readProjects(f)).toEqual(DEFAULT_PROJECTS);
    writeFileSync(f, '{"projects":['); expect(readProjects(f)).toEqual(DEFAULT_PROJECTS);
    writeFileSync(f, JSON.stringify({ projects: [{ id: 'a', name: 'A', color: 'orange', repos: [] }], rules: [] })); expect(readProjects(f)).toEqual(DEFAULT_PROJECTS);
    writeFileSync(f, JSON.stringify({ projects: [], rules: [{ machine: 'local', path: '/w', project: 'gone' }] })); expect(readProjects(f)).toEqual(DEFAULT_PROJECTS);
    expect(readFileSync(f, 'utf8')).toContain('gone');   // untouched for the user to look at
  });
  it('round-trips a valid set', () => {
    const f = file(); writeProjects(state, f);
    expect(readProjects(f)).toEqual(state);
  });
});
