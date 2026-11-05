import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { PhoneProject, PhoneServerMessage } from '@ledge/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAssertion } from '../../src/link/webauthn';
import { moved, ProjectsSection } from '../../src/screens/Projects';
import { session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

vi.mock('../../src/link/webauthn', () => ({ platformAvailable: vi.fn(), createCredential: vi.fn(), getAssertion: vi.fn() }));

// Réglages › Projets: the list in its order with each project's agents; up and down, rename and recolour, a new empty project,
// a deletion after the device's check. Never a folder.

const PROJECTS: PhoneProject[] = [{ id: 'ledge', name: 'Ledge', color: 'blue' }, { id: 'bots', name: 'Bots', color: 'green' }, { id: 'site', name: 'Site', color: 'amber' }];
const assertion = { id: 'AQ', clientDataJSON: 'AQI', authenticatorData: 'Aw', signature: 'BAU' };

const snap = (o: { edit?: boolean; confirm?: boolean; projects?: PhoneProject[] } = {}): PhoneServerMessage => {
  const base = snapshot([session('a', { projectId: 'ledge' }), session('b', { projectId: 'ledge' }), session('c', { projectId: 'bots' })]);
  return {
    ...base, daemon: { version: '0.47.0', name: 'PC', atelier: true, ...(o.edit === false ? {} : { projectEdit: true }) },
    projects: o.projects ?? PROJECTS, device: { confirm: o.confirm ?? true }
  } as PhoneServerMessage;
};
function opened(o: Parameters<typeof snap>[0] = {}) {
  const t = setup();
  t.deliver(snap(o));
  const view = render(<ProjectsSection store={t.store} />);
  return { ...t, view };
}
const result = (t: ReturnType<typeof opened>, type: string, status: 'applied' | 'rejected' | 'failed', reason?: string) =>
  act(() => t.deliver({ type: 'operation.result', op: (t.of(type as never).at(-1) as unknown as { op: string }).op, status, ...(reason ? { reason } : {}) } as PhoneServerMessage));

beforeEach(() => { vi.mocked(getAssertion).mockReset(); });

describe('Réglages › Projets: the list', () => {
  it('nothing from a PC that does not take the changes', () => {
    const { view } = opened({ edit: false });
    expect(view.container).toBeEmptyDOMElement();
  });

  it('the projects in their order, each with its agents, and the folders said to stay on the PC', () => {
    opened();
    const rows = screen.getAllByRole('listitem');
    expect(rows.map(r => r.textContent)).toEqual([expect.stringContaining('Ledge2 agents'), expect.stringContaining('Bots1 agent'), expect.stringContaining('SiteAucun agent')]);
    expect(screen.getByText(/Les dossiers d’un projet .* se règlent sur le PC/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Monter Ledge' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Descendre Site' })).toBeDisabled();
  });

  it('« Descendre » sends the whole order with that project one place down', () => {
    const t = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Descendre Ledge' }));
    expect(t.of('project.order').map(m => m.ids)).toEqual([['bots', 'ledge', 'site']]);
    expect(screen.getByRole('button', { name: 'Descendre Bots' })).toBeDisabled();
  });

  it('an order the PC finds stale is said', async () => {
    const t = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Monter Site' }));
    result(t, 'project.order', 'rejected', 'stale');
    expect(await screen.findByText('Les projets ont changé sur le PC. Réessayez.')).toBeInTheDocument();
  });

  it('moved: one place up or down, nothing past an end', () => {
    expect(moved(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moved(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(moved(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
  });
});

describe('Réglages › Projets: edit and create', () => {
  it('« Modifier » sends only what changed, trimmed, and closes once applied', async () => {
    const t = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Modifier Bots' }));
    const sheet = screen.getByRole('dialog', { name: 'Modifier le projet' });
    fireEvent.change(within(sheet).getByRole('textbox'), { target: { value: '  Robots ' } });
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Rose' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Enregistrer' }));
    expect(t.of('project.edit')).toEqual([expect.objectContaining({ id: 'bots', name: 'Robots', color: 'pink' })]);
    result(t, 'project.edit', 'applied');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('a name another project has (accents and case aside) is said there, and cannot be saved', () => {
    const t = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Modifier Bots' }));
    const sheet = screen.getByRole('dialog', { name: 'Modifier le projet' });
    fireEvent.change(within(sheet).getByRole('textbox'), { target: { value: 'lédge' } });
    expect(within(sheet).getByRole('alert')).toHaveTextContent('Un autre projet porte déjà ce nom.');
    expect(within(sheet).getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
    expect(t.of('project.edit')).toEqual([]);
  });

  it('« Nouveau projet » offers the first colour not used, and sends name and colour', () => {
    const t = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Nouveau projet' }));
    const sheet = screen.getByRole('dialog', { name: 'Nouveau projet' });
    expect(within(sheet).getByRole('radio', { name: 'Violet' })).toBeChecked();
    fireEvent.change(within(sheet).getByRole('textbox'), { target: { value: 'Budget' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Créer' }));
    expect(t.of('project.create')).toEqual([expect.objectContaining({ name: 'Budget', color: 'violet' })]);
  });

  it('a name the PC refuses stays in the sheet with why', async () => {
    const t = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Nouveau projet' }));
    const sheet = screen.getByRole('dialog', { name: 'Nouveau projet' });
    fireEvent.change(within(sheet).getByRole('textbox'), { target: { value: 'Budget' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Créer' }));
    result(t, 'project.create', 'rejected', 'name_taken');
    expect(await within(sheet).findByText('Un autre projet porte déjà ce nom.')).toBeInTheDocument();
  });
});

describe('Réglages › Projets: delete', () => {
  const openDelete = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Modifier Ledge' }));
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer le projet…' }));
    return screen.getByRole('dialog', { name: 'Supprimer Ledge ?' });
  };

  it('says its agents, offers where they go, and deletes with the device\'s check bound to that choice', async () => {
    vi.mocked(getAssertion).mockResolvedValue(assertion);
    const t = opened();
    const sheet = openDelete();
    expect(within(sheet).getByText('2 agents y travaillent.')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Vers un autre projet' }));
    fireEvent.change(within(sheet).getByRole('combobox', { name: 'Projet de destination' }), { target: { value: 'site' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Supprimer' }));
    await waitFor(() => expect(t.of('confirm.prepare')).toEqual([expect.objectContaining({ purpose: 'project', project: 'ledge', moveTo: 'site' })]));
    act(() => t.deliver({ type: 'confirm.challenge', purpose: 'project', challenge: 'Y2hhbGw', rpId: 'relay.example', credentialId: 'AQ', expiresInMs: 60_000 }));
    await waitFor(() => expect(t.of('project.delete')).toEqual([expect.objectContaining({ id: 'ledge', moveTo: 'site', assertion })]));
    result(t, 'project.delete', 'applied');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('without a passkey: said, and « Supprimer » cannot be pressed', () => {
    const t = opened({ confirm: false });
    const sheet = openDelete();
    expect(within(sheet).getByText(/Protégez d’abord vos accords/)).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Supprimer' })).toBeDisabled();
    expect(t.of('confirm.prepare')).toEqual([]);
  });

  it('a passkey cancelled deletes nothing, and says so', async () => {
    vi.mocked(getAssertion).mockResolvedValue('cancelled');
    const t = opened();
    const sheet = openDelete();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Supprimer' }));
    await waitFor(() => expect(t.of('confirm.prepare')).toHaveLength(1));
    act(() => t.deliver({ type: 'confirm.challenge', purpose: 'project', challenge: 'Y2hhbGw', rpId: 'relay.example', credentialId: 'AQ', expiresInMs: 60_000 }));
    expect(await within(sheet).findByText('Vérification annulée. Rien n’a été supprimé.')).toBeInTheDocument();
    expect(t.of('project.delete')).toEqual([]);
  });
});
