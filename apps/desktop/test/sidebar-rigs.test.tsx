import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Escalation, OpenRigStatus, Projects, Rig, RigSeat, Session } from '@ledge/protocol';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { LangProvider } from '../src/i18n/lang';
import { Sidebar } from '../src/shell/sidebar/Sidebar';
import { initialNav, type NavAction } from '../src/nav/state';
import type { Filing } from '../src/atelier/filing';
import type { SessionActions } from '../src/manage/useSessionActions';
import type { Decisions } from '../src/fleet/decisions';

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

const AT = '2026-10-30T14:44:00.000Z';
const PROJECTS: Projects = { projects: [{ id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] }], rules: [] };
const seat = (name: string, extra: Partial<RigSeat> = {}): RigSeat => ({ ref: `${name}@factory`, address: `@${name}`, name, runtime: 'claude-code', state: 'working', ...extra });
const FACTORY: Rig = { id: 'r-factory', name: 'factory', machine: 'local', cwd: '/w/ledge', projectId: null, offProject: false, lifecycle: 'running', kernel: false, repos: [],
  seats: [seat('build', { sessionId: 'local:build' }), seat('orch-lead', { state: 'idle' }), seat('qa', { state: 'stopped' })] };
const KERNEL: Rig = { id: 'r-kernel', name: 'openrig-kernel', machine: 'local', cwd: '/w', projectId: null, offProject: false, lifecycle: 'running', kernel: true, repos: [],
  seats: [seat('operator', { ref: 'operator@kernel' }), seat('queue', { ref: 'queue@kernel', state: 'idle' }), seat('advisor-lead', { ref: 'advisor-lead@kernel', state: 'idle' }), seat('human', { ref: 'human@kernel', runtime: 'terminal', state: 'idle' })] };
const ESC_PENDING_FACTORY: Escalation = { id: 'q1', source: 'rig', machine: 'local', rigId: 'r-factory', from: 'orch-lead@factory', intent: 'decision', summary: 'JSON ou SQLite ?', questions: [], createdAt: AT, state: 'pending' };
const RUNNING: OpenRigStatus = { machine: 'local', state: 'running', version: '0.3.0' };
const otto = fakeSession('local:otto', { name: 'Otto', cwd: '/w/ledge', state: 'working', topic: 'Câbler la liste' });
const build = fakeSession('local:build', { name: 'build', cwd: '/w/ledge', state: 'working', topic: 'Reprise après reboot',
  rig: { machine: 'local', rigId: 'r-factory', rigName: 'factory', seat: 'build@factory', pod: 'dev', member: 'build' } });

let dispatched: NavAction[] = [];
let menu = vi.fn();

function SidebarHarness({ rigs = [], escalations = [], openrig = [RUNNING], sessions = [otto, build] }: { rigs?: Rig[]; escalations?: Escalation[]; openrig?: OpenRigStatus[]; sessions?: Session[] }) {
  const filing = { dragging: null, over: null, seated: null, dragProps: () => ({}), dropProps: () => ({}), file() {}, markSeated() {} } as unknown as Filing;
  const actions: SessionActions = { request() {}, resume() {}, restore() {}, pending: null, confirm() {}, cancel() {}, allowed: () => true };
  const decisions = { decide() {} } as unknown as Decisions;
  return (
    <LangProvider lang="fr">
      <Sidebar nav={{ ...initialNav({ view: 'atelier', helpers: true, paused: true }), place: { kind: 'overview', view: 'atelier', project: 'all' } }} dispatch={a => { dispatched.push(a); }}
        sessions={sessions} archived={[]} machines={[]} projects={PROJECTS} order={sessions} projectIdOf={s => (s.cwd === '/w/ledge' ? 'ledge' : null)}
        filing={filing} actions={actions} decisions={decisions} waits={new Map()} menu={{ open: menu }} onTerminal={() => {}}
        revealArchives={0} revealCurrent={0} rigs={rigs} escalations={escalations} openrig={openrig} />
    </LangProvider>
  );
}

const user = userEvent.setup();
const rigsTree = () => within(screen.getByRole('tree', { name: 'Rigs' }));
const projectsTree = () => within(screen.getByRole('tree', { name: 'Projets, branches et sessions' }));

