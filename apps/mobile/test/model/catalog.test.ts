import { describe, expect, it } from 'vitest';
import type { PhoneRole, PhoneTemplate } from '@ledge/protocol';
import { autoSeats, catalogKey, parseCatalogKey, roleFor, rolesNotSeated, scopeLabel, teamsSeating } from '../../src/model/catalog';

const HASH = 'a'.repeat(16);
const role = (id: string, over: Partial<PhoneRole> = {}): PhoneRole => ({ id, label: id, prompt: '', scope: 'home', project: null, hash: HASH, ...over });
const template = (id: string, roles: string[], over: Partial<PhoneTemplate> = {}): PhoneTemplate => ({ id, name: id, seats: roles.map(r => ({ role: r })), scope: 'home', project: null, hash: HASH, ...over });

describe('catalog keys', () => {
  it('round-trips scope~project~id, a home definition having no project', () => {
    expect(catalogKey({ scope: 'home', project: null, id: 'lead' })).toBe('home~~lead');
    expect(catalogKey({ scope: 'repo', project: 'ledge', id: 'lead' })).toBe('repo~ledge~lead');
    expect(parseCatalogKey('home~~lead')).toEqual({ scope: 'home', project: null, id: 'lead' });
    expect(parseCatalogKey('repo~ledge~lead')).toEqual({ scope: 'repo', project: 'ledge', id: 'lead' });
  });

  it('keeps a project name with a space or a ~', () => {
    const x = { scope: 'repo' as const, project: 'mon dépôt~2', id: 'lead' };
    expect(parseCatalogKey(catalogKey(x))).toEqual(x);
  });

  it('refuses what is not a key', () => {
    expect(parseCatalogKey('new')).toBeNull();
    expect(parseCatalogKey('team~x~y')).toBeNull();
    expect(parseCatalogKey('repo~~lead')).toBeNull();
  });
});

describe('scopeLabel', () => {
  it('says « maison » or « dépôt <project> »', () => {
    expect(scopeLabel('home', null)).toBe('maison');
    expect(scopeLabel('repo', 'ledge')).toBe('dépôt ledge');
  });
});

describe('roleFor', () => {
  it('prefers the project\'s repo role over the home role of the same id', () => {
    const home = role('lead', { label: 'Maison' });
    const repo = role('lead', { label: 'Dépôt', scope: 'repo', project: 'ledge' });
    const catalog = { projects: ['ledge'], roles: [home, repo], templates: [], problems: [] };
    expect(roleFor(catalog, 'ledge', 'lead')).toBe(repo);
    expect(roleFor(catalog, 'other', 'lead')).toBe(home);
    expect(roleFor(catalog, null, 'lead')).toBe(home);
    expect(roleFor(catalog, 'ledge', 'nobody')).toBeUndefined();
  });
});

describe('seats', () => {
  const roles = [role('lead', { autonomy: 'auto' }), role('dev', { autonomy: 'edits' }), role('qa')];

  it('autoSeats counts the seats whose role has autonomy auto', () => {
    expect(autoSeats([{ role: 'lead' }, { role: 'dev' }, { role: 'qa' }, { role: 'ghost' }], roles)).toEqual(['lead']);
  });

  it('rolesNotSeated lists the roles no seat names', () => {
    expect(rolesNotSeated([{ role: 'lead' }], roles).map(r => r.id)).toEqual(['dev', 'qa']);
  });

  it('teamsSeating lists the templates that seat a role resolving to that file', () => {
    const templates = [
      template('home-team', ['lead', 'dev']),
      template('repo-team', ['lead'], { scope: 'repo', project: 'ledge' }),
      template('other-repo', ['lead'], { scope: 'repo', project: 'other' }),
      template('no-lead', ['dev'])
    ];
    expect(teamsSeating('lead', 'repo', 'ledge', templates).map(t => t.id)).toEqual(['home-team', 'repo-team']);
    expect(teamsSeating('lead', 'home', null, templates).map(t => t.id)).toEqual(['home-team', 'repo-team', 'other-repo']);
  });
});
