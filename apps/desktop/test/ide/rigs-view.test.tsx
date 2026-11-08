import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { DaemonClient, MachineState } from '@ledge/fleet';
import type { ClientMessage, OpenRigState, Rig, RigSeat, ServerMessage, Session } from '@ledge/protocol';
import { LangProvider } from '../../src/i18n/lang';
import { RigsView } from '../../src/ide/rigs/RigsView';
import { openrigTab } from '../../src/workspace/store';
import type { Tab } from '../../src/workspace/model';

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

function fake() {
  const listeners = new Set<(m: ServerMessage) => void>(), sent: ClientMessage[] = [];
  const client = { send: (m: ClientMessage) => { sent.push(m); }, onMessage: (f: (m: ServerMessage) => void) => { listeners.add(f); return () => { listeners.delete(f); }; } } as unknown as DaemonClient;
  const emit = (m: ServerMessage) => act(() => listeners.forEach(f => f(m)));
  const status = (machineId: string) => [...sent].reverse().find(m => m.type === 'openrig.status' && m.machineId === machineId) as { requestId: string } | undefined;
  return {
    client, sent, emit,
    state: (machineId: string, state: OpenRigState) => emit({ type: 'openrig.state', requestId: status(machineId)!.requestId, machineId, state }),
    error: (machineId: string, error: 'offline' | 'outdated') => emit({ type: 'openrig.state', requestId: status(machineId)!.requestId, machineId, error } as ServerMessage),
    acts: () => sent.filter(m => m.type === 'openrig.act')
  };
}
const machine = (id: string, label: string, ssh?: string) => ({ id, label, ready: true, status: 'open', recents: [], sessions: [], launcher: null, ...(ssh ? { ssh } : {}) }) as unknown as MachineState;
const seat = (logicalId: string, rig: string, o: Partial<RigSeat> = {}): RigSeat => ({ logicalId, session: `${logicalId.replace('.', '-')}@${rig}`, runtime: 'claude-code', model: null, sessionStatus: 'running', lifecycleState: 'running', activity: 'idle', stopped: false, work: 0, ...o });
const rig = (name: string, status: string, nodes: RigSeat[]): Rig => ({ id: name, name, status, lifecycleState: status, seats: nodes.length, running: status === 'running' ? nodes.length : 0, attention: 0, uptime: null, snapshot: null, nodes });
const state = (o: Partial<OpenRigState> = {}): OpenRigState => ({
  installed: true, version: '0.7.10', daemon: { state: 'running' }, kernel: { state: 'ready' }, at: '2026-11-08T10:00:00.000Z',
  rigs: [
    rig('kernel', 'running', [seat('a.one', 'kernel'), seat('a.two', 'kernel'), seat('a.three', 'kernel')]),
    rig('ledge-dev', 'running', [seat('dev.build', 'ledge-dev', { activity: 'running' }), seat('dev.review', 'ledge-dev')]),
    rig('synapse-review', 'stopped', [1, 2, 3, 4].map(i => seat(`r.s${i}`, 'synapse-review', { stopped: true })))
  ], ...o
});
const AT = new Date().toISOString();
const bix = (): Session => fakeSession('b1', { name: 'Bix', state: 'working', machineId: 'local', rig: { seat: 'dev-build@ledge-dev', name: 'ledge-dev' }, context: { used: 50, window: 200, at: AT } });

function mount(o: { machines?: MachineState[]; sessions?: Session[]; activeTab?: Tab | null } = {}) {
  const f = fake(), dispatch = vi.fn(), onTab = vi.fn(), onMenu = vi.fn();
  const ui = () => <LangProvider lang="fr"><RigsView client={f.client} machines={o.machines ?? [machine('local', 'locale')]} sessions={o.sessions ?? []} asks={[]} activeTab={o.activeTab ?? null} dispatch={dispatch} onTab={onTab} onMenu={onMenu} /></LangProvider>;
  const r = render(ui());
  return { f, dispatch, onTab, onMenu, remount: () => { r.unmount(); render(ui()); } };
}
const running = (m = mount()) => { m.f.state('local', state()); return m; };
const rowOf = (name: string) => screen.getByRole('button', { name }).closest('.ide-rigs-row') as HTMLElement;

