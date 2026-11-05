import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { PhoneProject, PhoneServerMessage } from '@ledge/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAssertion } from '../../src/link/webauthn';
import { ProjectsSection } from '../../src/screens/Projects';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

vi.mock('../../src/link/webauthn', () => ({ platformAvailable: vi.fn(), createCredential: vi.fn(), getAssertion: vi.fn() }));

// Réglages › Projets › « Dossiers… »: the project's folders, removing one, and adding one of this PC by browsing it.

const PROJECTS: PhoneProject[] = [{ id: 'ledge', name: 'Ledge', color: 'blue' }];
const assertion = { id: 'AQ', clientDataJSON: 'AQI', authenticatorData: 'Aw', signature: 'BAU' };
const HOME = '/home/u';

const snap = (o: { folders?: boolean; confirm?: boolean } = {}): PhoneServerMessage => ({
  ...snapshot([]), daemon: { version: '0.48.0', name: 'PC', atelier: true, projectEdit: true, ...(o.folders === false ? {} : { projectFolders: true }) },
  projects: PROJECTS, device: { confirm: o.confirm ?? true }
}) as PhoneServerMessage;
const listing = (path: string, entries: string[], extra: object = {}): PhoneServerMessage =>
  ({ type: 'folder.listing', path, parent: path === '/' ? null : path.split('/').slice(0, -1).join('/') || '/', entries, repos: [], ...extra }) as PhoneServerMessage;

function opened(o: Parameters<typeof snap>[0] = {}) {
  const t = setup();
  t.deliver(snap(o));
  render(<ProjectsSection store={t.store} />);
  return t;
}
const openFolders = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Modifier Ledge' }));
  fireEvent.click(screen.getByRole('button', { name: 'Dossiers…' }));
  return screen.getByRole('dialog', { name: 'Dossiers de Ledge' });
};
const result = (t: ReturnType<typeof opened>, type: string, status: 'applied' | 'rejected', reason?: string) =>
  act(() => t.deliver({ type: 'operation.result', op: (t.of(type as never).at(-1) as unknown as { op: string }).op, status, ...(reason ? { reason } : {}) } as PhoneServerMessage));

beforeEach(() => { vi.mocked(getAssertion).mockReset(); });

