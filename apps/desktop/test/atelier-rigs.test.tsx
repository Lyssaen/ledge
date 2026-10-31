import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Escalation, Exchange, Projects, Rig, RigSeat, Session } from '@ledge/protocol';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { LangProvider } from '../src/i18n/lang';
import { Atelier } from '../src/atelier/Atelier';
import { RigRoom } from '../src/atelier/RigRoom';
import { initialNav, type NavAction } from '../src/nav/state';
import type { Filing } from '../src/atelier/filing';
import type { SessionActions } from '../src/manage/useSessionActions';
import type { SessionMenuState } from '../src/manage/useSessionMenu';
import { sceneOf } from '../src/atelier/layout';
import { saveSeats } from '../src/atelier/seats';

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

const PROJECTS: Projects = { projects: [{ id: 'ledge', name: 'Ledge', color: 'blue', description: '', rigs: [], repos: [{ machine: 'local', path: '/w/ledge' }] }], rules: [] };
const seat = (name: string, extra: Partial<RigSeat> = {}): RigSeat => ({ ref: `${name}@factory`, address: `@${name}`, name, runtime: 'claude-code', state: 'working', ...extra });
const rigOf = (name: string): Session['rig'] => ({ machine: 'local', rigId: 'r1', rigName: 'factory', seat: `${name}@factory`, pod: 'dev', member: name });
const paired = (name: string) => fakeSession(`local:${name}`, { name, cwd: '/w/ledge', state: 'working', machineId: 'local', topic: `Task of ${name}`, rig: rigOf(name) });
const build = paired('build'), orch = paired('orch-lead'), reviewA = paired('review-a');
const otto = fakeSession('local:otto', { name: 'Otto', cwd: '/w/ledge', state: 'working', machineId: 'local' });
const SESSIONS = [otto, build, orch, reviewA];
const FACTORY: Rig = { id: 'r1', name: 'factory', machine: 'local', cwd: '/w/ledge', projectId: 'ledge', offProject: false, lifecycle: 'running', kernel: false, repos: [],
  seats: [seat('build', { ref: 'dev-build@factory', sessionId: 'local:build' }), seat('orch-lead', { sessionId: 'local:orch-lead' }), seat('review-a', { sessionId: 'local:review-a' }),
    seat('design', { state: 'ready' }), seat('qa'), seat('review-b', { state: 'ready' })] };
const KERNEL: Rig = { id: 'k', name: 'openrig-kernel', machine: 'local', cwd: '/w', projectId: null, offProject: false, lifecycle: 'running', kernel: true, repos: [],
  seats: [seat('operator', { ref: 'operator@kernel' }), seat('queue', { ref: 'queue@kernel', state: 'idle' }), seat('advisor-lead', { ref: 'advisor-lead@kernel', state: 'idle' }), seat('human', { ref: 'human@kernel', runtime: 'terminal', state: 'idle' })] };
const ESC: Escalation = { id: 'q1', source: 'rig', machine: 'local', rigId: 'r1', from: 'orch-lead@factory', intent: 'decision', summary: 'JSON ou SQLite ?', questions: [], createdAt: '2026-10-30T14:44:00.000Z', state: 'pending' };

const filing = { dragging: null, over: null, seated: null, dragProps: () => ({}), dropProps: () => ({ onDragOver() {}, onDragLeave() {}, onDrop() {} }), file() {}, markSeated() {} } as unknown as Filing;
const actions: SessionActions = { request() {}, resume() {}, restore() {}, pending: null, confirm() {}, cancel() {}, allowed: () => true };
const menu = { menu: null, session: null, renaming: null, open: vi.fn(), close() {}, terminal() {}, rename() {}, closeRename() {}, sendRename() {} } as unknown as SessionMenuState;

let dispatched: NavAction[] = [];
let terminals: { rig: string; seat: string }[] = [];
const user = userEvent.setup();

function renderAtelier({ rigs = [FACTORY, KERNEL], escalations = [] as Escalation[], exchanges = new Map<string, Exchange[]>(), sessions = SESSIONS, filter = 'all' } = {}) {
  const nav = { ...initialNav({ view: 'atelier', helpers: true, paused: true }), place: { kind: 'overview' as const, view: 'atelier' as const, project: filter } };
  return render(
    <LangProvider lang="fr">
      <Atelier nav={nav} dispatch={a => { dispatched.push(a); }} sessions={sessions} projects={PROJECTS} order={sessions} rigs={rigs}
        projectIdOf={s => (s.cwd.startsWith('/w/ledge') ? 'ledge' : null)} filing={filing} actions={actions} menu={menu}
        escalations={escalations} exchanges={exchanges} onSeatTerminal={(rig, s) => { terminals.push({ rig: rig.name, seat: s.name }); }} />
    </LangProvider>
  );
}
const room = (key: string) => document.querySelector<HTMLElement>(`[data-room="${key}"]`)!;

