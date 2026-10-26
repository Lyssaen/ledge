import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DaemonClient } from '@ledge/fleet';
import type { Role, Session, Team } from '@ledge/protocol';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { LangProvider } from '../src/i18n/lang';
import { CatalogView, type CatalogCtx } from '../src/teams/Catalog';
import type { RolesListing, TeamsApi } from '../src/teams/useTeamsApi';

afterEach(cleanup);

// #99: a folder read on another machine, online. The mock daemon has no SSH peer, so the view is drawn alone.
const DEV = '/srv/ledge';
const role: Role = { id: 'build', label: 'Builder', prompt: '', source: 'repo', path: `${DEV}/.ledge/roles/build.md`, tool: 'claude' };
const LISTING: RolesListing = {
  roles: [role],
  templates: [{ id: 'workshop', name: 'workshop', source: 'repo', path: `${DEV}/.ledge/teams/workshop.yaml`, seats: [{ role: 'build' }] }],
  problems: []
};
const PROJECTS = { projects: [{ id: 'ledge', name: 'Ledge', color: 'blue' as const, description: '', repos: [{ machine: 'local', path: '/w/ledge' }, { machine: 'dev', path: DEV }] }], rules: [] };

function draw(view: 'roles' | 'templates', listing: RolesListing = LISTING, live: { sessions?: Session[]; teams?: Team[] } = {}) {
  const dispatch = vi.fn();
  const ctx: CatalogCtx = {
    client: {} as DaemonClient, teams: { teams: live.teams ?? [], teamOf: () => undefined } as unknown as TeamsApi, sessions: live.sessions ?? [], projects: PROJECTS, dispatch, notify: () => {},
    machines: [{ id: 'local', label: 'Local', ready: true }, { id: 'dev', label: 'Dev SSH', ready: true }]
  };
  render(<LangProvider lang="en"><CatalogView ctx={ctx} view={view} cwd={DEV} machine="dev" listing={listing} pick={{}} onPick={() => {}} query="" onRetry={() => {}} /></LangProvider>);
  return { dispatch };
}

describe('« Teams » on another machine (#99)', () => {
  it('a role says where its file is and opens nothing here; « Start a session » launches on that machine; no team is set up there', async () => {
    const { dispatch } = draw('roles');
    const detail = within(screen.getByRole('region', { name: '@build' }));
    expect(detail.queryByRole('button', { name: 'Open' })).toBeNull();
    expect(detail.getByText('on Dev SSH')).toBeVisible();
    expect(detail.getByRole('button', { name: 'Copy' })).toBeVisible();
    expect(detail.getByRole('button', { name: 'Set up a team…' })).toBeDisabled();
    await userEvent.setup().click(detail.getByRole('button', { name: 'Start a session' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'modal', modal: expect.objectContaining({ kind: 'launch', project: 'ledge', cwd: DEV, machine: 'dev', role: expect.objectContaining({ id: 'build' }) }) });
  });

  it('a template is shown but not launched there', () => {
    draw('templates');
    const detail = within(screen.getByRole('region', { name: 'workshop' }));
    expect(detail.getByRole('button', { name: 'Launch this team…' })).toBeDisabled();
    expect(detail.getByText('A team launches on Local only: this folder is on Dev SSH.')).toBeVisible();
    expect(detail.queryByRole('button', { name: 'Open' })).toBeNull();
  });

  it('a daemon too old for the catalog is said, not taken for an empty folder', () => {
    draw('roles', { roles: [], templates: [], problems: [], error: 'outdated' });
    expect(screen.getByRole('alert')).toHaveTextContent('Dev SSH’s daemon is too old for the catalog: update Ledge there.');
    expect(screen.queryByText('No role in this folder.')).toBeNull();
  });

  it('a home role or template read on another machine counts only that machine\'s holders and teams (Otto)', () => {
    const home: Role = { ...role, source: 'home', path: '/remote-home/.ledge/roles/build.md' };
    const T0 = new Date().toISOString();
    const local = { ...fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', role: 'build' }), machineId: undefined };
    const remote = { ...fakeSession('dev:rex', { name: 'Rex', cwd: DEV, role: 'build' }), machineId: 'dev' };
    const team = (id: string, machine: string): Team => ({ id, name: `team-${machine}`, project: 'ledge', machine, cwd: machine === 'dev' ? DEV : '/w/ledge', template: 'workshop', state: 'active', seats: [], createdAt: T0, updatedAt: T0 });
    const homeListing: RolesListing = { roles: [home], templates: [{ ...LISTING.templates[0]!, source: 'home', path: '/remote-home/.ledge/teams/workshop.yaml' }], problems: [] };
    draw('roles', homeListing, { sessions: [local, remote], teams: [team('team-l', 'local'), team('team-d', 'dev')] });
    const detail = within(screen.getByRole('region', { name: '@build' }));
    expect(detail.getByText('Rex')).toBeVisible();
    expect(detail.queryByText('Otto')).toBeNull();
    cleanup();
    draw('templates', homeListing, { teams: [team('team-l', 'local'), team('team-d', 'dev')] });
    const tpl = within(screen.getByRole('region', { name: 'workshop' }));
    expect(tpl.getByText('team-dev')).toBeVisible();
    expect(tpl.queryByText('team-local')).toBeNull();
  });
});