describe('the IDE Rigs view', () => {
  it('shows the Kernel, Rigs and OpenRig sections, the rigs and their seats, the daemon and its version', () => {
    running(mount({ sessions: [bix()] }));
    expect(screen.getByRole('button', { name: /^Kernel/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Rigs\s*2/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^OpenRig/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ledge-dev' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bix/ }).closest('.ide-rigs-row')).toHaveTextContent('25 %');
    expect(screen.getByText('dev.review')).toBeInTheDocument();
    expect(screen.queryByText('r.s1')).toBeNull();
    expect(within(rowOf('synapse-review')).getByRole('button', { name: /Réduire|Déplier|Replier/ })).toBeDisabled();
    expect(within(screen.getByRole('button', { name: 'Daemon' }).closest('.ide-rigs-row') as HTMLElement).getByText('0.7.10')).toBeInTheDocument();
  });
  it('a stop asks under its row (nothing sent), with the command; confirming sends it on the machine', async () => {
    const m = running();
    await userEvent.click(screen.getByRole('button', { name: 'Arrêter ledge-dev' }));
    expect(m.f.acts()).toEqual([]);
    const conf = rowOf('ledge-dev').nextElementSibling as HTMLElement;
    expect(conf).toHaveTextContent('rig down ledge-dev');
    expect(conf).toHaveTextContent('Arrêter le rig « ledge-dev » sur locale ?');
    await userEvent.click(within(conf).getByRole('button', { name: 'Confirmer l’arrêt' }));
    expect(m.f.acts()).toMatchObject([{ action: { kind: 'rig.stop', rig: 'ledge-dev' }, machineId: 'local' }]);
  });
  it('a restart asks too, with its note; Cancel and Escape close without sending; one confirmation at a time', async () => {
    const m = running();
    await userEvent.click(screen.getByRole('button', { name: 'Redémarrer ledge-dev' }));
    expect(screen.getByRole('button', { name: 'Confirmer le redémarrage' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Arrêter le kernel' }));
    expect(screen.getAllByRole('button', { name: /^Confirmer/ })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('button', { name: /^Confirmer/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Arrêter ledge-dev' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: /^Confirmer/ })).toBeNull();
    expect(m.f.acts()).toEqual([]);
  });
  it('a start runs at once', async () => {
    const m = running();
    await userEvent.click(screen.getByRole('button', { name: 'Démarrer synapse-review' }));
    expect(m.f.acts()).toMatchObject([{ action: { kind: 'rig.start', rig: 'synapse-review' }, machineId: 'local' }]);
    expect(screen.queryByRole('button', { name: /^Confirmer/ })).toBeNull();
  });
  it('while an action runs the row\'s buttons are disabled; a failure leaves its message under the row', async () => {
    const m = running();
    await userEvent.click(screen.getByRole('button', { name: 'Démarrer synapse-review' }));
    expect(screen.getByRole('button', { name: 'Démarrer synapse-review' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Arrêter ledge-dev' })).toBeEnabled();
    m.f.emit({ type: 'openrig.done', requestId: (m.f.acts()[0] as { requestId: string }).requestId, ok: false, commands: [], error: 'busy' });
    expect(screen.getByRole('button', { name: 'Démarrer synapse-review' })).toBeEnabled();
    expect(rowOf('synapse-review').nextElementSibling).toHaveTextContent('Une autre action OpenRig est en cours sur cette machine.');
  });
  it('a stopped daemon: the empty box, Démarrer OpenRig, and a confirmation open on a rig closes', async () => {
    const m = running();
    await userEvent.click(screen.getByRole('button', { name: 'Arrêter ledge-dev' }));
    m.f.state('local', state({ daemon: { state: 'stopped' }, rigs: [] }));
    expect(screen.queryByRole('button', { name: /^Confirmer/ })).toBeNull();
    expect(screen.getByText('OpenRig est arrêté.')).toBeInTheDocument();
    expect(screen.getByText('Les rigs et le kernel repartent avec le daemon.')).toBeInTheDocument();
    expect(screen.getByText('Arrêté avec le daemon.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Démarrer OpenRig' }));
    expect(m.f.acts()).toMatchObject([{ action: { kind: 'daemon.start' }, machineId: 'local' }]);
  });
  it('a stopped kernel says the operator cannot help compose a rig', () => {
    const m = mount();
    m.f.state('local', state({ rigs: [rig('kernel', 'stopped', []), rig('ledge-dev', 'running', [])] }));
    expect(screen.getByText('L’operator ne peut pas t’aider à composer un rig.')).toBeInTheDocument();
  });
  it('the machine menu: two machines, choosing srv saves it and asks srv; offline shows no actions', async () => {
    const m = mount({ machines: [machine('local', 'locale'), machine('srv', 'srv', 'srv')] });
    m.f.state('local', state());
    await userEvent.click(screen.getByRole('button', { name: /locale/, expanded: false }));
    const menu = screen.getByRole('menu');
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute('aria-checked', 'true');
    expect(items[0]).toHaveTextContent('1 rig en marche');
    expect(items[1]).toHaveTextContent('SSH');
    await userEvent.click(items[1]!);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(localStorage.getItem('ledge.ide.rigsMachine')).toBe('"srv"');
    expect(m.f.sent.some(x => x.type === 'openrig.status' && x.machineId === 'srv')).toBe(true);
    m.f.error('srv', 'offline');
    expect(screen.getByText('Cette machine est hors ligne.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Arrêter|Démarrer|Redémarrer)/ })).toBeNull();
  });
  it('an outdated Ledge says so, not offline', () => {
    const m = mount();
    m.f.error('local', 'outdated');
    expect(screen.getByText('Le Ledge de cette machine est trop ancien pour piloter OpenRig. Mettez-le à jour.')).toBeInTheDocument();
    expect(screen.queryByText('Cette machine est hors ligne.')).toBeNull();
  });
  it('OpenRig absent, and first load, reuse the existing texts', () => {
    const m = mount();
    expect(screen.getByText('Lecture d’OpenRig…')).toBeInTheDocument();
    m.f.state('local', state({ installed: false, rigs: [] }));
    expect(screen.getByText('OpenRig n’est pas installé')).toBeInTheDocument();
  });
  it('a vanished saved machine falls back to local', () => {
    localStorage.setItem('ledge.ide.rigsMachine', '"gone"');
    const m = mount();
    expect(m.f.sent.some(x => x.type === 'openrig.status' && x.machineId === 'local')).toBe(true);
  });
  it('manage, add, launch and the names go where the plan says', async () => {
    const m = running();
    await userEvent.click(screen.getByRole('button', { name: /locale/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Gérer les machines…' }));
    expect(m.dispatch).toHaveBeenCalledWith({ type: 'settings', section: 'machines' });
    await userEvent.click(screen.getByRole('button', { name: /locale/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Ajouter une machine' }));
    expect(m.dispatch).toHaveBeenLastCalledWith({ type: 'settings', section: 'machines' });
    await userEvent.click(screen.getByRole('button', { name: /Lancer/ }));
    expect(m.dispatch).toHaveBeenLastCalledWith({ type: 'openrig', machine: 'local', section: 'rigs', open: { launch: true } });
    await userEvent.click(screen.getByRole('button', { name: 'ledge-dev' }));
    expect(m.onTab).toHaveBeenLastCalledWith(openrigTab('local'));
    await userEvent.click(screen.getByRole('button', { name: 'Daemon' }));
    expect(m.onTab).toHaveBeenLastCalledWith(openrigTab('local'));
  });
  it('Escape and an outside click close the menu', async () => {
    running();
    await userEvent.click(screen.getByRole('button', { name: /locale/ }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /locale/ }));
    fireEvent.mouseDown(document.body); fireEvent.click(screen.getByTestId('ide-rigs-back'));
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it('the daemon row is highlighted while its OpenRig tab is active', () => {
    running(mount({ activeTab: openrigTab('local') }));
    expect(screen.getByRole('button', { name: 'Daemon' }).closest('.ide-rigs-row')).toHaveClass('sel');
  });
  it('a seat opens its session (Ctrl: right), right click asks for its menu; a seat without session has no button', async () => {
    const m = running(mount({ sessions: [bix()] }));
    await userEvent.click(screen.getByRole('button', { name: /Bix/ }));
    expect(m.dispatch).toHaveBeenLastCalledWith({ type: 'open', id: 'b1' });
    fireEvent.click(screen.getByRole('button', { name: /Bix/ }), { ctrlKey: true });
    expect(m.dispatch).toHaveBeenLastCalledWith({ type: 'open', id: 'b1', where: 'right' });
    fireEvent.contextMenu(screen.getByRole('button', { name: /Bix/ }), { clientX: 5, clientY: 6 });
    expect(m.onMenu).toHaveBeenCalledWith('b1', { x: 5, y: 6 }, expect.any(HTMLElement));
    expect(screen.queryByRole('button', { name: /dev\.review/ })).toBeNull();
  });
  it('folding Rigs hides its rows and survives a remount', async () => {
    const m = running();
    await userEvent.click(screen.getByRole('button', { name: /^Rigs\s*2/ }));
    expect(screen.queryByRole('button', { name: 'ledge-dev' })).toBeNull();
    m.remount();
    m.f.state('local', state());
    expect(screen.getByRole('button', { name: /^Rigs\s*2/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'ledge-dev' })).toBeNull();
  });
});
