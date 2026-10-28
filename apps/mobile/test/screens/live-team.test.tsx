import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhoneCatalog, PhoneRole, PhoneTeam, PhoneTemplate } from '@ledge/protocol';
import { goBack } from '../../src/router';
import { LiveTeam } from '../../src/screens/LiveTeam';
import { session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { app } from './app-setup';
import { setup } from './setup';

// `goBack` branches on the router's module-level history position, which every hash change moves: its own behaviour is the router's
// (router.test.ts), so the sheet is tested on what it asks of it, whatever order the tests run in.
vi.mock('../../src/router', async importOriginal => ({ ...(await importOriginal<typeof import('../../src/router')>()), goBack: vi.fn() }));
afterEach(() => { vi.useRealTimers(); });
beforeEach(() => { vi.mocked(goBack).mockClear(); globalThis.location.hash = '#/live/team-a1b2'; });

const HASH = 'a'.repeat(16);
const role = (id: string, extra: Partial<PhoneRole> = {}): PhoneRole => ({ id, label: `Rôle ${id}`, prompt: `Consigne de ${id}`, scope: 'home', project: null, hash: HASH, ...extra });
const template = (extra: Partial<PhoneTemplate> = {}): PhoneTemplate => ({ id: 'revue-mr', name: 'Revue MR', scope: 'home', project: null, hash: HASH, seats: [{ role: 'leader' }], ...extra });
const catalog = (extra: Partial<PhoneCatalog> = {}): PhoneCatalog => ({
  projects: ['ledge', 'paper-service'],
  roles: [
    role('leader', { label: 'Chef d’équipe', tool: 'claude', model: 'opus', effort: 'high', autonomy: 'ask', prompt: 'Tu découpes la story.\nTu confies les tâches.\nTu fais le point.' }),
    role('dev', { label: 'Développeur', tool: 'codex', model: 'gpt-5', autonomy: 'auto', prompt: 'Tu implémente les tâches.' }),
    role('dev', { label: 'Développeur du dépôt', scope: 'repo', project: 'ledge', tool: 'codex', model: 'gpt-5', autonomy: 'ask', prompt: 'Une consigne de dépôt.' }),
    role('review', { label: 'Relecteur', tool: 'claude', model: 'sonnet', autonomy: 'ask', prompt: 'Tu relis.' }),
    role('cut', { label: 'Long', prompt: 'Première ligne coupée.\nDeuxième ligne.\nTroisième.', cut: true })
  ],
  templates: [template()],
  problems: [],
  ...extra
});
const team = (extra: Partial<PhoneTeam> = {}): PhoneTeam => ({
  id: 'team-a1b2', name: 'Revue paper-service', project: 'ledge', state: 'active', createdAt: '2026-10-28T14:02:00', done: 2, given: 3, template: 'revue-mr',
  seats: [{ role: 'leader', sessionId: 's1' }, { role: 'dev', sessionId: 's2', model: 'gpt-4' }, { role: 'review', sessionId: null }], ...extra
});
const SESSIONS = [session('s1', { name: 'Otto', state: 'working' }), session('s2', { name: 'Bram', state: 'waiting_input' })];

/** The sheet on a PC that has answered with `c` and holds `teams`; `teamOp` is stubbed to apply. */
function open({ c = catalog(), teams = [team()], confirm = true, sessions = SESSIONS, teamId = 'team-a1b2' }: { c?: PhoneCatalog | null; teams?: PhoneTeam[] | null; confirm?: boolean; sessions?: typeof SESSIONS; teamId?: string } = {}) {
  const t = setup();
  t.deliver(snapshot(sessions, 'PC-Desan', undefined, { confirm, chat: true }));
  act(() => {
    if (c) t.deliver({ type: 'teams.catalog', catalog: c });
    if (teams) t.deliver({ type: 'teams', teams });
  });
  const view = render(<LiveTeam store={t.store} teamId={teamId} />);
  const teamOp = vi.spyOn(t.store, 'teamOp').mockResolvedValue({ status: 'applied' });
  return { ...t, view, teamOp };
}
const seat = (id: string) => screen.getByRole('listitem', { name: `@${id}` });
const click = async (el: HTMLElement) => { await act(async () => { fireEvent.click(el); }); };

describe('the live team sheet, header', () => {
  it('shows the project, the start time, the template and the progress', () => {
    open();
    expect(screen.getByRole('heading', { name: 'Revue paper-service' })).toBeInTheDocument();
    expect(screen.getByText("ledge · au travail depuis 14:02 · d'après « Revue MR »")).toBeInTheDocument();
    expect(screen.getByText('2/3')).toBeInTheDocument();
  });

  it('a resting team says « au repos » in place of the start time', () => {
    open({ teams: [team({ state: 'resting' })] });
    expect(screen.getByText("ledge · au repos · d'après « Revue MR »")).toBeInTheDocument();
    expect(screen.queryByText(/au travail depuis/)).toBeNull();
  });

  it('names the template only when the catalog has it', () => {
    open({ c: catalog({ templates: [] }) });
    expect(screen.getByText('ledge · au travail depuis 14:02')).toBeInTheDocument();
  });

  it('names no template for a team raised from none', () => {
    open({ teams: [(() => { const { template: _t, ...rest } = team(); return rest; })()] });
    expect(screen.getByText('ledge · au travail depuis 14:02')).toBeInTheDocument();
  });

  it('looks the template up in the team\'s project first, then at home', () => {
    open({ c: catalog({ templates: [template(), template({ name: 'Revue du dépôt', scope: 'repo', project: 'ledge' }), template({ name: 'Autre dépôt', scope: 'repo', project: 'paper-service' })] }) });
    expect(screen.getByText(/d'après « Revue du dépôt »/)).toBeInTheDocument();
  });

  it('shows no progress for a team that was given nothing', () => {
    open({ teams: [team({ given: 0, done: 0 })] });
    expect(screen.queryByText('0/0')).toBeNull();
  });
});

describe('the live team sheet, seats', () => {
  it('a held seat names the session and its state, the same words as Agents', () => {
    open();
    expect(within(seat('leader')).getByText('Otto · Au travail')).toBeInTheDocument();
    expect(within(seat('dev')).getByText('Bram · Une question')).toBeInTheDocument();
  });

  it('a leaving seat reads « termine puis part »', () => {
    open({ teams: [team({ seats: [{ role: 'leader', sessionId: 's1', leaving: true }] })] });
    expect(within(seat('leader')).getByText('termine puis part')).toBeInTheDocument();
    expect(within(seat('leader')).queryByRole('button')).toBeNull();
  });

  it('a free seat reads « libre » and starts with « Démarrer ce siège »', async () => {
    const t = open();
    expect(within(seat('review')).getByText('libre')).toBeInTheDocument();
    await click(within(seat('review')).getByRole('button', { name: 'Démarrer ce siège' }));
    expect(t.teamOp).toHaveBeenCalledWith({ type: 'team.seat', team: 'team-a1b2', role: 'review', action: 'start' });
  });

  it('a refused start says so on the seat', async () => {
    const t = open();
    t.teamOp.mockResolvedValue({ status: 'rejected', reason: 'conflict' });
    await click(within(seat('review')).getByRole('button', { name: 'Démarrer ce siège' }));
    expect(within(seat('review')).getByRole('status')).toHaveTextContent('Une autre opération est en cours sur le PC. Réessayez.');
  });

  it('a held seat has no start and no restart', () => {
    open();
    expect(within(seat('leader')).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Redémarrer ce siège' })).toBeNull();
  });

  it('the seat line shows the seat\'s own model over the role\'s, else the role\'s defaults', () => {
    open();
    expect(within(seat('dev')).getByText('Codex · gpt-4 · demande')).toBeInTheDocument();
    expect(within(seat('leader')).getByText('Claude Code · opus · high · demande')).toBeInTheDocument();
    expect(within(seat('review')).getByText('Claude Code · sonnet · demande')).toBeInTheDocument();
  });

  it('autonomy comes from the role, and « auto » is in the warning tone', () => {
    open({ teams: [team({ project: 'paper-service', seats: [{ role: 'dev', sessionId: 's2' }] })] });
    const line = within(seat('dev')).getByText('Codex · gpt-5 · auto');
    expect(line).toHaveClass('text-attention');
  });

  it('the first two lines of the prompt, and a link to the role', () => {
    open();
    expect(within(seat('leader')).getByText(/Tu découpes la story\./)).toHaveTextContent('Tu découpes la story. Tu confies les tâches.');
    expect(within(seat('leader')).queryByText(/Tu fais le point/)).toBeNull();
    expect(within(seat('leader')).getByRole('link', { name: 'Lire et modifier la consigne' })).toHaveAttribute('href', '#/role/home~~leader');
  });

  it('links to the project\'s own role when it has one, and reads its prompt', () => {
    open();
    expect(within(seat('dev')).getByRole('link', { name: 'Lire et modifier la consigne' })).toHaveAttribute('href', '#/role/repo~ledge~dev');
    expect(within(seat('dev')).getByText('Une consigne de dépôt.')).toBeInTheDocument();
  });

  it('a role cut for the phone still shows its first two lines', () => {
    open({ teams: [team({ seats: [{ role: 'cut', sessionId: null }] })] });
    expect(within(seat('cut')).getByText(/Première ligne coupée\./)).toHaveTextContent('Première ligne coupée. Deuxième ligne.');
    expect(within(seat('cut')).getByRole('link', { name: 'Lire et modifier la consigne' })).toBeInTheDocument();
  });

  it('a role the catalog does not know shows the seat without prompt and without link', () => {
    open({ teams: [team({ seats: [{ role: 'ghost', sessionId: null }] })] });
    expect(within(seat('ghost')).getByText('@ghost')).toBeInTheDocument();
    expect(within(seat('ghost')).queryByRole('link')).toBeNull();
    expect(within(seat('ghost')).getByRole('button', { name: 'Démarrer ce siège' })).toBeInTheDocument();
  });

  it('a held seat whose session the PC does not list still says it is held', () => {
    open({ sessions: [] });
    expect(within(seat('leader')).getByText('session inconnue')).toBeInTheDocument();
  });
});

describe('the live team sheet, actions', () => {
  it('goes to the composition and to « Enregistrer comme équipe »', () => {
    open();
    expect(screen.getByRole('link', { name: 'Modifier la composition' })).toHaveAttribute('href', '#/compose/team-a1b2');
    expect(screen.getByRole('link', { name: 'Enregistrer comme équipe' })).toHaveAttribute('href', '#/team-copy/team-a1b2');
  });

  it('goes back to the agents', () => {
    open();
    // The link's name depends on where the router's history says the user came from; its target is `agents` either way.
    fireEvent.click(screen.getByRole('link', { name: /^Retour/ }));
    expect(goBack).toHaveBeenCalledWith({ name: 'agents' });
  });

  it('« Dissoudre l\'équipe » asks first, dissolves the team and goes back to Agents', async () => {
    const t = open();
    fireEvent.click(screen.getByRole('button', { name: 'Dissoudre l\'équipe' }));
    expect(t.teamOp).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    await click(within(dialog).getByRole('button', { name: 'Dissoudre l\'équipe' }));
    expect(t.teamOp).toHaveBeenCalledWith({ type: 'team.dissolve', team: 'team-a1b2' });
    expect(goBack).toHaveBeenCalledWith({ name: 'agents' });
  });

  it('cancelling the confirmation dissolves nothing', () => {
    const t = open();
    fireEvent.click(screen.getByRole('button', { name: 'Dissoudre l\'équipe' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(t.teamOp).not.toHaveBeenCalled();
  });

  it('a refusal shows on the sheet and stays there', async () => {
    const t = open();
    t.teamOp.mockResolvedValue({ status: 'rejected', reason: 'conflict' });
    fireEvent.click(screen.getByRole('button', { name: 'Dissoudre l\'équipe' }));
    await click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Dissoudre l\'équipe' }));
    expect(within(screen.getByRole('dialog')).getByRole('status')).toHaveTextContent('Une autre opération est en cours sur le PC. Réessayez.');
    expect(goBack).not.toHaveBeenCalled();
  });

  it('a cancelled passkey is a quiet note', async () => {
    const t = open();
    t.teamOp.mockResolvedValue({ status: 'cancelled' });
    fireEvent.click(screen.getByRole('button', { name: 'Dissoudre l\'équipe' }));
    await click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Dissoudre l\'équipe' }));
    expect(within(screen.getByRole('dialog')).getByRole('status')).toHaveClass('text-muted');
    expect(goBack).not.toHaveBeenCalled();
  });

  it('the confirmation cannot be closed while the operation runs', async () => {
    const t = open();
    let finish!: (r: { status: 'applied' }) => void;
    t.teamOp.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Dissoudre l\'équipe' }));
    const dialog = screen.getByRole('dialog');
    await click(within(dialog).getByRole('button', { name: 'Dissoudre l\'équipe' }));
    expect(within(dialog).getByRole('button', { name: 'Annuler' })).toBeDisabled();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => { finish({ status: 'applied' }); });
  });

  it('does not navigate when the user left the screen before the answer', async () => {
    const t = open();
    let finish!: (r: { status: 'applied' }) => void;
    t.teamOp.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Dissoudre l\'équipe' }));
    await click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Dissoudre l\'équipe' }));
    t.view.unmount();
    await act(async () => { finish({ status: 'applied' }); });
    expect(goBack).not.toHaveBeenCalled();
  });

  it('without a passkey, the operations are off and Connexion is the way', () => {
    const t = open({ confirm: false });
    expect(within(seat('review')).getByRole('button', { name: 'Démarrer ce siège' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Dissoudre l\'équipe' })).toBeDisabled();
    expect(screen.getByText(/Protégez d'abord vos accords depuis Connexion\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connexion' })).toHaveAttribute('href', '#/connection');
    expect(t.teamOp).not.toHaveBeenCalled();
  });
});

