import { describe, expect, it } from 'vitest';
import type { Projects, RigSpec } from '@ledge/protocol';
import { emptyForm, folderChoices, launchable, launchOf, multiplies, rolesOf, seatTotal } from '../src/openrig/model';

const STARTER: RigSpec = { name: 'starter', source: 'builtin', path: '/o/rig.yaml', edges: 1, pods: [{ id: 'dev', members: [{ id: 'build', runtime: 'claude-code', agent: 'implementer' }, { id: 'review', runtime: 'codex', model: 'gpt-6-astra', agent: 'qa' }] }] };

describe('the launch form', () => {
  it('starts from the spec: its name, one seat per role', () => {
    const f = emptyForm(STARTER, '~/w');
    expect(rolesOf(STARTER).map(r => r.role)).toEqual(['dev.build', 'dev.review']);
    expect(seatTotal(STARTER, f)).toBe(2);
    expect(launchOf(STARTER, f, false)).toEqual({ spec: 'starter', cwd: '~/w', name: 'starter' });
  });
  it('sends only what differs: counts, a harness or a model the spec does not have, the delegation when a role has several seats', () => {
    const f = { ...emptyForm(STARTER, '/w'), name: ' scale ', seats: { 'dev.build': 3, 'dev.review': 1 }, runtimes: { 'dev.review': 'codex' as const }, models: { 'dev.review': 'gpt-6-astra', 'dev.build': 'opus' }, delegation: 'all' as const, save: true };
    expect(multiplies(f)).toBe(true);
    expect(seatTotal(STARTER, f)).toBe(4);
    expect(launchOf(STARTER, f, true)).toEqual({ spec: 'starter', cwd: '/w', name: 'scale', seats: { 'dev.build': 3 }, models: { 'dev.build': 'opus' }, delegation: 'all', save: true, plan: true });
  });
  it('needs a folder and a name rig takes', () => {
    expect(launchable(emptyForm(STARTER, ''))).toBe(false);
    expect(launchable({ ...emptyForm(STARTER, '/w'), name: '-x' })).toBe(false);
    expect(launchable(emptyForm(STARTER, '/w'))).toBe(true);
  });
  it('offers the folders of the Ledge projects on that machine', () => {
    const projects = { version: 1, projects: [{ id: 'p1', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }, { machine: 'ec2', path: '/srv/ledge' }] }] } as unknown as Projects;
    expect(folderChoices(projects, 'ec2')).toEqual([{ label: 'Ledge', path: '/srv/ledge' }]);
    expect(folderChoices(null, 'local')).toEqual([]);
  });
});
