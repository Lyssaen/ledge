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
    const scopes = catalogScopes({ selected: session({}), memo: { folder: '/w/other' }, projects: PROJECTS, recents: ['/w/ledge', '/tmp/x'], homeOnly: 'Perso seulement' });
    expect(scopes).toEqual([
      { cwd: '/w/ledge', label: 'Ledge /w/ledge' }, { cwd: '/w/other', label: '/w/other' }, { cwd: '/w/website', label: 'Website /w/website' },
      { cwd: '/tmp/x', label: '/tmp/x' }, { cwd: null, label: 'Perso seulement' }
    ]);
  });

  it('opens on the selected session’s repository, else the last folder chosen (« Perso seulement » too), else the first', () => {
    const scopes = catalogScopes({ selected: null, memo: {}, projects: PROJECTS, recents: [], homeOnly: 'Perso' });
    expect(initialScope(scopes, session({ cwd: '/w/website', repoPath: '/w/website' }), {}).cwd).toBe('/w/website');
    expect(initialScope(scopes, null, { folder: null }).cwd).toBeNull();
    expect(initialScope(scopes, null, {}).cwd).toBe('/w/ledge');
    // A remote session's folder is not this machine's: the local daemon would not read it.
    expect(catalogScopes({ selected: session({ machineId: 'mac', cwd: '/w/site-mac', repoPath: '/w/site-mac' }), memo: {}, projects: PROJECTS, recents: [], homeOnly: 'Perso' })[0]!.cwd).toBe('/w/ledge');
  });

  it('a folder’s project is the one holding it locally, or a parent of it', () => {
    expect(projectOfFolder(PROJECTS, '/w/ledge-ssh')).toBe('ledge');
    expect(projectOfFolder(PROJECTS, '/w/website/src')).toBe('website');
    expect(projectOfFolder(PROJECTS, '/w/site-mac')).toBeNull();
    expect(projectOfFolder(PROJECTS, null)).toBeNull();
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
