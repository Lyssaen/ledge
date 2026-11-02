import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DaemonClient, MachineState } from '@ledge/fleet';
import type { ClientMessage, OpenRigState, ServerMessage } from '@ledge/protocol';
import { LangProvider } from '../src/i18n/lang';
import { OpenRigPage } from '../src/openrig/OpenRigPage';
import { initialNav, navReducer } from '../src/nav/state';

afterEach(() => cleanup());

function fake() {
  const listeners = new Set<(m: ServerMessage) => void>(), sent: ClientMessage[] = [];
  const client = { send: (m: ClientMessage) => { sent.push(m); }, onMessage: (f: (m: ServerMessage) => void) => { listeners.add(f); return () => { listeners.delete(f); }; } } as unknown as DaemonClient;
  return { client, sent, emit: (m: ServerMessage) => act(() => listeners.forEach(f => f(m))) };
}
const machine = (id: string, label: string, ready = true) => ({ id, label, ready, status: ready ? 'open' : 'closed', recents: [], sessions: [], launcher: null }) as unknown as MachineState;
const MACHINES = [machine('local', 'Local'), machine('ec2', 'EC2 - AWS', false)];
const seat = (logicalId: string, activity: string, work = 0) => ({ logicalId, session: `${logicalId.replace('.', '-')}@starter`, runtime: 'claude-code', model: null, sessionStatus: 'running', lifecycleState: 'running', activity, stopped: false, work });
const RUNNING: OpenRigState = {
  installed: true, version: '0.6.14', daemon: { state: 'running', pid: 42, port: 7433 }, kernel: { state: 'ready' }, at: '2026-11-02T09:00:00.000Z',
  rigs: [
    { id: '1', name: 'starter', status: 'running', lifecycleState: 'running', seats: 2, running: 2, attention: 1, uptime: '2h', snapshot: '5m ago', nodes: [seat('dev.build', 'running', 2), seat('dev.review', 'idle')] },
    { id: '2', name: 'research', status: 'stopped', lifecycleState: 'recoverable', seats: 2, running: 0, attention: 0, uptime: null, snapshot: '1d ago', nodes: [] },
    { id: 'k', name: 'kernel', status: 'running', lifecycleState: 'running', seats: 4, running: 4, attention: 0, uptime: '3d', snapshot: null, nodes: [seat('operator.agent', 'idle')] }
  ]
};
const mount = (client: DaemonClient, onNav = vi.fn()) => render(<LangProvider lang="fr"><OpenRigPage client={client} machines={MACHINES} dispatch={onNav} /></LangProvider>);
const answer = (f: ReturnType<typeof fake>, state: OpenRigState) => f.emit({ type: 'openrig.state', requestId: (f.sent.find(m => m.type === 'openrig.status') as { requestId: string }).requestId, machineId: 'local', state });