describe('the sidebar’s Ledge line and Rigs section', () => {
  beforeEach(() => { dispatched = []; menu = vi.fn(); });

  it('la ligne Ledge ouvre l’écran Ledge et ne contient plus de champ', async () => {
    render(<SidebarHarness rigs={[FACTORY]} escalations={[ESC_PENDING_FACTORY]} />);
    expect(screen.queryByPlaceholderText('Demander à Ledge…')).toBeNull();
    const line = screen.getByRole('button', { name: /Ledge\..*Une décision t’attend · factory/ });
    expect(within(line).getByText('1')).toBeVisible();
    const d = new Date(AT);
    expect(line).toHaveTextContent(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
    await user.click(line);
    expect(dispatched).toContainEqual({ type: 'ledge', tab: 'conversation' });
  });

  it('la ligne Ledge au calme : « J’orchestre n rigs », sans pastille', () => {
    render(<SidebarHarness rigs={[FACTORY, KERNEL]} />);
    const line = screen.getByRole('button', { name: /Ledge\..*J’orchestre 1 rig/ });
    expect(line.querySelector('.st-ledge-unread')).toBeNull();
    expect(line).not.toHaveAttribute('aria-current');
  });

  it('Projets ne liste pas build (siège de factory) ; Rigs le liste sous factory', async () => {
    render(<SidebarHarness rigs={[FACTORY, KERNEL]} />);
    expect(projectsTree().getByRole('button', { name: /^Otto/ })).toBeVisible();
    expect(projectsTree().queryByRole('button', { name: /^build/ })).toBeNull();
    const rig = rigsTree().getByRole('treeitem', { name: /factory/ });
    expect(rig).toHaveTextContent('rig · 2');
    expect(rig.querySelector('.side-swatch')).not.toBeNull();
    expect(rigsTree().getByRole('button', { name: /^build/ })).toBeVisible();
    expect(rigsTree().getByRole('button', { name: /^orch-lead/ })).toBeVisible();
    // A stopped seat has left the rig's list.
    expect(rigsTree().queryByRole('button', { name: /^qa/ })).toBeNull();
    await user.click(rigsTree().getByRole('button', { name: /^build/ }));
    expect(dispatched).toContainEqual({ type: 'open', id: 'local:build' });
    fireEvent.contextMenu(rigsTree().getByRole('button', { name: /^build/ }));
    expect(menu).toHaveBeenCalledWith('local:build', expect.anything(), expect.anything());
    // Double-click on the rig's row: the atelier shows its room.
    await user.dblClick(within(rig).getByRole('button', { name: /^factory/ }));
    expect(dispatched).toContainEqual({ type: 'home', project: 'rig:local/r-factory' });
  });

  it('Entrée sur la ligne de rig ouvre sa pièce ; « + » ouvre le lancement d’un rig', async () => {
    render(<SidebarHarness rigs={[FACTORY]} />);
    rigsTree().getByRole('button', { name: /^factory/ }).focus();
    await user.keyboard('{Enter}');
    expect(dispatched).toContainEqual({ type: 'home', project: 'rig:local/r-factory' });
    await user.click(screen.getByRole('button', { name: 'Lancer un rig' }));
    expect(dispatched).toContainEqual({ type: 'modal', modal: { kind: 'rig-launch' } });
  });

  it('Noyau OpenRig replié, puis operator · queue et « +2 »', async () => {
    render(<SidebarHarness rigs={[FACTORY, KERNEL]} />);
    const kernel = rigsTree().getByRole('treeitem', { name: /Noyau OpenRig/ });
    expect(kernel).toHaveTextContent('noyau');
    expect(kernel).toHaveAttribute('aria-expanded', 'false');
    expect(rigsTree().queryByRole('button', { name: /^operator/ })).toBeNull();
    await user.click(within(kernel).getByRole('button', { name: /^Noyau OpenRig/ }));
    expect(rigsTree().getByRole('button', { name: /^operator/ })).toBeVisible();
    expect(rigsTree().getByRole('button', { name: /^queue/ })).toBeVisible();
    expect(rigsTree().queryByRole('button', { name: /^advisor-lead/ })).toBeNull();
    await user.click(rigsTree().getByRole('button', { name: '+2' }));
    expect(rigsTree().getByRole('button', { name: /^advisor-lead/ })).toBeVisible();
    expect(rigsTree().getByRole('button', { name: /^human/ })).toBeVisible();
  });

  it('sans OpenRig : « OpenRig n’est pas installé » sous Rigs', () => {
    render(<SidebarHarness rigs={[]} openrig={[{ machine: 'local', state: 'absent', install: 'npm i -g @openrig/cli' }]} />);
    const section = screen.getByRole('region', { name: 'Rigs' });
    expect(within(section).getByText('OpenRig n’est pas installé')).toBeVisible();
    expect(within(section).getByText('npm i -g @openrig/cli')).toBeVisible();
    expect(within(section).getByRole('button', { name: 'Lancer un rig' })).toBeVisible();
  });

  it('OpenRig arrêté, ou d’une version non prise en charge', () => {
    const { unmount } = render(<SidebarHarness openrig={[{ machine: 'local', state: 'stopped' }]} />);
    expect(screen.getByText('OpenRig est arrêté')).toBeVisible();
    unmount();
    render(<SidebarHarness openrig={[{ machine: 'local', state: 'unsupported', version: '0.1.0' }]} />);
    expect(screen.getByText('OpenRig 0.1.0 non pris en charge')).toBeVisible();
  });

  it('un rig distant dit sa machine, et « injoignable » quand elle est tombée, sans disparaître', () => {
    const remote: Rig = { ...FACTORY, id: 'r-far', name: 'starter', machine: 'ec2', offProject: true, lifecycle: 'unreachable', seats: [seat('dev-build', { state: 'unreachable' })] };
    render(<SidebarHarness rigs={[remote]} />);
    const rig = rigsTree().getByRole('treeitem', { name: /starter/ });
    expect(rig).toHaveTextContent('hors projet');
    expect(rig).toHaveTextContent('· ec2');
    expect(rig).toHaveTextContent('injoignable');
  });

  it('un siège fantôme n’a ni menu ni lien', async () => {
    render(<SidebarHarness rigs={[FACTORY]} />);
    const ghost = rigsTree().getByRole('button', { name: /^orch-lead/ });
    const row = ghost.closest('[role="treeitem"]')!;
    expect(row.querySelector('.st-time')).toBeNull();
    expect(within(row as HTMLElement).queryByRole('button', { name: /Gérer/ })).toBeNull();
    fireEvent.contextMenu(ghost);
    expect(menu).not.toHaveBeenCalled();
    await user.click(ghost);
    expect(dispatched.filter(a => a.type === 'open')).toEqual([]);
  });
});