describe('« Dossiers… »: the list', () => {
  it('no « Dossiers… » from a PC that does not offer them', () => {
    opened({ folders: false });
    fireEvent.click(screen.getByRole('button', { name: 'Modifier Ledge' }));
    expect(screen.queryByRole('button', { name: 'Dossiers…' })).not.toBeInTheDocument();
  });

  it('asks the PC for the project\'s folders and shows each with where it is', () => {
    const t = opened();
    const sheet = openFolders();
    expect(t.of('project.folders')).toEqual([{ type: 'project.folders', id: 'ledge' }]);
    act(() => t.deliver({ type: 'project.folders', id: 'ledge', folders: [{ machine: 'local', path: `${HOME}/code/ledge` }, { machine: 'srv', label: 'Serveur', path: '/srv/api' }] }));
    expect(within(sheet).getByText(`${HOME}/code/ledge · ce PC`)).toBeInTheDocument();
    expect(within(sheet).getByText('/srv/api · Serveur')).toBeInTheDocument();
  });

  it('« Retirer » sends that folder of that machine, then asks for the list again', async () => {
    const t = opened();
    const sheet = openFolders();
    act(() => t.deliver({ type: 'project.folders', id: 'ledge', folders: [{ machine: 'srv', label: 'Serveur', path: '/srv/api' }] }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Retirer /srv/api' }));
    expect(t.of('project.folder.remove')).toEqual([expect.objectContaining({ id: 'ledge', machine: 'srv', path: '/srv/api' })]);
    result(t, 'project.folder.remove', 'applied');
    await waitFor(() => expect(t.of('project.folders')).toHaveLength(2));
  });
});

describe('« Ajouter un dossier »: browsing this PC', () => {
  const pick = (t: ReturnType<typeof opened>) => {
    const sheet = openFolders();
    act(() => t.deliver({ type: 'project.folders', id: 'ledge', folders: [] }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Ajouter un dossier' }));
    return screen.getByRole('dialog', { name: 'Ajouter un dossier' });
  };

  it('asks for the recent folders and the home, then goes into a folder and back to its parent', () => {
    const t = opened();
    const sheet = pick(t);
    expect(t.of('folder.recents')).toHaveLength(1);
    expect(t.of('folder.list')).toEqual([{ type: 'folder.list' }]);
    act(() => { t.deliver({ type: 'folder.recents', paths: [`${HOME}/code/ledge`] }); t.deliver(listing(HOME, ['code', 'docs'])); });
    expect(within(sheet).getByRole('region', { name: 'Récents' })).toHaveTextContent(`${HOME}/code/ledge`);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Ouvrir code' }));
    expect(t.of('folder.list').at(-1)).toEqual({ type: 'folder.list', path: `${HOME}/code` });
    expect(within(sheet).getByText('Lecture du dossier…')).toBeInTheDocument();
    act(() => t.deliver(listing(`${HOME}/code`, ['ledge'], { repos: [{ name: 'ledge', branch: 'main' }] })));
    expect(within(sheet).getByText('⎇ main')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Dossier parent' }));
    expect(t.of('folder.list').at(-1)).toEqual({ type: 'folder.list', path: HOME });
  });

  it('a folder the PC cannot read says why and cannot be added', () => {
    const t = opened();
    const sheet = pick(t);
    act(() => t.deliver(listing(HOME, [], { error: 'unreadable' })));
    expect(within(sheet).getByRole('alert')).toHaveTextContent('Le PC ne peut pas lire ce dossier.');
    expect(within(sheet).getByRole('button', { name: `Ajouter ${HOME}` })).toBeDisabled();
  });

  it('« Ajouter ce dossier » adds the folder shown with the device\'s check bound to it, then the list comes back', async () => {
    vi.mocked(getAssertion).mockResolvedValue(assertion);
    const t = opened();
    const sheet = pick(t);
    act(() => t.deliver(listing(`${HOME}`, ['code'])));
    fireEvent.click(within(sheet).getByRole('button', { name: `Ajouter ${HOME}` }));
    await waitFor(() => expect(t.of('confirm.prepare')).toEqual([expect.objectContaining({ purpose: 'folder', project: 'ledge', path: HOME })]));
    act(() => t.deliver({ type: 'confirm.challenge', purpose: 'folder', challenge: 'Y2hhbGw', rpId: 'relay.example', credentialId: 'AQ', expiresInMs: 60_000 }));
    await waitFor(() => expect(t.of('project.folder.add')).toEqual([expect.objectContaining({ id: 'ledge', path: HOME, assertion })]));
    result(t, 'project.folder.add', 'applied');
    expect(await screen.findByRole('dialog', { name: 'Dossiers de Ledge' })).toBeInTheDocument();
    expect(t.of('project.folders')).toHaveLength(2);
  });

  it('a folder another project has is said, the picker stays', async () => {
    vi.mocked(getAssertion).mockResolvedValue(assertion);
    const t = opened();
    const sheet = pick(t);
    act(() => t.deliver({ type: 'folder.recents', paths: [`${HOME}/code/ledge`] }));
    fireEvent.click(within(sheet).getByRole('button', { name: `Ajouter ${HOME}/code/ledge` }));
    await waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(1));
    act(() => t.deliver({ type: 'confirm.challenge', purpose: 'folder', challenge: 'Y2hhbGw', rpId: 'relay.example', credentialId: 'AQ', expiresInMs: 60_000 }));
    await waitFor(() => expect(t.of('project.folder.add')).toHaveLength(1));
    result(t, 'project.folder.add', 'rejected', 'folder_taken');
    expect(await within(sheet).findByText('Un autre projet a déjà ce dossier.')).toBeInTheDocument();
  });

  it('without a passkey: said, and nothing can be added', () => {
    const t = opened({ confirm: false });
    const sheet = pick(t);
    act(() => t.deliver(listing(HOME, ['code'])));
    expect(within(sheet).getByText(/Protégez d’abord vos accords/)).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: `Ajouter ${HOME}` })).toBeDisabled();
  });
});