describe('rig and kernel rooms in the atelier', () => {
  beforeEach(() => { dispatched = []; terminals = []; });

  it('plaque : « factory · rig · 6 sièges · dans Ledge · 4 au travail »', () => {
    renderAtelier();
    const plaque = room('local/r1').querySelector('.room-plaque')!;
    expect(plaque).toHaveTextContent(/factory.*rig · 6 sièges.*dans Ledge.*4 au travail/);
    expect(plaque).not.toHaveTextContent('sur ');
  });

  it('plaque distante : « sur ec2-build », hors projet abrégé, injoignable', () => {
    const remote: Rig = { ...FACTORY, machine: 'ec2-build', projectId: null, offProject: true, cwd: '/home/me/rigs/reprise-wsl', lifecycle: 'unreachable',
      seats: FACTORY.seats.map(s => ({ ...s, sessionId: undefined })) };
    renderAtelier({ rigs: [remote] });
    const plaque = room('ec2-build/r1').querySelector('.room-plaque')!;
    expect(plaque).toHaveTextContent(/hors projet · ~\/rigs\/reprise-wsl/);
    expect(plaque).toHaveTextContent('sur ec2-build');
    expect(plaque).toHaveTextContent('injoignable');
  });

  it('le siège fantôme design n’ouvre pas de page de session et n’a pas de menu', async () => {
    const errors = vi.spyOn(console, 'error');
    renderAtelier();
    const r = within(room('local/r1'));
    const ghost = r.getByText('design').closest('.agent-seat') as HTMLElement;
    expect(ghost).not.toBeNull();
    expect(ghost.closest('[data-agent]')).toBeNull();
    expect(ghost.tagName).not.toBe('BUTTON');
    expect(ghost.querySelector('button, a')).toBeNull();
    expect(ghost.getAttribute('draggable')).toBeNull();
    expect(r.queryByRole('button', { name: /design/ })).toBeNull();
    await user.click(ghost);
    expect(dispatched).toEqual([]);
    // A paired seat still opens its page.
    await user.click(r.getByRole('button', { name: /^build,/ }));
    expect(dispatched).toEqual([{ type: 'open', id: 'local:build' }]);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('une table de rig garde ses sièges appariés : les fantômes en trop vont dans « +N »', () => {
    saveSeats(4);
    renderAtelier();
    const r = room('local/r1');
    // Four seats: the three paired ones, then the first placeholder; qa and review-b wait in « +2 ».
    expect([...r.querySelectorAll<HTMLElement>('.agent-seat')].map(e => e.querySelector('.seat-name')?.textContent)).toEqual(['build', 'orch-lead', 'review-a', 'design']);
    expect(within(r).getByText('+2')).toBeVisible();
  });

  it('« … › Terminaux › build » ouvre le terminal du siège', async () => {
    renderAtelier();
    const r = within(room('local/r1'));
    await user.click(r.getByRole('button', { name: 'Actions du rig factory' }));
    const m = within(screen.getByRole('menu', { name: 'Actions du rig factory' }));
    await user.click(m.getByRole('menuitem', { name: 'Terminaux' }));
    await user.click(m.getByRole('menuitem', { name: 'build' }));
    expect(terminals).toEqual([{ rig: 'factory', seat: 'build' }]);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('« … › Fil du rig » ouvre la conversation de Ledge', async () => {
    renderAtelier();
    await user.click(within(room('local/r1')).getByRole('button', { name: 'Actions du rig factory' }));
    await user.click(screen.getByRole('menuitem', { name: 'Fil du rig' }));
    expect(dispatched).toContainEqual({ type: 'ledge', tab: 'conversation' });
  });

  it('extraActions est rendu en fin de menu', async () => {
    const scene = sceneOf(SESSIONS, PROJECTS, () => 'ledge', 'all', [FACTORY], new Map(SESSIONS.map(s => [s.id, s])));
    const rigRoom = scene.rooms.find(r => r.kind === 'rig')!;
    if (rigRoom.kind !== 'rig') throw new Error('no rig room');
    render(<LangProvider lang="fr"><RigRoom room={rigRoom} width={800} dispatch={() => {}} onTerminal={() => {}} extraActions={<button role="menuitem">Arrêter…</button>}><div /></RigRoom></LangProvider>);
    await user.click(screen.getByRole('button', { name: 'Actions du rig factory' }));
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem').map(i => i.textContent);
    expect(items.at(-1)).toBe('Arrêter…');
  });

  it('plaque du noyau : « Noyau OpenRig », la mécanique, et « +2 » à côté de la table', () => {
    renderAtelier();
    const k = room('local/k');
    expect(k.querySelector('.room-plaque')).toHaveTextContent(/Noyau OpenRig.*la mécanique · operator et queue/);
    expect(within(k).getByText('+2')).toBeVisible();
    expect(within(k).getByText('operator')).toBeVisible();
    expect(within(k).queryByText('advisor-lead')).toBeNull();
  });

  it('le bureau de Ledge : « J’orchestre 1 rig · 1 décision pour toi », sinon « Je veille sur n agents »', () => {
    const { unmount } = renderAtelier({ escalations: [ESC] });
    expect(screen.getByRole('button', { name: 'Parler à Ledge' })).toHaveTextContent('J’orchestre 1 rig · 1 décision pour toi.');
    unmount();
    renderAtelier({ rigs: [] });
    expect(screen.getByRole('button', { name: 'Parler à Ledge' })).toHaveTextContent(/Je veille sur \d+ agents/);
  });

  it('un échange récent entre deux sièges : une bulle sur la table', async () => {
    const ex: Exchange = { id: 'e1', machine: 'local', rigId: 'r1', from: 'dev-build@factory', to: '@review-a', kind: 'message', text: 'Candidat prêt', at: new Date().toISOString() };
    renderAtelier({ exchanges: new Map([['local/r1', [ex]]]) });
    expect(await screen.findByRole('button', { name: /build écrit à review-a : Candidat prêt/ })).toBeInTheDocument();
  });
});
