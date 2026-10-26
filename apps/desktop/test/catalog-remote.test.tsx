import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DaemonClient } from '@ledge/fleet';
import type { Role } from '@ledge/protocol';
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

function draw(view: 'roles' | 'templates', listing: RolesListing = LISTING) {
  const dispatch = vi.fn();
  const ctx: CatalogCtx = {
    client: {} as DaemonClient, teams: { teams: [], teamOf: () => undefined } as unknown as TeamsApi, sessions: [], projects: PROJECTS, dispatch, notify: () => {},
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
});