describe('the OpenRig page', () => {
  it('asks the local machine; shows the daemon, the kernel and the rigs, the kernel out of the list', async () => {
    const f = fake();
    mount(f.client);
    expect(f.sent[0]).toMatchObject({ type: 'openrig.status', machineId: 'local' });
    expect(screen.getByRole('status')).toHaveTextContent('Lecture d’OpenRig…');
    answer(f, RUNNING);
    expect(screen.getByRole('region', { name: 'Daemon' })).toHaveTextContent('Actif');
    expect(screen.getByRole('region', { name: 'Daemon' })).toHaveTextContent('127.0.0.1:7433 · pid 42');
    expect(screen.getByRole('region', { name: 'Kernel' })).toHaveTextContent('Prêt');
    expect(screen.getAllByRole('button', { name: /Voir les sièges de/ }).map(b => b.textContent)).toEqual(['starter', 'research']);
    expect(screen.getByText('1 à surveiller')).toBeInTheDocument();
    // Unfolding a rig shows its seats.
    await userEvent.click(screen.getByRole('button', { name: 'Voir les sièges de starter' }));
    expect(screen.getByText('dev.build')).toBeInTheDocument();
    expect(screen.getByText('2 tâches')).toBeInTheDocument();
  });
  it('a start runs at once; a stop asks first, names who works, and sends the options chosen', async () => {
    const f = fake();
    mount(f.client);
    answer(f, RUNNING);
    const research = screen.getByRole('button', { name: 'Voir les sièges de research' }).closest('li')!;
    await userEvent.click(within(research).getByRole('button', { name: 'Démarrer' }));
    expect(f.sent.at(-1)).toMatchObject({ type: 'openrig.act', machineId: 'local', action: { kind: 'rig.start', rig: 'research' } });
    expect(screen.getByRole('status')).toHaveTextContent('En cours : rig up research --existing --yes');
    f.emit({ type: 'openrig.done', requestId: (f.sent.at(-1) as { requestId: string }).requestId, machineId: 'local', ok: true, commands: [] });

    const starter = screen.getByRole('button', { name: 'Voir les sièges de starter' }).closest('li')!;
    await userEvent.click(within(starter).getByRole('button', { name: 'Arrêter' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Arrêter le rig « starter » sur Local ?' });
    expect(dialog).toHaveTextContent('1 siège travaille');
    expect(dialog).toHaveTextContent('dev.build');
    expect(dialog).toHaveTextContent('rig down starter --snapshot');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Couper tout de suite/ }));
    expect(dialog).toHaveTextContent('rig down starter --snapshot --force');
    const before = f.sent.length;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Arrêter le rig « starter »' }));
    expect(f.sent.slice(before)).toEqual([expect.objectContaining({ type: 'openrig.act', action: { kind: 'rig.stop', rig: 'starter', snapshot: true, force: true } })]);
  });
  it('a failed action says why and which command', async () => {
    const f = fake();
    mount(f.client);
    answer(f, { ...RUNNING, daemon: { state: 'stopped', message: 'Daemon not running.' }, kernel: { state: 'stopped' } });
    expect(screen.getAllByText('Démarrez le daemon d’abord.')).toHaveLength(2);
    await userEvent.click(within(screen.getByRole('region', { name: 'Daemon' })).getByRole('button', { name: 'Démarrer' }));
    const ask = f.sent.at(-1) as { requestId: string };
    expect(ask).toMatchObject({ action: { kind: 'daemon.start', restore: 'last' } });
    f.emit({ type: 'openrig.done', requestId: ask.requestId, machineId: 'local', ok: false, commands: ['rig start --last'], error: 'Error: port 7433 in use' });
    expect(screen.getByRole('alert')).toHaveTextContent('Échec : Error: port 7433 in use');
    expect(screen.getByRole('alert')).toHaveTextContent('rig start --last');
  });
  it('not installed, an outdated Ledge, an offline machine', async () => {
    const f = fake();
    const { unmount } = mount(f.client);
    answer(f, { installed: false, daemon: { state: 'unknown' }, kernel: { state: 'unknown' }, rigs: [], at: RUNNING.at });
    expect(screen.getByText('OpenRig n’est pas installé')).toBeInTheDocument();
    f.emit({ type: 'openrig.state', requestId: (f.sent[0] as { requestId: string }).requestId, machineId: 'local', error: 'outdated' });
    expect(screen.getByRole('status')).toHaveTextContent('trop ancien');
    unmount();
    const g = fake();
    render(<LangProvider lang="fr"><OpenRigPage client={g.client} machines={MACHINES} machine="ec2" dispatch={vi.fn()} /></LangProvider>);
    expect(screen.getByRole('status')).toHaveTextContent('Cette machine est hors ligne.');
    expect(g.sent).toEqual([]);
  });
  it('a machine chip opens that machine; Échap goes back to the atelier', async () => {
    const f = fake(), onNav = vi.fn();
    mount(f.client, onNav);
    await userEvent.click(screen.getByRole('tab', { name: /EC2 - AWS/ }));
    expect(onNav).toHaveBeenCalledWith({ type: 'openrig', machine: 'ec2' });
    const nav = navReducer(initialNav({ helpers: true, paused: false } as never), { type: 'openrig', machine: 'ec2' });
    expect(nav.place).toMatchObject({ kind: 'openrig', machine: 'ec2' });
    expect(navReducer(nav, { type: 'escape' }).place.kind).toBe('overview');
  });
  it('arriving from the sidebar opens the launch form, or a running rig’s seats (sidebar tidy)', () => {
    const f = fake();
    const launch = render(<LangProvider lang="fr"><OpenRigPage client={f.client} machines={MACHINES} open={{ launch: true }} dispatch={vi.fn()} /></LangProvider>);
    answer(f, RUNNING);
    expect(document.querySelector('.or-launch')).toHaveAttribute('aria-label', 'Lancer un rig');
    launch.unmount();
    const g = fake();
    render(<LangProvider lang="fr"><OpenRigPage client={g.client} machines={MACHINES} open={{ reseat: 'starter' }} dispatch={vi.fn()} /></LangProvider>);
    answer(g, RUNNING);
    expect(screen.getByRole('dialog', { name: 'Sièges du rig « starter » · Local' })).toBeVisible();
  });
});
