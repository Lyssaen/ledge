import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhoneCatalog, PhoneRole, PhoneTeam, PhoneTemplate } from '@ledge/protocol';
import { goBack } from '../../src/router';
import { TeamEditor } from '../../src/screens/TeamEditor';
import type { TeamEditorMode } from '../../src/screens/TeamEditor';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

// `goBack` branches on the router's module-level history position, which every hash change moves: its own behaviour is the router's
// (router.test.ts), so the editor is tested on what it asks of it, whatever order the tests run in.
vi.mock('../../src/router', async importOriginal => ({ ...(await importOriginal<typeof import('../../src/router')>()), goBack: vi.fn() }));
afterEach(() => { vi.useRealTimers(); });
beforeEach(() => { vi.mocked(goBack).mockClear(); globalThis.location.hash = '#/team/x'; });

const HASH = 'a'.repeat(16);
const OTHER = 'b'.repeat(16);
const NOW = new Date().toISOString();
const role = (id: string, extra: Partial<PhoneRole> = {}): PhoneRole => ({ id, label: `Rôle ${id}`, prompt: 'p', scope: 'home', project: null, hash: HASH, ...extra });
const ROLES = ['leader', 'dev', 'qa', 'rev', 'build', 'doc', 'ops', 'sec', 'perf'];
const template = (extra: Partial<PhoneTemplate> = {}): PhoneTemplate => ({ id: 'revue-mr', name: 'Revue MR', scope: 'home', project: null, hash: HASH, seats: [{ role: 'leader' }, { role: 'dev' }], ...extra });
const catalog = (extra: Partial<PhoneCatalog> = {}): PhoneCatalog => ({
  projects: ['ledge', 'paper-service'],
  roles: [
    role('leader', { label: 'Chef d’équipe', tool: 'claude', model: 'opus', autonomy: 'ask' }),
    role('dev', { label: 'Développeur', tool: 'codex', model: 'gpt-5', autonomy: 'auto' }),
    ...ROLES.slice(2).map(id => role(id))
  ],
  templates: [template(), template({ id: 'feature-tdd', name: 'Feature TDD', scope: 'repo', project: 'paper-service', seats: [{ role: 'dev' }] })],
  problems: [],
  ...extra
});
const team = (extra: Partial<PhoneTeam> = {}): PhoneTeam => ({
  id: 'team-a1b2', name: 'Revue en cours', project: 'ledge', state: 'active', createdAt: NOW, done: 0, given: 0,
  seats: [{ role: 'leader', sessionId: 's1' }, { role: 'qa', sessionId: 's2' }, { role: 'dev', sessionId: 's3', model: 'gpt-4' }], ...extra
});

/** The editor on a PC that has answered with `c` and holds `teams`. `teamOp` and `define` are stubbed to apply. */
function open(mode: TeamEditorMode, { c = catalog(), teams = [team()], confirm = true }: { c?: PhoneCatalog; teams?: PhoneTeam[]; confirm?: boolean } = {}) {
  const t = setup();
  t.deliver(snapshot([], 'PC-Desan', undefined, { confirm, chat: true }));
  act(() => { t.deliver({ type: 'teams.catalog', catalog: c }); t.deliver({ type: 'teams', teams }); });
  const view = render(<TeamEditor store={t.store} mode={mode} />);
  const define = vi.spyOn(t.store, 'define').mockResolvedValue({ status: 'applied' });
  const teamOp = vi.spyOn(t.store, 'teamOp').mockResolvedValue({ status: 'applied' });
  return { ...t, view, define, teamOp };
}
const NEW: TeamEditorMode = { kind: 'template', key: 'new' };
const live: TeamEditorMode = { kind: 'live', teamId: 'team-a1b2' };
const copyOf: TeamEditorMode = { kind: 'copy', teamId: 'team-a1b2' };
const existing = (id = 'revue-mr', scope = 'home', project = ''): TeamEditorMode => ({ kind: 'template', key: `${scope}~${project}~${id}` });

