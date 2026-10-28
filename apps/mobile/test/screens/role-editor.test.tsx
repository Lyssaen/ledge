import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhoneCatalog, PhoneRole } from '@ledge/protocol';
import { goBack } from '../../src/router';
import { RoleEditor } from '../../src/screens/RoleEditor';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

// `goBack` branches on the router's module-level history position, which every hash change moves: its own behaviour is the router's
// (router.test.ts), so the editor is tested on what it asks of it, whatever order the tests run in.
vi.mock('../../src/router', async importOriginal => ({ ...(await importOriginal<typeof import('../../src/router')>()), goBack: vi.fn() }));
afterEach(() => { vi.useRealTimers(); });
beforeEach(() => { vi.mocked(goBack).mockClear(); globalThis.location.hash = '#/role/x'; });

const HASH = 'a'.repeat(16);
const OTHER = 'b'.repeat(16);
const PROMPT = 'x'.repeat(212);
const role = (id: string, extra: Partial<PhoneRole> = {}): PhoneRole => ({ id, label: id, prompt: 'p', scope: 'home', project: null, hash: HASH, ...extra });
const catalog = (extra: Partial<PhoneCatalog> = {}): PhoneCatalog => ({
  projects: ['ledge', 'paper-service'],
  roles: [
    role('leader', { label: 'Chef d’équipe', prompt: PROMPT, tool: 'claude', model: 'opus', autonomy: 'ask' }),
    role('dev', { label: 'Développeur', prompt: 'Tu codes.' }),
    role('dev', { label: 'Dev du dépôt', prompt: 'Tu codes ici.', scope: 'repo', project: 'ledge', shadows: true })
  ],
  templates: [
    { id: 'revue-mr', name: 'Revue MR', scope: 'home', project: null, hash: HASH, seats: [{ role: 'leader' }, { role: 'reviewer' }] },
    { id: 'feature-tdd', name: 'Feature TDD', scope: 'repo', project: 'paper-service', hash: HASH, seats: [{ role: 'dev' }] }
  ],
  problems: [],
  ...extra
});

/** The editor of `key` on a PC that has answered with `c`. */
function open(key: string, c: PhoneCatalog = catalog(), { confirm = true } = {}) {
  const t = setup();
  t.deliver(snapshot([], 'PC-Desan', undefined, { confirm, chat: true }));
  act(() => t.deliver({ type: 'teams.catalog', catalog: c }));
  const view = render(<RoleEditor store={t.store} roleKey={key} />);
  const define = vi.spyOn(t.store, 'define').mockResolvedValue({ status: 'applied' });
  return { ...t, view, define };
}
const type = (name: string | RegExp, value: string) => fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } });
const save = () => screen.getByRole('button', { name: 'Enregistrer le rôle' });

