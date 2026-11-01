import { describe, it, expect } from 'vitest';
import type { Projects, Role, Session, Team } from '@ledge/protocol';
import { bySource, catalogScopes, heldBy, initialScope, projectOfFolder, stepIndex, usedIn } from '../src/tui/model/catalog.js';

const PROJECTS: Projects = {
  projects: [
    { id: 'ledge', name: 'Ledge', color: 'blue', repos: [{ machine: 'local', path: '/w/ledge' }, { machine: 'local', path: '/w/ledge-ssh' }] },
    { id: 'website', name: 'Website', color: 'green', repos: [{ machine: 'mac', path: '/w/site-mac' }, { machine: 'local', path: '/w/website' }] }
  ] as Projects['projects'],
  rules: []
};
const session = (o: Partial<Session>) => ({ id: 'otto', name: 'Otto', cwd: '/w/ledge/packages/a', repoPath: '/w/ledge', state: 'idle', ...o }) as Session;
const role = (id: string, source: 'repo' | 'home'): Role => ({ id, label: id, prompt: '', source, path: `/${source}/${id}.md` });

describe('« Équipes » (#97): the catalog’s folders', () => {
  it('the selected session’s repository, the last one chosen, each project’s first local one, the recents; then « Perso seulement »', () => {
    const scopes = catalogScopes({ selected: session({}), memo: { folder: '/w/other' }, projects: PROJECTS, recents: [{ machine: 'local', cwd: '/w/ledge' }, { machine: 'local', cwd: '/tmp/x' }], homeOnly: 'Perso seulement' });
    expect(scopes).toEqual([
      { cwd: '/w/ledge', machine: 'local', label: 'Ledge /w/ledge' }, { cwd: '/w/other', machine: 'local', label: '/w/other' }, { cwd: '/w/website', machine: 'local', label: 'Website /w/website' },
      { cwd: '/tmp/x', machine: 'local', label: '/tmp/x' }, { cwd: null, machine: 'local', label: 'Perso seulement' }
    ]);
  });

  it('opens on the selected session’s repository, else the last folder chosen (« Perso seulement » too), else the first', () => {
    const scopes = catalogScopes({ selected: null, memo: {}, projects: PROJECTS, recents: [], homeOnly: 'Perso' });
    expect(initialScope(scopes, session({ cwd: '/w/website', repoPath: '/w/website' }), {}).cwd).toBe('/w/website');
    expect(initialScope(scopes, null, { folder: null }).cwd).toBeNull();
    expect(initialScope(scopes, null, {}).cwd).toBe('/w/ledge');
  });

  it('a folder lives on its machine (#99): a remote session’s, a project only there, each machine’s recents; one « Perso seulement », local', () => {
    const projects: Projects = { ...PROJECTS, projects: [...PROJECTS.projects, { id: 'srv', name: 'Serveur', color: 'violet', repos: [{ machine: 'mac', path: '/srv/app' }] }] as Projects['projects'] };
    const selected = session({ machineId: 'mac', cwd: '/w/site-mac', repoPath: '/w/site-mac' });
    const scopes = catalogScopes({ selected, memo: {}, projects, recents: [{ machine: 'mac', cwd: '/m/tools' }, { machine: 'local', cwd: '/m/tools' }], homeOnly: 'Perso' });
    expect(scopes.map(x => [x.machine, x.cwd])).toEqual([
      ['mac', '/w/site-mac'], ['local', '/w/ledge'], ['local', '/w/website'], ['mac', '/srv/app'], ['mac', '/m/tools'], ['local', '/m/tools'], ['local', null]
    ]);
    expect(scopes[0]!.label).toBe('Website /w/site-mac');
    expect(initialScope(scopes, selected, {})).toMatchObject({ machine: 'mac', cwd: '/w/site-mac' });
    // The folder chosen last is found on its machine, not a same path elsewhere.
    expect(initialScope(scopes, null, { folder: '/m/tools', machine: 'local' })).toMatchObject({ machine: 'local', cwd: '/m/tools' });
    expect(initialScope(scopes, null, { folder: '/m/tools', machine: 'mac' })).toMatchObject({ machine: 'mac', cwd: '/m/tools' });
  });

  it('a folder’s project is the one holding it locally, or a parent of it', () => {
    expect(projectOfFolder(PROJECTS, '/w/ledge-ssh')).toBe('ledge');
    expect(projectOfFolder(PROJECTS, '/w/website/src')).toBe('website');
    expect(projectOfFolder(PROJECTS, '/w/site-mac')).toBeNull();
    expect(projectOfFolder(PROJECTS, null)).toBeNull();
    // On another machine, its repositories there (#99).
    expect(projectOfFolder(PROJECTS, '/w/site-mac/src', 'mac')).toBe('website');
    expect(projectOfFolder(PROJECTS, '/w/website', 'mac')).toBeNull();
  });
});

describe('« Équipes » (#97): a role’s detail', () => {
  it('groups the repository’s then the home’s; the templates it serves; the live sessions holding it, in the project', () => {
    expect(bySource([role('lead', 'home'), role('build', 'repo')])).toEqual({ repo: [role('build', 'repo')], home: [role('lead', 'home')] });
    const tpl = (id: string, roles: string[]) => ({ id, name: id, seats: roles.map(r => ({ role: r })), source: 'repo' as const, path: `/${id}.yaml` });
    expect(usedIn('review', [tpl('workshop', ['lead', 'review']), tpl('solo', ['build'])]).map(x => x.id)).toEqual(['workshop']);
    const team = { id: 'team-a1b2', name: 'ledge-roles', state: 'active' } as Team;
    const sessions = [session({ name: 'Nova', role: 'review', team: 'team-a1b2' }), session({ name: 'Mila', role: 'review', cwd: '/w/website', repoPath: '/w/website' }), session({ name: 'Old', role: 'review', state: 'exited' })];
    const projectIdOf = (s: Session) => projectOfFolder(PROJECTS, s.repoPath ?? s.cwd);
    expect(heldBy('review', sessions, [team], 'ledge', projectIdOf)).toEqual([{ name: 'Nova', team: 'ledge-roles' }]);
    expect(heldBy('review', sessions, [team], null, projectIdOf).map(x => x.name)).toEqual(['Nova', 'Mila']);
  });

  it('steps through a list, wrapping', () => {
    expect([stepIndex(3, 2, 1), stepIndex(3, 0, -1), stepIndex(0, 0, 1), stepIndex(3, -1, 1)]).toEqual([0, 2, 0, 0]);
  });
});