describe('the live team sheet, waiting and vanishing', () => {
  it('waits for the live teams and the catalog', () => {
    open({ teams: null });
    expect(screen.getByRole('status')).toHaveTextContent('Lecture du catalogue…');
  });

  it('a team no longer in the live teams shows the Gone screen', () => {
    open({ teams: [team({ id: 'other' })] });
    expect(screen.getByRole('heading', { name: 'Cette équipe n’existe plus' })).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByRole('link', { name: 'Retour aux agents' })).toHaveAttribute('href', '#/agents');
  });

  it('a team that disappears while the sheet is open turns into the Gone screen', () => {
    const t = open();
    expect(screen.getByRole('heading', { name: 'Revue paper-service' })).toBeInTheDocument();
    act(() => t.deliver({ type: 'teams', teams: [] }));
    expect(screen.getByRole('heading', { name: 'Cette équipe n’existe plus' })).toBeInTheDocument();
  });

  it('says « modèle » nowhere', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Dissoudre l\'équipe' }));
    expect(document.body.textContent).not.toMatch(/modèle/i);
  });
});

describe('the live team sheet, in the app', () => {
  it('is what #/live/<id> opens', async () => {
    const a = app('ready', { hash: '#/live/team-a1b2' });
    await act(async () => {
      a.deliver(snapshot(SESSIONS, 'PC-Desan', undefined, { confirm: true, chat: true }));
      a.deliver({ type: 'teams.catalog', catalog: catalog() });
      a.deliver({ type: 'teams', teams: [team()] });
    });
    expect(screen.getByRole('heading', { name: 'Revue paper-service' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dissoudre l\'équipe' })).toBeInTheDocument();
  });
});
