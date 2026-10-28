import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PhoneCatalog, PhoneRole, PhoneTeam } from '@ledge/protocol';
import { CATALOG_WAIT_MS, Teams } from '../../src/screens/Teams';
import { href } from '../../src/router';
import { snapshot } from '../state/helpers';
import { setup } from './setup';

afterEach(() => { vi.useRealTimers(); });

const HASH = 'a'.repeat(16);
const role = (id: string, extra: Partial<PhoneRole> = {}): PhoneRole => ({ id, label: id, prompt: 'p', scope: 'home', project: null, hash: HASH, ...extra });
const catalog = (extra: Partial<PhoneCatalog> = {}): PhoneCatalog => ({
  projects: ['ledge', 'paper-service'],
  roles: [
    role('leader', { label: 'Chef d’équipe', tool: 'claude', model: 'opus', autonomy: 'ask' }),
    role('dev', { label: 'Développeur', tool: 'codex', autonomy: 'auto' }),
    role('reviewer', { label: 'Relecteur', tool: 'claude', model: 'sonnet', autonomy: 'ask' })
  ],
  templates: [
    { id: 'revue-mr', name: 'Revue MR', scope: 'home', project: null, hash: HASH, seats: [{ role: 'leader' }, { role: 'reviewer' }] },
    { id: 'feature-tdd', name: 'Feature TDD', scope: 'repo', project: 'paper-service', hash: HASH, seats: [{ role: 'leader', model: 'opus' }, { role: 'dev' }, { role: 'tester' }] }
  ],
  problems: [],
  ...extra
});
const live = (extra: Partial<PhoneTeam> = {}): PhoneTeam => ({ id: 'team-a1b2', name: 'Revue paper-service', project: 'paper-service', state: 'active', template: 'revue-mr', seats: [{ role: 'leader', sessionId: null }], done: 0, given: 0, createdAt: new Date().toISOString(), ...extra });

/** A tab on a PC that has answered with `c`; `teams`: the PC says it serves the catalog. */
function open(c: PhoneCatalog | null = catalog(), { confirm = true, teams = false } = {}) {
  const t = setup();
  const snap = snapshot([], 'PC-Desan', undefined, { confirm, chat: true });
  t.deliver(teams && snap.type === 'snapshot' ? { ...snap, daemon: { ...snap.daemon, teams: true } } : snap);
  const view = render(<Teams store={t.store} />);
  if (c) act(() => t.deliver({ type: 'teams.catalog', catalog: c }));
  return { ...t, view };
}