describe('the role editor', () => {
  it('typing the id « Dev » shows the id rule and disables save', () => {
    open('new');
    type('Identifiant', 'Dev');
    type('Libellé', 'Dev');
    const id = screen.getByRole('textbox', { name: 'Identifiant' });
    // The rule is the error: it is what the field says is wrong, and it turns to the error tone.
    expect(id).toHaveAttribute('aria-invalid', 'true');
    expect(id).toHaveAccessibleDescription(/Minuscules, chiffres, - et _/);
    expect(screen.getByText(/Minuscules, chiffres, - et _/)).toHaveClass('text-danger-fg');
    expect(save()).toBeDisabled();
    // A valid id is not flagged, and the rule goes back to a plain hint.
    type('Identifiant', 'dev');
    expect(id).toHaveAttribute('aria-invalid', 'false');
    expect(id).not.toHaveAccessibleDescription();
    expect(screen.getByText(/Minuscules, chiffres, - et _/)).not.toHaveClass('text-danger-fg');
  });

  it('counts the prompt as n/8000, and blocks typing past 8000', () => {
    open('home~~leader');
    expect(screen.getByText('212/8000')).toBeInTheDocument();
    const prompt = screen.getByRole('textbox', { name: /Consigne/ });
    expect(prompt).toHaveAttribute('maxlength', '8000');
    fireEvent.change(prompt, { target: { value: 'y'.repeat(8000) } });
    expect(screen.getByText('8000/8000')).toBeInTheDocument();
    fireEvent.change(prompt, { target: { value: 'y'.repeat(8001) } });
    expect(screen.getByText('8000/8000')).toBeInTheDocument();
  });

  it('saves a new role with base null, and only the defaults that were given', async () => {
    const t = open('new');
    type('Identifiant', 'tester');
    type('Libellé', 'Testeur');
    type(/Consigne/, 'Tu testes.');
    expect(save()).toBeEnabled();
    await act(async () => { fireEvent.click(save()); });
    expect(t.define).toHaveBeenCalledTimes(1);
    // Strict draft: no `project` on a home scope, no empty default.
    expect(t.define.mock.calls[0]![0]).toStrictEqual({ type: 'role.write', scope: 'home', role: { id: 'tester', label: 'Testeur', prompt: 'Tu testes.' }, base: null });
    expect(goBack).toHaveBeenCalledExactlyOnceWith({ name: 'teams' });
  });

  it('saves a new Dépôt role on the project picked, with its defaults', async () => {
    const t = open('new');
    type('Identifiant', 'tester');
    type('Libellé', 'Testeur');
    fireEvent.click(screen.getByRole('radio', { name: 'Dépôt paper-service' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Outil' }), { target: { value: 'codex' } });
    type('IA', 'gpt-5');
    type('Effort', 'high');
    fireEvent.change(screen.getByRole('combobox', { name: 'Autonomie' }), { target: { value: 'edits' } });
    await act(async () => { fireEvent.click(save()); });
    expect(t.define.mock.calls[0]![0]).toStrictEqual({
      type: 'role.write', scope: 'repo', project: 'paper-service',
      role: { id: 'tester', label: 'Testeur', prompt: '', tool: 'codex', model: 'gpt-5', effort: 'high', autonomy: 'edits' }, base: null
    });
  });

  it('a Dépôt scope is offered per catalog project; an id taken in the chosen scope disables save and says so', () => {
    open('new');
    expect(screen.getAllByRole('radio').map(r => (r as HTMLInputElement).labels?.[0]?.textContent)).toEqual(['Maison', 'Dépôt ledge', 'Dépôt paper-service']);
    type('Identifiant', 'leader');
    type('Libellé', 'Chef');
    expect(screen.getByRole('alert')).toHaveTextContent('Cet identifiant est déjà pris');
    expect(save()).toBeDisabled();
    // The same id is free in another scope.
    fireEvent.click(screen.getByRole('radio', { name: 'Dépôt paper-service' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(save()).toBeEnabled();
  });

  it('saves an existing role with its own id, scope and hash as base; its id and scope are fixed', async () => {
    const t = open('home~~leader', catalog({ roles: [role('leader', { label: 'Chef d’équipe', prompt: PROMPT, tool: 'claude', model: 'opus', hash: OTHER })] }));
    expect(screen.queryByRole('textbox', { name: 'Identifiant' })).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByText('@leader')).toBeInTheDocument();
    type('Libellé', 'Chef');
    await act(async () => { fireEvent.click(save()); });
    expect(t.define.mock.calls[0]![0]).toStrictEqual({
      type: 'role.write', scope: 'home', role: { id: 'leader', label: 'Chef', prompt: PROMPT, tool: 'claude', model: 'opus' }, base: OTHER
    });
  });

  it('a Dépôt role is saved on its own project; the line says which role hides which', async () => {
    const t = open('repo~ledge~dev');
    expect(screen.getByText('@dev de ce dépôt cache le @dev de Maison.')).toBeInTheDocument();
    await act(async () => { fireEvent.click(save()); });
    expect(t.define.mock.calls[0]![0]).toMatchObject({ scope: 'repo', project: 'ledge', base: HASH });
  });

  it('a Maison role hidden by repository roles names the projects that hide it', () => {
    open('home~~dev', catalog({ roles: [role('dev', { shadowed: true, shadowedIn: ['ledge', 'paper-service'] })] }));
    expect(screen.getByText('@dev de Maison est masqué dans ledge, paper-service.')).toBeInTheDocument();
  });

  it('a Maison role hidden by an older daemon (no project names) keeps the plain line', () => {
    open('home~~dev', catalog({ roles: [role('dev', { shadowed: true })] }));
    expect(screen.getByText('@dev de Maison est caché par le @dev du dépôt.')).toBeInTheDocument();
  });

  it('a cut role is read in full first: the textarea and save stay disabled until the teams.role reply, then the whole prompt is edited', async () => {
    const t = open('home~~leader', catalog({ roles: [role('leader', { label: 'Chef', prompt: 'x'.repeat(200), cut: true })] }));
    expect(t.of('teams.role')).toStrictEqual([{ type: 'teams.role', scope: 'home', id: 'leader' }]);
    const prompt = screen.getByRole('textbox', { name: /Consigne/ });
    expect(prompt).toBeDisabled();
    expect(save()).toBeDisabled();
    expect(t.define).not.toHaveBeenCalled();
    const full = 'z'.repeat(1500);
    act(() => t.deliver({ type: 'teams.role', role: role('leader', { label: 'Chef', prompt: full, hash: OTHER }) }));
    await screen.findByDisplayValue(full);
    expect(prompt).toBeEnabled();
    expect(screen.getByText('1500/8000')).toBeInTheDocument();
    await act(async () => { fireEvent.click(save()); });
    // The full prompt goes, never the cut one, over the hash of the role as read.
    expect(t.define.mock.calls[0]![0]).toMatchObject({ role: { id: 'leader', prompt: full }, base: OTHER });
  });

  it('a cut role that cannot be read says so with « Réessayer », and its prompt stays locked; retrying reads it again', async () => {
    const t = open('home~~leader', catalog({ roles: [role('leader', { label: 'Chef', prompt: 'x'.repeat(200), cut: true })] }));
    act(() => t.deliver({ type: 'error', code: 'invalid', request: 'teams.role' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Consigne/ })).toBeDisabled();
    expect(save()).toBeDisabled();
    fireEvent.click(within(alert).getByRole('button', { name: 'Réessayer' }));
    expect(t.of('teams.role')).toHaveLength(2);
    act(() => t.deliver({ type: 'teams.role', role: role('leader', { label: 'Chef', prompt: 'full', hash: OTHER }) }));
    await screen.findByDisplayValue('full');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('textbox', { name: /Consigne/ })).toBeEnabled();
  });

  it('« changed » says « le fichier a changé sur le PC », asks for the catalog, keeps the text, and the next save names the new hash', async () => {
    const t = open('home~~leader');
    t.define.mockResolvedValueOnce({ status: 'rejected', reason: 'changed' });
    type(/Consigne/, 'Mon texte');
    const asked = t.of('teams.catalog').length;
    await act(async () => { fireEvent.click(save()); });
    expect(screen.getByRole('status')).toHaveTextContent('le fichier a changé sur le PC');
    expect(t.of('teams.catalog').length).toBe(asked + 1);
    expect(screen.getByRole('textbox', { name: /Consigne/ })).toHaveValue('Mon texte');
    // Not yet reloaded: the next save would still carry the old base, so it waits for the new version.
    expect(save()).toBeDisabled();
    act(() => t.deliver({ type: 'teams.catalog', catalog: catalog({ roles: [role('leader', { label: 'Chef d’équipe', prompt: 'Version du PC', hash: OTHER })] }) }));
    expect(screen.getByRole('textbox', { name: /Consigne/ })).toHaveValue('Mon texte');
    expect(save()).toBeEnabled();
    await act(async () => { fireEvent.click(save()); });
    expect(t.define.mock.calls[1]![0]).toMatchObject({ role: { prompt: 'Mon texte' }, base: OTHER });
    // « Reprendre la version du PC » is the other way out, before saving.
  });

  it('« Reprendre la version du PC » drops the unsaved text for the PC\'s', async () => {
    const t = open('home~~leader');
    t.define.mockResolvedValueOnce({ status: 'rejected', reason: 'changed' });
    type(/Consigne/, 'Mon texte');
    await act(async () => { fireEvent.click(save()); });
    act(() => t.deliver({ type: 'teams.catalog', catalog: catalog({ roles: [role('leader', { label: 'Chef d’équipe', prompt: 'Version du PC', hash: OTHER })] }) }));
    fireEvent.click(screen.getByRole('button', { name: 'Reprendre la version du PC' }));
    expect(screen.getByRole('textbox', { name: /Consigne/ })).toHaveValue('Version du PC');
  });

  it('« changed » on a cut role reads the role again before it can be saved', async () => {
    const t = open('home~~leader', catalog({ roles: [role('leader', { label: 'Chef', prompt: 'x'.repeat(200), cut: true })] }));
    act(() => t.deliver({ type: 'teams.role', role: role('leader', { label: 'Chef', prompt: 'full', hash: HASH }) }));
    await screen.findByDisplayValue('full');
    t.define.mockResolvedValueOnce({ status: 'rejected', reason: 'changed' });
    type(/Consigne/, 'Mon texte');
    await act(async () => { fireEvent.click(save()); });
    act(() => t.deliver({ type: 'teams.catalog', catalog: catalog({ roles: [role('leader', { label: 'Chef', prompt: 'y'.repeat(200), cut: true, hash: OTHER })] }) }));
    expect(t.of('teams.role')).toHaveLength(2);
    expect(screen.getByRole('textbox', { name: /Consigne/ })).toBeDisabled();
    expect(save()).toBeDisabled();
    act(() => t.deliver({ type: 'teams.role', role: role('leader', { label: 'Chef', prompt: 'new full', hash: OTHER }) }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('textbox', { name: /Consigne/ })).toHaveValue('Mon texte');
    expect(save()).toBeEnabled();
  });

  it('« exists » says the id is already taken', async () => {
    const t = open('new');
    t.define.mockResolvedValueOnce({ status: 'rejected', reason: 'exists' });
    type('Identifiant', 'tester');
    type('Libellé', 'Testeur');
    await act(async () => { fireEvent.click(save()); });
    expect(screen.getByRole('status')).toHaveTextContent('Cet identifiant est déjà pris.');
    expect(globalThis.location.hash).toBe('#/role/x');
  });

  it('a cancelled passkey is a quiet note; any other refusal says the role was not saved', async () => {
    const t = open('home~~dev');
    t.define.mockResolvedValueOnce({ status: 'cancelled' }).mockResolvedValueOnce({ status: 'failed' });
    await act(async () => { fireEvent.click(save()); });
    expect(screen.getByRole('status')).toHaveTextContent('Vérification annulée. Rien n’a été envoyé.');
    await act(async () => { fireEvent.click(save()); });
    expect(screen.getByRole('status')).toHaveTextContent('Pas enregistré.');
  });

  it('without a passkey, save is off and the editor sends to Connexion', () => {
    open('home~~dev', catalog(), { confirm: false });
    expect(save()).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Connexion' })).toHaveAttribute('href', '#/connection');
  });

  it('deleting a role seated by a template names it before confirming, then deletes on the role\'s hash and goes back to the tab', async () => {
    const t = open('home~~leader');
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('encore dans : Revue MR');
    expect(t.define).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Supprimer' })); });
    expect(t.define).toHaveBeenCalledWith({ type: 'role.delete', scope: 'home', id: 'leader', base: HASH });
    expect(globalThis.location.hash).toBe('#/teams');
  });

  it('a repository role lists only the definitions that could resolve it, and a role seated nowhere deletes without a list', () => {
    open('repo~ledge~dev');
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
    // « Feature TDD » is of another project: it reads the home role, not this one.
    expect(screen.getByRole('dialog')).not.toHaveTextContent('encore dans');
  });

  it('a refused delete stays on the sheet and says why', async () => {
    const t = open('home~~leader');
    t.define.mockResolvedValueOnce({ status: 'rejected', reason: 'changed' });
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Supprimer' })); });
    expect(within(screen.getByRole('dialog')).getByRole('status')).toHaveTextContent('le fichier a changé sur le PC');
  });

  it('a new role has no « Supprimer »; an unknown role says so', () => {
    const t = open('new');
    expect(screen.queryByRole('button', { name: 'Supprimer' })).toBeNull();
    t.view.unmount();
    render(<RoleEditor store={t.store} roleKey="home~~ghost" />);
    expect(screen.getByText('Ce rôle n’existe pas sur ce PC.')).toBeInTheDocument();
  });

  it('a write that resolves after the user left the editor does not navigate', async () => {
    const t = open('home~~dev');
    let settle!: (r: { status: 'applied' }) => void;
    t.define.mockReturnValueOnce(new Promise(r => { settle = r; }));
    fireEvent.click(save());
    t.view.unmount();
    await act(async () => { settle({ status: 'applied' }); });
    expect(goBack).not.toHaveBeenCalled();
    expect(globalThis.location.hash).toBe('#/role/x');
  });

  it('after « changed » on a delete, « Supprimer » waits for the new catalog', async () => {
    const t = open('home~~leader');
    t.define.mockResolvedValueOnce({ status: 'rejected', reason: 'changed' });
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
    const confirm = () => within(screen.getByRole('dialog')).getByRole('button', { name: 'Supprimer' });
    await act(async () => { fireEvent.click(confirm()); });
    expect(confirm()).toBeDisabled();
    act(() => t.deliver({ type: 'teams.catalog', catalog: catalog({ roles: [role('leader', { label: 'Chef', prompt: 'p', hash: OTHER })] }) }));
    expect(confirm()).toBeEnabled();
    await act(async () => { fireEvent.click(confirm()); });
    expect(t.define).toHaveBeenLastCalledWith({ type: 'role.delete', scope: 'home', id: 'leader', base: OTHER });
  });

  it('« exists » asks for the catalog again, so the taken id then shows as taken', async () => {
    const t = open('new');
    t.define.mockResolvedValueOnce({ status: 'rejected', reason: 'exists' });
    type('Identifiant', 'tester');
    type('Libellé', 'Testeur');
    const asked = t.of('teams.catalog').length;
    await act(async () => { fireEvent.click(save()); });
    expect(t.of('teams.catalog').length).toBe(asked + 1);
    act(() => t.deliver({ type: 'teams.catalog', catalog: catalog({ roles: [...catalog().roles, role('tester')] }) }));
    expect(screen.getByRole('alert')).toHaveTextContent('Cet identifiant est déjà pris');
    expect(save()).toBeDisabled();
  });

  it('a role deleted on the PC keeps the text on screen but cannot be saved or deleted over the old base', async () => {
    const t = open('home~~leader');
    t.define.mockResolvedValueOnce({ status: 'rejected', reason: 'changed' });
    type(/Consigne/, 'Mon texte');
    await act(async () => { fireEvent.click(save()); });
    act(() => t.deliver({ type: 'teams.catalog', catalog: catalog({ roles: [role('dev')] }) }));
    expect(screen.getByText(/Ce rôle n’existe plus sur le PC/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Consigne/ })).toHaveValue('Mon texte');
    expect(save()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Supprimer' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Reprendre la version du PC' })).toBeNull();
    expect(t.define).toHaveBeenCalledTimes(1);
  });

  it('the delete sheet lists every template that seats the role', () => {
    const base = catalog();
    open('home~~leader', catalog({ templates: [...base.templates, { id: 'autre', name: 'Autre', scope: 'home', project: null, hash: HASH, seats: [{ role: 'leader' }] }] }));
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('encore dans : Revue MR, Autre');
  });
});
