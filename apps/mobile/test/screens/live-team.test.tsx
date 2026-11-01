import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhoneCatalog, PhoneRole, PhoneTeam, PhoneTemplate } from '@ledge/protocol';
import { goBack } from '../../src/router';
import { LiveTeam } from '../../src/screens/LiveTeam';
import { CATALOG_WAIT_MS } from '../../src/screens/Teams';
import { session } from '../model/fixtures';
import { snapshot } from '../state/helpers';
import { app } from './app-setup';
import { setup } from './setup';

// `goBack` branches on the router's module-level history position, which every hash change moves: its own behaviour is the router's
// (router.test.ts), so the sheet is tested on what it asks of it, whatever order the tests run in.
vi.mock('../../src/router', async importOriginal => ({ ...(await importOriginal<typeof import('../../src/router')>()), goBack: vi.fn() }));
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
function open({ c = catalog(), teams = [team()], confirm = true, sessions = SESSIONS, teamId = 'team-a1b2', onReconnect }: { c?: PhoneCatalog | null; teams?: PhoneTeam[] | null; confirm?: boolean; sessions?: typeof SESSIONS; teamId?: string; onReconnect?: () => void } = {}) {
  const t = setup();
  t.deliver(snapshot(sessions, 'PC-Desan', undefined, { confirm, chat: true }));
  act(() => {
    if (c) t.deliver({ type: 'teams.catalog', catalog: c });
    if (teams) t.deliver({ type: 'teams', teams });
  });
  const view = render(<LiveTeam store={t.store} teamId={teamId} {...(onReconnect ? { onReconnect } : {})} />);
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

  it('a team from an older daemon has no start time: the line says the rest and nothing broken', () => {
    const { createdAt: _createdAt, ...old } = team();
    open({ teams: [old] });
    expect(screen.getByText("ledge · d'après « Revue MR »")).toBeInTheDocument();
  });

  it('shows the team\'s name once: the back header says where it leads', () => {
    open();
    expect(screen.getAllByText('Revue paper-service')).toHaveLength(1);
    expect(screen.getByRole('link', { name: /^Retour/ })).toBeInTheDocument();
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

  it('the seat\'s own effort beats the role\'s on the sheet', () => {
    open({ teams: [team({ seats: [{ role: 'leader', sessionId: 's1', effort: 'low' }] })] });
    expect(within(seat('leader')).getByText('Claude Code · opus · low · demande')).toBeInTheDocument();
    expect(within(seat('leader')).queryByText(/high/)).toBeNull();
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

  it('a prompt that starts with a title and a blank line previews the title and the next line, CRLF or not', () => {
    const c = catalog({ roles: [role('leader', { prompt: '# Chef\r\n\r\nTu découpes la story.\r\nTu confies.' })] });
    open({ c, teams: [team({ seats: [{ role: 'leader', sessionId: 's1' }] })] });
    expect(within(seat('leader')).getByText(/# Chef/)).toHaveTextContent('# Chef Tu découpes la story.');
    expect(within(seat('leader')).queryByText(/Tu confies/)).toBeNull();
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

  it('the confirmation says what the passkey does', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Dissoudre l\'équipe' }));
    expect(within(screen.getByRole('dialog')).getByText('Votre passkey confirme la dissolution.')).toBeInTheDocument();
  });

  it('the confirm button turns off, and says why, when the link is lost while the sheet is open', () => {
    const t = open();
    fireEvent.click(screen.getByRole('button', { name: 'Dissoudre l\'équipe' }));
    act(() => t.set('pc_offline'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Dissoudre l\'équipe' })).toBeDisabled();
    expect(within(dialog).getByText(/PC hors ligne\./)).toBeInTheDocument();
    expect(t.teamOp).not.toHaveBeenCalled();
  });

  it('a team that vanishes while the dissolve is pending shows Gone, and the answer still leads back to Agents once', async () => {
    const t = open();
    let finish!: (r: { status: 'applied' }) => void;
    t.teamOp.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Dissoudre l\'équipe' }));
    await click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Dissoudre l\'équipe' }));
    act(() => t.deliver({ type: 'teams', teams: [] }));
    expect(screen.getByRole('heading', { name: 'Cette équipe n’existe plus' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(goBack).not.toHaveBeenCalled();
    await act(async () => { finish({ status: 'applied' }); });
    expect(goBack).toHaveBeenCalledTimes(1);
    expect(goBack).toHaveBeenCalledWith({ name: 'agents' });
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
  it('waiting for the live teams says so, and not the catalog', () => {
    open({ teams: null });
    expect(screen.getByRole('status')).toHaveTextContent('Lecture de l’équipe…');
  });

  it('past the wait, the live teams\' retry is a new link (the PC pushes them; nothing asks)', () => {
    vi.useFakeTimers();
    try {
      const onReconnect = vi.fn();
      open({ teams: null, onReconnect });
      act(() => { vi.advanceTimersByTime(CATALOG_WAIT_MS); });
      expect(screen.getByText('Équipe indisponible')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Reconnecter et actualiser' }));
      expect(onReconnect).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });

  it('waiting for the catalog says so, and its retry asks for the catalog again', () => {
    vi.useFakeTimers();
    try {
      const t = open({ c: null });
      expect(screen.getByRole('status')).toHaveTextContent('Lecture du catalogue…');
      act(() => { vi.advanceTimersByTime(CATALOG_WAIT_MS); });
      const before = t.sent.filter(m => m.type === 'teams.catalog').length;
      fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
      expect(t.sent.filter(m => m.type === 'teams.catalog').length).toBe(before + 1);
    } finally { vi.useRealTimers(); }
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

describe('the live team sheet, seat model', () => {
  const withModels = (on: boolean) => {
    const t = setup();
    const m = snapshot(SESSIONS.map(s => ({ ...s, canSwitch: true as const })), 'PC-Desan', undefined, { confirm: true, chat: true }) as Extract<import('@ledge/protocol').PhoneServerMessage, { type: 'snapshot' }>;
    t.deliver(on ? { ...m, daemon: { ...m.daemon!, models: true } } : m);
    act(() => { t.deliver({ type: 'teams.catalog', catalog: catalog() }); t.deliver({ type: 'teams', teams: [team()] }); });
    render(<LiveTeam store={t.store} teamId="team-a1b2" />);
  };

  it('Changer opens the seat model sheet', () => {
    withModels(true);
    fireEvent.click(within(seat('leader')).getByRole('button', { name: 'Changer le modèle de @leader' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Modèle et effort');
  });

  it('Changer is disabled like Lever and Dissoudre when the device cannot confirm', () => {
    const t = setup();
    const m = snapshot(SESSIONS.map(s => ({ ...s, canSwitch: true as const })), 'PC-Desan', undefined, { confirm: false, chat: true }) as Extract<import('@ledge/protocol').PhoneServerMessage, { type: 'snapshot' }>;
    t.deliver({ ...m, daemon: { ...m.daemon!, models: true } });
    act(() => { t.deliver({ type: 'teams.catalog', catalog: catalog() }); t.deliver({ type: 'teams', teams: [team()] }); });
    render(<LiveTeam store={t.store} teamId="team-a1b2" />);
    expect(within(seat('leader')).getByRole('button', { name: 'Changer le modèle de @leader' })).toBeDisabled();
  });

  it('no Changer without daemon.models', () => {
    withModels(false);
    expect(screen.queryByRole('button', { name: /Changer le modèle/ })).toBeNull();
  });

  it('a free seat says au prochain démarrage du siège', () => {
    withModels(true);
    expect(within(seat('review')).getByText('au prochain démarrage du siège')).toBeInTheDocument();
  });
});