describe('the Équipes tab', () => {
  it('counts the teams and roles, and tells each team its scope and roles, with « Lever » and « Nouvelle équipe »', () => {
    open();
    expect(screen.getByRole('heading', { name: 'Équipes' })).toBeInTheDocument();
    expect(screen.getByText('2 équipes · 3 rôles')).toBeInTheDocument();
    expect(screen.getByText('maison')).toBeInTheDocument();
    expect(screen.getByText('dépôt paper-service')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Lever / })).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Nouvelle équipe' })).toHaveAttribute('href', '#/team/new');
    const feature = screen.getByRole('link', { name: /Feature TDD/ });
    expect(feature).toHaveAttribute('href', '#/team/repo~paper-service~feature-tdd');
    expect(feature).toHaveTextContent('@leader@dev@tester');
    expect(screen.getByRole('link', { name: /Revue MR/ })).toHaveAttribute('href', '#/team/home~~revue-mr');
  });

  it('lists the roles with tool · model · autonomy, auto flagged, each opening its editor, and « + Nouveau rôle »', () => {
    open();
    const roles = screen.getByRole('region', { name: 'Rôles' });
    const leader = within(roles).getByRole('link', { name: /Chef d’équipe/ });
    expect(leader).toHaveAttribute('href', '#/role/home~~leader');
    expect(leader).toHaveTextContent('Claude Code · opus · demande');
    const dev = within(roles).getByRole('link', { name: /Développeur/ });
    expect(dev).toHaveTextContent('Codex · auto');
    expect(within(dev).getByText('auto')).toHaveClass('text-attention');
    expect(within(roles).getByRole('link', { name: '+ Nouveau rôle' })).toHaveAttribute('href', '#/role/new');
  });

  it('« Lever » on the Dépôt team preselects its project, and confirming launches the template with its own seats', async () => {
    const t = open();
    const teamOp = vi.spyOn(t.store, 'teamOp').mockResolvedValue({ status: 'applied' });
    fireEvent.click(within(screen.getByRole('link', { name: /Feature TDD/ }).closest('li')!).getByRole('button', { name: 'Lever Feature TDD' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('combobox', { name: 'Projet' })).toHaveValue('paper-service');
    expect(within(dialog).getByRole('textbox', { name: 'Nom' })).toHaveValue('Feature TDD');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Lancer l\'équipe · 3 sièges' })); });
    expect(teamOp).toHaveBeenCalledWith({
      type: 'team.launch', project: 'paper-service', name: 'Feature TDD', template: 'feature-tdd',
      seats: [{ role: 'leader', model: 'opus' }, { role: 'dev' }, { role: 'tester' }]
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Feature TDD levée');
  });

  it('a Maison team has no project until one is picked, and the launch uses the name as edited', async () => {
    const t = open();
    const teamOp = vi.spyOn(t.store, 'teamOp').mockResolvedValue({ status: 'applied' });
    fireEvent.click(within(screen.getByRole('link', { name: /Revue MR/ }).closest('li')!).getByRole('button', { name: 'Lever Revue MR' }));
    const dialog = screen.getByRole('dialog');
    const go = within(dialog).getByRole('button', { name: 'Lancer l\'équipe · 2 sièges' });
    expect(within(dialog).getByRole('combobox', { name: 'Projet' })).toHaveValue('');
    expect(go).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Projet' }), { target: { value: 'ledge' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Nom' }), { target: { value: '  Revue du jour ' } });
    expect(go).toBeEnabled();
    await act(async () => { fireEvent.click(go); });
    expect(teamOp).toHaveBeenCalledWith({ type: 'team.launch', project: 'ledge', name: 'Revue du jour', template: 'revue-mr', seats: [{ role: 'leader' }, { role: 'reviewer' }] });
  });

  it('keeps the dialog open and says why when the launch is refused, or not confirmed', async () => {
    const t = open();
    const teamOp = vi.spyOn(t.store, 'teamOp').mockResolvedValueOnce({ status: 'rejected', reason: 'unknown_project' }).mockResolvedValueOnce({ status: 'cancelled' });
    fireEvent.click(within(screen.getByRole('link', { name: /Feature TDD/ }).closest('li')!).getByRole('button', { name: 'Lever Feature TDD' }));
    const go = () => within(screen.getByRole('dialog')).getByRole('button', { name: 'Lancer l\'équipe · 3 sièges' });
    await act(async () => { fireEvent.click(go()); });
    expect(within(screen.getByRole('dialog')).getByRole('status')).toHaveTextContent('Ce projet n’a pas de dépôt sur ce PC.');
    await act(async () => { fireEvent.click(go()); });
    expect(within(screen.getByRole('dialog')).getByRole('status')).toHaveTextContent('Vérification annulée. Rien n’a été envoyé.');
    expect(teamOp).toHaveBeenCalledTimes(2);
    expect(go()).toBeEnabled();
  });

  it('does not close, nor launch twice, while the launch waits; a refusal then lands on the sheet', async () => {
    const t = open();
    let settle!: (r: { status: 'rejected'; reason: 'unknown_project' }) => void;
    const teamOp = vi.spyOn(t.store, 'teamOp').mockReturnValue(new Promise(r => { settle = r; }));
    fireEvent.click(screen.getByRole('button', { name: 'Lever Feature TDD' }));
    const dialog = screen.getByRole('dialog');
    const go = within(dialog).getByRole('button', { name: 'Lancer l\'équipe · 3 sièges' });
    fireEvent.click(go);
    fireEvent.click(go);
    expect(teamOp).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole('button', { name: 'Annuler' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => { settle({ status: 'rejected', reason: 'unknown_project' }); });
    expect(within(screen.getByRole('dialog')).getByRole('status')).toHaveTextContent('Ce projet n’a pas de dépôt sur ce PC.');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says a launch the device did not confirm as the chat card does: quietly when cancelled or expired, « Pas lancée. » otherwise', async () => {
    const t = open();
    const teamOp = vi.spyOn(t.store, 'teamOp')
      .mockResolvedValueOnce({ status: 'rejected', reason: 'assertion_expired' }).mockResolvedValueOnce({ status: 'failed' }).mockResolvedValueOnce({ status: 'rejected', reason: 'conflict' });
    fireEvent.click(screen.getByRole('button', { name: 'Lever Feature TDD' }));
    const go = () => within(screen.getByRole('dialog')).getByRole('button', { name: 'Lancer l\'équipe · 3 sièges' });
    const status = () => within(screen.getByRole('dialog')).getByRole('status');
    await act(async () => { fireEvent.click(go()); });
    expect(status()).toHaveTextContent('La vérification a expiré. Recommencez.');
    expect(status()).toHaveClass('text-muted');
    await act(async () => { fireEvent.click(go()); });
    expect(status()).toHaveTextContent('Pas lancée.');
    expect(status()).toHaveClass('text-danger-fg');
    await act(async () => { fireEvent.click(go()); });
    expect(status()).toHaveTextContent('Une autre opération est en cours sur le PC. Réessayez.');
    expect(teamOp).toHaveBeenCalledTimes(3);
  });

  it('offers no « Lever » when the PC has no project with a local repository, and says so', () => {
    open(catalog({ projects: [] }));
    expect(screen.queryByRole('button', { name: /^Lever / })).toBeNull();
    expect(screen.getByText('Aucun projet avec un dépôt local sur ce PC : impossible de lever une équipe.')).toBeInTheDocument();
  });

  it('asks for the device protection first when the phone cannot confirm', () => {
    open(catalog(), { confirm: false });
    fireEvent.click(screen.getByRole('button', { name: 'Lever Feature TDD' }));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Lancer l\'équipe · 3 sièges' })).toBeDisabled();
    expect(screen.getByText('Protégez d\'abord vos accords depuis Connexion.')).toBeInTheDocument();
  });

  it('links each live team raised from a listed definition to Agents', () => {
    const t = open();
    act(() => t.deliver({ type: 'teams', teams: [live(), live({ id: 'team-c3d4', name: 'Autre', template: 'inconnue' }), live({ id: 'team-e5f6', name: 'Ad hoc', template: undefined })] }));
    const link = screen.getByRole('link', { name: 'Revue paper-service est levée · la suivre dans Agents ›' });
    expect(link).toHaveAttribute('href', '#/agents');
    expect(screen.queryByText(/Autre est levée/)).toBeNull();
    expect(screen.queryByText(/Ad hoc est levée/)).toBeNull();
  });

  it('lists the files that could not be read as file · scope · reason, never a path', () => {
    open(catalog({ problems: [
      { file: 'broken.md', scope: 'home', project: null, reason: 'invalid_front_matter' },
      { file: 'old.yaml', scope: 'repo', project: 'paper-service', reason: 'unreadable' }
    ] }));
    const problems = screen.getByRole('region', { name: 'Fichiers illisibles' });
    expect(within(problems).getByText('broken.md · maison · invalid_front_matter')).toBeInTheDocument();
    expect(within(problems).getByText('old.yaml · dépôt paper-service · unreadable')).toBeInTheDocument();
    expect(problems.textContent).not.toContain('/');
  });

  it('shows no problems section when every file reads', () => {
    open();
    expect(screen.queryByRole('region', { name: 'Fichiers illisibles' })).toBeNull();
  });
});