const type = (name: string | RegExp, value: string) => fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } });
const click = async (name: string | RegExp) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })); }); };
const add = (id: string) => fireEvent.click(screen.getByRole('button', { name: `+ @${id}` }));
const remove = (id: string) => fireEvent.click(screen.getByRole('button', { name: `Retirer @${id}` }));
const save = () => screen.getByRole('button', { name: 'Enregistrer' });
const launch = () => screen.getByRole('button', { name: /^Lancer l'équipe/ });
const pickProject = (p: string) => fireEvent.change(screen.getByRole('combobox', { name: 'Projet' }), { target: { value: p } });

describe('the team editor, seats', () => {
  it('adding the 8th seat hides « Ajouter un rôle » and the launch button reads « Lancer l\'équipe · 8 sièges »', () => {
    open(NEW);
    type('Nom', 'Grande équipe');
    pickProject('ledge');
    expect(screen.getByText('SIÈGES · 0 SUR 8')).toBeInTheDocument();
    for (const id of ROLES.slice(0, 7)) add(id);
    expect(screen.getByText('Ajouter un rôle')).toBeInTheDocument();
    expect(launch()).toHaveTextContent('Lancer l\'équipe · 7 sièges');
    add(ROLES[7]!);
    expect(screen.getByText('SIÈGES · 8 SUR 8')).toBeInTheDocument();
    expect(screen.queryByText('Ajouter un rôle')).toBeNull();
    expect(launch()).toHaveTextContent('Lancer l\'équipe · 8 sièges');
    expect(launch()).toBeEnabled();
  });

  it('removing every seat disables launch and save', () => {
    open(existing(), {});
    pickProject('ledge');
    expect(launch()).toBeEnabled();
    expect(save()).toBeEnabled();
    remove('leader'); remove('dev');
    expect(launch()).toBeDisabled();
    expect(save()).toBeDisabled();
  });

  it('a seat whose role is auto shows one warning line naming @dev', () => {
    open(existing());
    const note = screen.getAllByRole('note');
    expect(note).toHaveLength(1);
    expect(note[0]).toHaveTextContent('@dev travaillera sans demander.');
    remove('dev');
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('a seat shows its role pill, label and tool · IA · autonomy; its own value wins over the role\'s', () => {
    open(existing());
    expect(screen.getByText('@leader')).toBeInTheDocument();
    expect(screen.getByText('Chef d’équipe')).toBeInTheDocument();
    expect(screen.getByText(/Claude Code · opus · demande/)).toBeInTheDocument();
    expect(screen.getByText(/Codex · gpt-5 · auto/)).toBeInTheDocument();
  });

  it('« Nouveau rôle… » goes to role/new, and a role already seated is not offered', () => {
    open(existing());
    expect(screen.getByRole('link', { name: 'Nouveau rôle…' })).toHaveAttribute('href', '#/role/new');
    expect(screen.queryByRole('button', { name: '+ @leader' })).toBeNull();
    expect(screen.getByRole('button', { name: '+ @qa' })).toBeInTheDocument();
  });

  it('« Changer » sets the seat\'s tool, IA and effort; « Par défaut » removes the override', async () => {
    const t = open(existing());
    pickProject('ledge');
    fireEvent.click(screen.getByRole('button', { name: 'Changer @leader' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Outil' }), { target: { value: 'codex' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'IA' }), { target: { value: 'gpt-5' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Effort' }), { target: { value: 'high' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Appliquer' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText(/Codex · gpt-5 · demande/)).toBeInTheDocument();
    await click('Enregistrer');
    expect(t.define.mock.calls[0]![0]).toMatchObject({ seats: [{ role: 'leader', tool: 'codex', model: 'gpt-5', effort: 'high' }, { role: 'dev' }] });
    // Back to the defaults: the seat goes out bare.
    fireEvent.click(screen.getByRole('button', { name: 'Changer @leader' }));
    const again = screen.getByRole('dialog');
    fireEvent.change(within(again).getByRole('combobox', { name: 'Outil' }), { target: { value: '' } });
    fireEvent.change(within(again).getByRole('textbox', { name: 'IA' }), { target: { value: '' } });
    fireEvent.change(within(again).getByRole('textbox', { name: 'Effort' }), { target: { value: '' } });
    fireEvent.click(within(again).getByRole('button', { name: 'Appliquer' }));
    await click('Enregistrer');
    expect(t.define.mock.calls[1]![0]).toMatchObject({ seats: [{ role: 'leader' }, { role: 'dev' }] });
    expect((t.define.mock.calls[1]![0] as { seats: unknown[] }).seats[0]).toStrictEqual({ role: 'leader' });
  });

  it('an IA the protocol does not accept disables « Appliquer » and says so', () => {
    open(existing());
    fireEvent.click(screen.getByRole('button', { name: 'Changer @leader' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'IA' }), { target: { value: '-flag' } });
    expect(within(dialog).getByRole('button', { name: 'Appliquer' })).toBeDisabled();
    expect(within(dialog).getByText('Un identifiant d’IA valide, ou vide.')).toBeInTheDocument();
  });
});

describe('the team editor, a definition', () => {
  it('saves a new Maison team with no id, no project and base null, seats in the displayed order', async () => {
    const t = open(NEW);
    type('Nom', '  Ma revue ');
    add('qa'); add('leader');
    await click('Enregistrer');
    expect(t.define).toHaveBeenCalledTimes(1);
    expect(t.define.mock.calls[0]![0]).toStrictEqual({ type: 'template.write', scope: 'home', name: 'Ma revue', seats: [{ role: 'qa' }, { role: 'leader' }], base: null });
    expect(goBack).toHaveBeenCalledExactlyOnceWith({ name: 'teams' });
  });

  it('saves a new Dépôt team on the project picked', async () => {
    const t = open(NEW);
    type('Nom', 'Ma revue');
    add('qa');
    pickProject('paper-service');
    expect(screen.getAllByRole('radio').map(r => (r as HTMLInputElement).labels?.[0]?.textContent)).toEqual(['Maison', 'Dépôt paper-service']);
    fireEvent.click(screen.getByRole('radio', { name: 'Dépôt paper-service' }));
    await click('Enregistrer');
    expect(t.define.mock.calls[0]![0]).toStrictEqual({ type: 'template.write', scope: 'repo', project: 'paper-service', name: 'Ma revue', seats: [{ role: 'qa' }], base: null });
  });

  it('a Dépôt team with no project picked cannot be saved', () => {
    open(NEW);
    type('Nom', 'Ma revue');
    add('qa');
    fireEvent.click(screen.getByRole('radio', { name: 'Dépôt' }));
    expect(save()).toBeDisabled();
    pickProject('ledge');
    expect(save()).toBeEnabled();
  });

  it('saves an existing team with its id and hash as base, and keeps a seat\'s own name', async () => {
    const t = open(existing(), { c: catalog({ templates: [template({ hash: OTHER, seats: [{ role: 'leader', name: 'Zoé' }, { role: 'dev', model: 'gpt-4' }] })] }) });
    expect(screen.queryByRole('radio')).toBeNull();
    type('Nom', 'Revue MR 2');
    await click('Enregistrer');
    expect(t.define.mock.calls[0]![0]).toStrictEqual({ type: 'template.write', scope: 'home', id: 'revue-mr', name: 'Revue MR 2', seats: [{ role: 'leader', name: 'Zoé' }, { role: 'dev', model: 'gpt-4' }], base: OTHER });
    expect(goBack).toHaveBeenCalledExactlyOnceWith({ name: 'teams' });
  });

  it('a Dépôt team is saved on its own project, and its project is fixed', async () => {
    const t = open(existing('feature-tdd', 'repo', 'paper-service'));
    expect(screen.getByRole('combobox', { name: 'Projet' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Projet' })).toHaveValue('paper-service');
    await click('Enregistrer');
    expect(t.define.mock.calls[0]![0]).toMatchObject({ type: 'template.write', scope: 'repo', project: 'paper-service', id: 'feature-tdd', base: HASH });
  });

  it('an invalid name disables launch and save and shows the rule', () => {
    open(existing());
    pickProject('ledge');
    type('Nom', '   ');
    expect(save()).toBeDisabled();
    expect(launch()).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Nom' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Un nom de 60 caractères au plus.')).toHaveClass('text-danger-fg');
    type('Nom', 'ok');
    expect(save()).toBeEnabled();
  });

  it('« Supprimer » asks first, deletes on the file\'s hash and goes back to the tab', async () => {
    const t = open(existing());
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
    const dialog = screen.getByRole('dialog');
    expect(t.define).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Supprimer' })); });
    expect(t.define).toHaveBeenCalledExactlyOnceWith({ type: 'template.delete', scope: 'home', id: 'revue-mr', base: HASH });
    expect(goBack).toHaveBeenCalledExactlyOnceWith({ name: 'teams' });
  });

  it('a new team has no « Supprimer »', () => {
    open(NEW);
    expect(screen.queryByRole('button', { name: 'Supprimer' })).toBeNull();
  });

  it('a hand-named file (R6) is shown with save and delete off, says it is edited on the PC, and can still be launched', async () => {
    const t = open(existing('revue.v2'), { c: catalog({ templates: [template({ id: 'revue.v2' })] }) });
    pickProject('ledge');
    expect(save()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Supprimer' })).toBeDisabled();
    expect(screen.getByText(/ne se modifie que sur le PC/)).toBeInTheDocument();
    expect(launch()).toBeEnabled();
    await click(/^Lancer/);
    expect(t.teamOp).toHaveBeenCalledExactlyOnceWith({ type: 'team.launch', project: 'ledge', name: 'Revue MR', seats: [{ role: 'leader' }, { role: 'dev' }], template: 'revue.v2' });
  });

  it('« changed » keeps the edits, waits for the new catalog, then saves over the new hash', async () => {
    const t = open(existing());
    t.define.mockResolvedValueOnce({ status: 'rejected', reason: 'changed' });
    type('Nom', 'Mon nom');
    const asked = t.of('teams.catalog').length;
    await click('Enregistrer');
    expect(screen.getByRole('status')).toHaveTextContent('le fichier a changé sur le PC');
    expect(t.of('teams.catalog').length).toBe(asked + 1);
    expect(screen.getByRole('textbox', { name: 'Nom' })).toHaveValue('Mon nom');
    expect(save()).toBeDisabled();
    act(() => t.deliver({ type: 'teams.catalog', catalog: catalog({ templates: [template({ hash: OTHER, name: 'Nom du PC' })] }) }));
    expect(screen.getByRole('textbox', { name: 'Nom' })).toHaveValue('Mon nom');
    expect(save()).toBeEnabled();
    await click('Enregistrer');
    expect(t.define.mock.calls[1]![0]).toMatchObject({ name: 'Mon nom', base: OTHER });
  });

  it('« Reprendre la version du PC » drops the unsaved edits for the PC\'s', async () => {
    const t = open(existing());
    t.define.mockResolvedValueOnce({ status: 'rejected', reason: 'changed' });
    type('Nom', 'Mon nom');
    remove('dev');
    await click('Enregistrer');
    act(() => t.deliver({ type: 'teams.catalog', catalog: catalog({ templates: [template({ hash: OTHER, name: 'Nom du PC' })] }) }));
    fireEvent.click(screen.getByRole('button', { name: 'Reprendre la version du PC' }));
    expect(screen.getByRole('textbox', { name: 'Nom' })).toHaveValue('Nom du PC');
    expect(screen.getByText('@dev')).toBeInTheDocument();
  });

  it('a team deleted on the PC meanwhile keeps the edits on screen but cannot be saved or deleted', async () => {
    const t = open(existing());
    t.define.mockResolvedValueOnce({ status: 'rejected', reason: 'changed' });
    type('Nom', 'Mon nom');
    await click('Enregistrer');
    act(() => t.deliver({ type: 'teams.catalog', catalog: catalog({ templates: [] }) }));
    expect(screen.getByText(/n’existe plus sur le PC/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Nom' })).toHaveValue('Mon nom');
    expect(save()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Supprimer' })).toBeDisabled();
    expect(t.define).toHaveBeenCalledTimes(1);
  });

  it('an unknown team says so', () => {
    open({ kind: 'template', key: 'home~~ghost' });
    expect(screen.getByText('Cette équipe n’existe pas sur ce PC.')).toBeInTheDocument();
  });

  it('a refused write says why and does not navigate; a cancelled passkey is quiet', async () => {
    const t = open(NEW);
    t.define.mockResolvedValueOnce({ status: 'rejected', reason: 'exists' }).mockResolvedValueOnce({ status: 'cancelled' });
    type('Nom', 'Ma revue');
    add('qa');
    await click('Enregistrer');
    expect(screen.getByRole('status')).toHaveTextContent('Une équipe de ce nom existe déjà.');
    await click('Enregistrer');
    expect(screen.getByRole('status')).toHaveTextContent('Vérification annulée. Rien n’a été envoyé.');
    expect(goBack).not.toHaveBeenCalled();
  });

  it('without a passkey, actions are off and the editor sends to Connexion', () => {
    open(existing(), { confirm: false });
    pickProject('ledge');
    expect(save()).toBeDisabled();
    expect(launch()).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Connexion' })).toHaveAttribute('href', '#/connection');
  });

  it('never says « modèle »', () => {
    const t = open(existing());
    fireEvent.click(screen.getByRole('button', { name: 'Changer @leader' }));
    expect(document.body.textContent?.toLowerCase()).not.toContain('modèle');
    expect(document.body.innerHTML.toLowerCase()).not.toContain('modèle');
    t.view.unmount();
  });
});

describe('the team editor, a launch', () => {
  it('launches an existing team on the project picked, naming its id, and goes to Agents', async () => {
    const t = open(existing());
    pickProject('ledge');
    type('Nom', 'Revue du jour');
    await click(/^Lancer/);
    expect(t.teamOp).toHaveBeenCalledExactlyOnceWith({ type: 'team.launch', project: 'ledge', name: 'Revue du jour', seats: [{ role: 'leader' }, { role: 'dev' }], template: 'revue-mr' });
    expect(globalThis.location.hash).toBe('#/agents');
  });

  it('launches an unsaved team without naming a template', async () => {
    const t = open(NEW);
    type('Nom', 'Neuve');
    add('dev');
    pickProject('paper-service');
    await click(/^Lancer/);
    expect(t.teamOp.mock.calls[0]![0]).toStrictEqual({ type: 'team.launch', project: 'paper-service', name: 'Neuve', seats: [{ role: 'dev' }] });
  });

  it('a Dépôt team launches on its own project', async () => {
    const t = open(existing('feature-tdd', 'repo', 'paper-service'));
    await click(/^Lancer/);
    expect(t.teamOp.mock.calls[0]![0]).toMatchObject({ project: 'paper-service', template: 'feature-tdd' });
  });

  it('launch waits for a project', () => {
    open(existing());
    expect(launch()).toBeDisabled();
    pickProject('ledge');
    expect(launch()).toBeEnabled();
  });

  it('a refused launch says so and stays', async () => {
    const t = open(existing());
    t.teamOp.mockResolvedValueOnce({ status: 'rejected', reason: 'unknown_project' });
    pickProject('ledge');
    await click(/^Lancer/);
    expect(screen.getByRole('status')).toHaveTextContent('Ce projet n’a pas de dépôt sur ce PC.');
    expect(globalThis.location.hash).toBe('#/team/x');
  });

  it('a write that resolves after the user left does not navigate', async () => {
    const t = open(existing());
    pickProject('ledge');
    let settle!: (r: { status: 'applied' }) => void;
    t.teamOp.mockReturnValueOnce(new Promise(r => { settle = r; }));
    t.define.mockReturnValueOnce(new Promise(r => { settle = r; }));
    fireEvent.click(launch());
    t.view.unmount();
    await act(async () => { settle({ status: 'applied' }); });
    expect(globalThis.location.hash).toBe('#/team/x');
  });

  it('a save that resolves after the user left does not go back', async () => {
    const t = open(existing());
    let settle!: (r: { status: 'applied' }) => void;
    t.define.mockReturnValueOnce(new Promise(r => { settle = r; }));
    fireEvent.click(save());
    t.view.unmount();
    await act(async () => { settle({ status: 'applied' }); });
    expect(goBack).not.toHaveBeenCalled();
  });
});

describe('the team editor, a copy of a live team', () => {
  it('is prefilled from the live team without its leaving seats, and shows the scope buttons', () => {
    open(copyOf, { teams: [team({ seats: [{ role: 'leader', sessionId: 's1', tool: 'codex' }, { role: 'qa', sessionId: null, leaving: true }, { role: 'dev', sessionId: 's3', model: 'gpt-4' }] })] });
    expect(screen.getByRole('textbox', { name: 'Nom' })).toHaveValue('Revue en cours');
    expect(screen.getByRole('combobox', { name: 'Projet' })).toHaveValue('ledge');
    expect(screen.queryByText('@qa')).toBeNull();
    expect(screen.getByText(/Codex · opus · demande/)).toBeInTheDocument();
    expect(screen.getByText(/Codex · gpt-4 · auto/)).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('saves as a new team: no id, base null, the seats\' own tool, IA and effort', async () => {
    const t = open(copyOf, { teams: [team({ seats: [{ role: 'leader', sessionId: 's1', tool: 'codex', effort: 'high' }, { role: 'dev', sessionId: null, model: 'gpt-4' }] })] });
    type('Nom', 'Copie');
    await click('Enregistrer');
    expect(t.define.mock.calls[0]![0]).toStrictEqual({ type: 'template.write', scope: 'home', name: 'Copie', seats: [{ role: 'leader', tool: 'codex', effort: 'high' }, { role: 'dev', model: 'gpt-4' }], base: null });
    expect(goBack).toHaveBeenCalledExactlyOnceWith({ name: 'teams' });
  });

  it('can be saved in a Dépôt, and has no « Supprimer »', async () => {
    const t = open(copyOf);
    fireEvent.click(screen.getByRole('radio', { name: 'Dépôt ledge' }));
    await click('Enregistrer');
    expect(t.define.mock.calls[0]![0]).toMatchObject({ scope: 'repo', project: 'ledge', base: null });
    expect(t.define.mock.calls[0]![0]).not.toHaveProperty('id');
    expect(screen.queryByRole('button', { name: 'Supprimer' })).toBeNull();
  });

  it('a live team that is not there says so', () => {
    open({ kind: 'copy', teamId: 'team-ffff' });
    expect(screen.getByText('Cette équipe n’existe pas sur ce PC.')).toBeInTheDocument();
  });

  it('launches from a copy without naming a template, with the copy\'s seats', async () => {
    const t = open(copyOf, { teams: [team({ seats: [{ role: 'leader', sessionId: 's1', tool: 'codex' }, { role: 'qa', sessionId: null, leaving: true }, { role: 'dev', sessionId: 's3' }] })] });
    await click(/^Lancer/);
    expect(t.teamOp).toHaveBeenCalledExactlyOnceWith({ type: 'team.launch', project: 'ledge', name: 'Revue en cours', seats: [{ role: 'leader', tool: 'codex' }, { role: 'dev' }] });
  });

  it('does not mark the composed values as « modifié », only what is changed here', () => {
    open(copyOf, { teams: [team({ seats: [{ role: 'leader', sessionId: 's1', tool: 'codex' }, { role: 'dev', sessionId: 's3' }] })] });
    expect(screen.queryByText(/modifié/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Changer @dev' }));
    fireEvent.change(within(screen.getByRole('dialog')).getByRole('textbox', { name: 'IA' }), { target: { value: 'gpt-4' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Appliquer' }));
    expect(screen.getAllByText(/modifié/)).toHaveLength(1);
  });
});

describe('the team editor, before the live teams have arrived', () => {
  const early = (mode: TeamEditorMode) => {
    const t = setup();
    t.deliver(snapshot([], 'PC-Desan', undefined, { confirm: true, chat: true }));
    act(() => t.deliver({ type: 'teams.catalog', catalog: catalog() }));
    render(<TeamEditor store={t.store} mode={mode} />);
    return t;
  };
  it.each([['compose', live], ['copy', copyOf]] as const)('a deep link to a %s shows the loading state, then the team', (_n, mode) => {
    const t = early(mode);
    expect(screen.getByText('Lecture du catalogue…')).toBeInTheDocument();
    expect(screen.queryByText(/n’existe pas/)).toBeNull();
    act(() => t.deliver({ type: 'teams', teams: [team()] }));
    expect(screen.getByRole('textbox', { name: 'Nom' })).toHaveValue('Revue en cours');
  });
  it('says the team is not there once the teams have arrived without it', () => {
    const t = early(live);
    act(() => t.deliver({ type: 'teams', teams: [] }));
    expect(screen.getByText('Cette équipe n’existe pas sur ce PC.')).toBeInTheDocument();
  });
});

describe('the team editor, a live composition', () => {
  it('shows the name and project read-only, no scope buttons, no launch, and one « Enregistrer »', () => {
    open(live);
    expect(screen.getByRole('textbox', { name: 'Nom' })).toHaveAttribute('readonly');
    expect(screen.getByRole('textbox', { name: 'Nom' })).toHaveValue('Revue en cours');
    expect(screen.getByRole('combobox', { name: 'Projet' })).toBeDisabled();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Lancer/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Supprimer' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Enregistrer' })).toHaveLength(1);
  });

  it('removing @qa and adding @rev sends one team.compose with the new list in its displayed order, and stays', async () => {
    const t = open(live);
    remove('qa');
    add('rev');
    await click('Enregistrer');
    expect(t.teamOp).toHaveBeenCalledTimes(1);
    expect(t.teamOp.mock.calls[0]![0]).toStrictEqual({ type: 'team.compose', team: 'team-a1b2', seats: [{ role: 'leader' }, { role: 'dev', model: 'gpt-4' }, { role: 'rev' }] });
    expect(t.define).not.toHaveBeenCalled();
    expect(goBack).not.toHaveBeenCalled();
    expect(globalThis.location.hash).toBe('#/team/x');
  });

  it('a composition saved whose new seat did not start says so, naming the seat, and does not say « Pas enregistré »', async () => {
    const t = open(live);
    remove('qa');
    add('rev'); add('doc');
    // The PC's push of the team comes before its answer: @rev holds a session, @doc did not start.
    t.teamOp.mockImplementationOnce(async () => {
      act(() => t.deliver({ type: 'teams', teams: [team({ seats: [{ role: 'leader', sessionId: 's1' }, { role: 'dev', sessionId: 's3' }, { role: 'rev', sessionId: 's4' }, { role: 'doc', sessionId: null }] })] }));
      return { status: 'applied', warn: 'seat_failed' };
    });
    await click('Enregistrer');
    expect(screen.getByRole('status')).toHaveTextContent("Composition enregistrée ; @doc n'a pas démarré.");
    expect(screen.queryByText('Pas enregistré.')).toBeNull();
    expect(goBack).not.toHaveBeenCalled();
  });

  it('several new seats that did not start are all named', async () => {
    const t = open(live);
    add('rev'); add('doc');
    t.teamOp.mockResolvedValueOnce({ status: 'applied', warn: 'seat_failed' });
    await click('Enregistrer');
    expect(screen.getByRole('status')).toHaveTextContent("Composition enregistrée ; @rev, @doc n'ont pas démarré.");
  });

  it('seats that are leaving are not listed, but their role can be added again', async () => {
    const t = open(live, { teams: [team({ seats: [{ role: 'leader', sessionId: 's1' }, { role: 'qa', sessionId: 's2', leaving: true }] })] });
    expect(screen.queryByText('@qa')).toBeNull();
    add('qa');
    await click('Enregistrer');
    expect(t.teamOp.mock.calls[0]![0]).toStrictEqual({ type: 'team.compose', team: 'team-a1b2', seats: [{ role: 'leader' }, { role: 'qa' }] });
  });

  it('changing a seat\'s model shows « au prochain démarrage du siège » once the composition is applied', async () => {
    open(live);
    fireEvent.click(screen.getByRole('button', { name: 'Changer @leader' }));
    fireEvent.change(within(screen.getByRole('dialog')).getByRole('textbox', { name: 'IA' }), { target: { value: 'sonnet' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Appliquer' }));
    expect(screen.queryByText('au prochain démarrage du siège')).toBeNull();
    await click('Enregistrer');
    expect(screen.getByText('au prochain démarrage du siège')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Redémarrer ce siège' })).toBeNull();
  });

  it('changing a seat\'s tool offers « Redémarrer ce siège » after the save, which sends team.seat restart', async () => {
    const t = open(live);
    fireEvent.click(screen.getByRole('button', { name: 'Changer @leader' }));
    fireEvent.change(within(screen.getByRole('dialog')).getByRole('combobox', { name: 'Outil' }), { target: { value: 'codex' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Appliquer' }));
    expect(screen.queryByRole('button', { name: 'Redémarrer ce siège' })).toBeNull();
    await click('Enregistrer');
    expect(t.teamOp.mock.calls[0]![0]).toStrictEqual({ type: 'team.compose', team: 'team-a1b2', seats: [{ role: 'leader', tool: 'codex' }, { role: 'qa' }, { role: 'dev', model: 'gpt-4' }] });
    expect(screen.getByText(/conversation du siège n’est pas reprise/)).toBeInTheDocument();
    await click('Redémarrer ce siège');
    expect(t.teamOp).toHaveBeenLastCalledWith({ type: 'team.seat', team: 'team-a1b2', role: 'leader', action: 'restart' });
    expect(screen.queryByRole('button', { name: 'Redémarrer ce siège' })).toBeNull();
  });

  const toCodex = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Changer @leader' }));
    fireEvent.change(within(screen.getByRole('dialog')).getByRole('combobox', { name: 'Outil' }), { target: { value: 'codex' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Appliquer' }));
    await click('Enregistrer');
  };

  it('a seat that holds no session is started, not restarted, and says nothing about the conversation', async () => {
    const t = open(live, { teams: [team({ seats: [{ role: 'leader', sessionId: null }, { role: 'qa', sessionId: 's2' }, { role: 'dev', sessionId: 's3', model: 'gpt-4' }] })] });
    await toCodex();
    expect(screen.queryByRole('button', { name: 'Redémarrer ce siège' })).toBeNull();
    expect(screen.queryByText(/conversation du siège/)).toBeNull();
    await click('Démarrer ce siège');
    expect(t.teamOp).toHaveBeenLastCalledWith({ type: 'team.seat', team: 'team-a1b2', role: 'leader', action: 'start' });
    expect(screen.queryByRole('button', { name: 'Démarrer ce siège' })).toBeNull();
  });

  it('a refused start says so', async () => {
    const t = open(live, { teams: [team({ seats: [{ role: 'leader', sessionId: null }, { role: 'qa', sessionId: 's2' }] })] });
    await toCodex();
    t.teamOp.mockResolvedValueOnce({ status: 'rejected', reason: 'conflict' });
    await click('Démarrer ce siège');
    expect(screen.getByRole('status')).toHaveTextContent('Une autre opération est en cours sur le PC.');
  });

  it('changing the tool and then back in a second composition leaves no restart', async () => {
    open(live);
    await toCodex();
    expect(screen.getByRole('button', { name: 'Redémarrer ce siège' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Changer @leader' }));
    fireEvent.change(within(screen.getByRole('dialog')).getByRole('combobox', { name: 'Outil' }), { target: { value: 'claude' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Appliquer' }));
    await click('Enregistrer');
    expect(screen.queryByRole('button', { name: 'Redémarrer ce siège' })).toBeNull();
  });

  it('a seat that was leaving and is added again with another tool is offered a restart', async () => {
    open(live, { teams: [team({ seats: [{ role: 'leader', sessionId: 's1' }, { role: 'qa', sessionId: 's2', tool: 'claude', leaving: true }] })] });
    add('qa');
    fireEvent.click(screen.getByRole('button', { name: 'Changer @qa' }));
    fireEvent.change(within(screen.getByRole('dialog')).getByRole('combobox', { name: 'Outil' }), { target: { value: 'codex' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Appliquer' }));
    await click('Enregistrer');
    expect(screen.getByRole('button', { name: 'Redémarrer ce siège' })).toBeInTheDocument();
  });

  it('does not mark a seat « modifié » for the tool the team was composed with', () => {
    open(live, { teams: [team({ seats: [{ role: 'leader', sessionId: 's1', tool: 'codex' }, { role: 'dev', sessionId: 's3', model: 'gpt-4' }] })] });
    expect(screen.queryByText(/modifié/)).toBeNull();
  });

  it('a composition refused as « changed » says the composition changed on the PC and does not lock the screen or ask for the catalog', async () => {
    const t = open(live);
    t.teamOp.mockResolvedValueOnce({ status: 'rejected', reason: 'changed' });
    const asked = t.of('teams.catalog').length;
    remove('qa');
    await click('Enregistrer');
    expect(screen.getByRole('status')).toHaveTextContent('La composition a changé sur le PC.');
    expect(t.of('teams.catalog').length).toBe(asked);
    expect(save()).toBeEnabled();
    await click('Enregistrer');
    expect(t.teamOp).toHaveBeenCalledTimes(2);
  });

  it('a refused restart says so and keeps the button', async () => {
    const t = open(live);
    fireEvent.click(screen.getByRole('button', { name: 'Changer @leader' }));
    fireEvent.change(within(screen.getByRole('dialog')).getByRole('combobox', { name: 'Outil' }), { target: { value: 'codex' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Appliquer' }));
    await click('Enregistrer');
    t.teamOp.mockResolvedValueOnce({ status: 'rejected', reason: 'conflict' });
    await click('Redémarrer ce siège');
    expect(screen.getByRole('status')).toHaveTextContent('Une autre opération est en cours sur le PC.');
    expect(screen.getByRole('button', { name: 'Redémarrer ce siège' })).toBeInTheDocument();
  });

  it('a refused composition says why and shows no restart', async () => {
    const t = open(live);
    t.teamOp.mockResolvedValueOnce({ status: 'rejected', reason: 'invalid' });
    fireEvent.click(screen.getByRole('button', { name: 'Changer @leader' }));
    fireEvent.change(within(screen.getByRole('dialog')).getByRole('combobox', { name: 'Outil' }), { target: { value: 'codex' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Appliquer' }));
    await click('Enregistrer');
    expect(screen.getByRole('status')).toHaveTextContent('Pas enregistré.');
    expect(screen.queryByRole('button', { name: 'Redémarrer ce siège' })).toBeNull();
  });

  it('a seat shows its own value, else the role\'s default', () => {
    open(live);
    expect(screen.getByText(/Claude Code · opus · demande/)).toBeInTheDocument();
    expect(screen.getByText(/Codex · gpt-4 · auto/)).toBeInTheDocument();
  });

  it('a team dissolved on the PC meanwhile says so and cannot be saved', () => {
    const t = open(live);
    act(() => t.deliver({ type: 'teams', teams: [] }));
    expect(screen.getByText(/n’existe plus/)).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('a composition applied after the user left does not navigate or fail', async () => {
    const t = open(live);
    let settle!: (r: { status: 'applied' }) => void;
    t.teamOp.mockReturnValueOnce(new Promise(r => { settle = r; }));
    fireEvent.click(save());
    t.view.unmount();
    await act(async () => { settle({ status: 'applied' }); });
    expect(goBack).not.toHaveBeenCalled();
  });
});