describe('the catalog request', () => {
  it('is asked on mount, and again when the link turns fresh', () => {
    const t = setup();
    render(<Teams store={t.store} />);
    expect(t.of('teams.catalog')).toHaveLength(1);
    act(() => t.deliver(snapshot([], 'PC-Desan', undefined, { confirm: true, chat: true })));
    expect(t.of('teams.catalog')).toHaveLength(2);
  });

  it('waits, then says « Catalogue indisponible » with « Réessayer », which asks again and waits again', () => {
    vi.useFakeTimers();
    const t = open(null);
    expect(screen.getByText('Lecture du catalogue…')).toBeInTheDocument();
    expect(screen.queryByText('Catalogue indisponible')).toBeNull();
    act(() => { vi.advanceTimersByTime(CATALOG_WAIT_MS); });
    expect(screen.getByText('Catalogue indisponible')).toBeInTheDocument();
    expect(screen.queryByText('Lecture du catalogue…')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Lever / })).toBeNull();
    const asked = t.of('teams.catalog').length;
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(t.of('teams.catalog')).toHaveLength(asked + 1);
    expect(screen.getByText('Lecture du catalogue…')).toBeInTheDocument();
    act(() => t.deliver({ type: 'teams.catalog', catalog: catalog() }));
    expect(screen.getByText('2 équipes · 3 rôles')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(CATALOG_WAIT_MS); });
    expect(screen.queryByText('Catalogue indisponible')).toBeNull();
  });

  it('says at once that a PC which does not serve the catalog needs updating, when it refuses the read', () => {
    vi.useFakeTimers();
    const t = open(null);
    expect(screen.getByText('Lecture du catalogue…')).toBeInTheDocument();
    act(() => t.deliver({ type: 'error', code: 'invalid', request: 'teams.catalog' }));
    expect(screen.getByText('Catalogue indisponible')).toBeInTheDocument();
    expect(screen.getByText(/mettez Ledge à jour sur le PC/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mettre à jour le PC' })).toHaveAttribute('href', href({ name: 'connection' }));
    expect(screen.queryByText('Lecture du catalogue…')).toBeNull();
  });

  it('says « Catalogue indisponible » at once, without asking for an update, when a PC that serves the catalog refuses the read', () => {
    vi.useFakeTimers();
    const t = open(null, { teams: true });
    act(() => t.deliver({ type: 'error', code: 'invalid', request: 'teams.catalog' }));
    expect(screen.getByText('Catalogue indisponible')).toBeInTheDocument();
    expect(screen.queryByText(/mettez Ledge à jour/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Mettre à jour le PC' })).toBeNull();
    const asked = t.of('teams.catalog').length;
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(t.of('teams.catalog')).toHaveLength(asked + 1);
    expect(screen.getByText('Lecture du catalogue…')).toBeInTheDocument();
  });

  it('shows the loading line, not « indisponible », while a link that is not fresh yet may still deliver; then offers to reconnect', () => {
    vi.useFakeTimers();
    const t = setup('pc_offline');
    const onReconnect = vi.fn();
    render(<Teams store={t.store} onReconnect={onReconnect} />);
    expect(screen.getByText('PC hors ligne')).toBeInTheDocument();
    expect(screen.getByText('Lecture du catalogue…')).toBeInTheDocument();
    expect(screen.queryByText('Catalogue indisponible')).toBeNull();
    act(() => { vi.advanceTimersByTime(CATALOG_WAIT_MS); });
    expect(screen.getByText('Catalogue indisponible')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('keeps the last catalog, with « Lever » disabled, once the link is lost', () => {
    const t = open();
    act(() => t.set('pc_offline'));
    expect(screen.getByText('PC hors ligne')).toBeInTheDocument();
    expect(screen.getByText('Revue MR')).toBeInTheDocument();
    for (const b of screen.getAllByRole('button', { name: /^Lever / })) expect(b).toBeDisabled();
  });
});
