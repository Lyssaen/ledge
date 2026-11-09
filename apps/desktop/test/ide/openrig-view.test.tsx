import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DaemonClient, MachineState } from '@ledge/fleet';
import type { ClientMessage, OpenRigState, Rig, RigSeat, ServerMessage } from '@ledge/protocol';
import { LangProvider } from '../../src/i18n/lang';
import { OpenRigView } from '../../src/ide/openrig/OpenRigView';
import { saveDaemonPrefs } from '../../src/ide/openrig/prefs';
import type { OpenRigSection } from '../../src/nav/state';

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

function fake() {
  const listeners = new Set<(m: ServerMessage) => void>(), sent: ClientMessage[] = [];
  const client = { send: (m: ClientMessage) => { sent.push(m); }, onMessage: (f: (m: ServerMessage) => void) => { listeners.add(f); return () => { listeners.delete(f); }; } } as unknown as DaemonClient;
  const emit = (m: ServerMessage) => act(() => listeners.forEach(f => f(m)));
  const status = (machineId: string) => [...sent].reverse().find(m => m.type === 'openrig.status' && m.machineId === machineId) as { requestId: string } | undefined;
  return {
    client, sent,
    state: (machineId: string, state: OpenRigState) => emit({ type: 'openrig.state', requestId: status(machineId)!.requestId, machineId, state }),
    error: (machineId: string, error: 'offline' | 'outdated') => emit({ type: 'openrig.state', requestId: status(machineId)!.requestId, machineId, error } as ServerMessage),
    acts: () => sent.filter(m => m.type === 'openrig.act') as Array<{ action: { kind: string } }>
  };
}
const machine = (id: string, label: string) => ({ id, label, ready: true, status: 'open', recents: [], sessions: [], launcher: null }) as unknown as MachineState;
const seat = (logicalId: string, rig: string, o: Partial<RigSeat> = {}): RigSeat => ({ logicalId, session: `${logicalId.replace('.', '-')}@${rig}`, runtime: 'claude-code', model: null, sessionStatus: 'running', lifecycleState: 'running', activity: 'idle', stopped: false, work: 0, ...o });
const rig = (name: string, status: string, nodes: RigSeat[]): Rig => ({ id: name, name, status, lifecycleState: status, seats: nodes.length, running: status === 'running' ? nodes.length : 0, attention: 0, uptime: null, snapshot: null, nodes });
const state = (working = false, o: Partial<OpenRigState> = {}): OpenRigState => ({
  installed: true, version: '0.7.10', daemon: { state: 'running', startedAt: '2026-11-08T09:12:00.000Z' }, kernel: { state: 'ready' }, at: '2026-11-08T10:00:00.000Z',
  rigs: [
    rig('kernel', 'running', [seat('advisor.lead', 'kernel')]),
    rig('ledge-dev', 'running', [seat('dev.build', 'ledge-dev', working ? { activity: 'running' } : {}), seat('dev.review', 'ledge-dev')]),
    rig('synapse-review', 'stopped', [seat('r.s1', 'synapse-review', { stopped: true })])
  ], ...o
});

function mount(o: { section?: OpenRigSection; output?: number } = {}) {
  const f = fake(), dispatch = vi.fn(), onTab = vi.fn(), onLaunch = vi.fn();
  const output = Array.from({ length: o.output ?? 3 }, (_, i) => ({ seq: i, at: i, machine: 'local', commands: ['rig x'], ok: true, result: null }));
  render(<LangProvider lang="fr"><OpenRigView client={f.client} machines={[machine('local', 'locale'), machine('srv', 'legion')]} machine="local" section={o.section ?? 'overview'}
    projects={null} sessions={[]} asks={[]} output={output} dispatch={dispatch} onTab={onTab} onLaunch={onLaunch} /></LangProvider>);
  return { f, dispatch, onTab, onLaunch };
}

describe('the OpenRig page shell', () => {
  it('the rail shows the six sections with their numbers', () => {
    const m = mount(); m.f.state('local', state());
    const nav = screen.getByRole('navigation');
    expect(within(nav).getByRole('button', { name: /^Vue d’ensemble$/ })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: /^Rigs\s*3$/ })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: /^Rôles/ })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: /^Machines\s*2$/ })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: /^Daemon$/ })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: /^Sortie\s*3$/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vue d’ensemble' })).toBeInTheDocument();
  });
  it('a click on a section dispatches it on the shown machine', async () => {
    const m = mount(); m.f.state('local', state());
    await userEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: /^Daemon$/ }));
    expect(m.dispatch).toHaveBeenCalledWith({ type: 'openrig', machine: 'local', section: 'daemon' });
  });
  it('the current section has a titled placeholder', () => {
    const m = mount({ section: 'daemon' }); m.f.state('local', state());
    expect(screen.getByRole('heading', { name: 'Daemon' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Daemon' })).toBeInTheDocument();
  });
  it('« Lancer un rig… » asks for the launch modal of the machine', async () => {
    const m = mount(); m.f.state('local', state());
    await userEvent.click(screen.getByRole('button', { name: /Lancer un rig…/ }));
    expect(m.onLaunch).toHaveBeenCalledWith('local');
  });
  it('« Arrêter » asks first, under the rail, with the command; confirming sends daemon.stop', async () => {
    const m = mount(); m.f.state('local', state());
    await userEvent.click(screen.getByRole('button', { name: 'Arrêter le daemon' }));
    expect(m.f.acts()).toEqual([]);
    const conf = screen.getByRole('group', { name: /Arrêter le daemon/ });
    expect(conf).toHaveTextContent('rig daemon stop');
    await userEvent.click(within(conf).getByRole('button', { name: 'Confirmer l’arrêt' }));
    expect(m.f.acts().map(a => a.action.kind)).toEqual(['daemon.stop']);
  });
  it('with the confirmation off and nobody working, « Arrêter » sends at once', async () => {
    saveDaemonPrefs('local', { askAlways: false });
    const m = mount(); m.f.state('local', state());
    await userEvent.click(screen.getByRole('button', { name: 'Arrêter le daemon' }));
    expect(m.f.acts().map(a => a.action.kind)).toEqual(['daemon.stop']);
    expect(screen.queryByRole('group')).toBeNull();
  });
  it('with the confirmation off, a seat that started working since the display still asks (decided at the click)', async () => {
    saveDaemonPrefs('local', { askAlways: false });
    const m = mount(); m.f.state('local', state(false));
    // The next poll brings a seat at work.
    act(() => { m.f.state('local', state(true)); });
    await userEvent.click(screen.getByRole('button', { name: 'Arrêter le daemon' }));
    expect(m.f.acts()).toEqual([]);
    expect(screen.getByRole('group', { name: /Arrêter le daemon/ })).toHaveTextContent('dev.build');
  });
  it('a stopped daemon offers « Démarrer » and sends daemon.start at once', async () => {
    const m = mount(); m.f.state('local', state(false, { daemon: { state: 'stopped' }, kernel: { state: 'stopped' }, rigs: [] }));
    await userEvent.click(screen.getByRole('button', { name: 'Démarrer le daemon' }));
    expect(m.f.acts().map(a => a.action.kind)).toEqual(['daemon.start']);
  });
  it('not installed shows the old page\'s text and no daemon button', () => {
    const m = mount(); m.f.state('local', { installed: false, daemon: { state: 'unknown' }, kernel: { state: 'absent' }, rigs: [], at: '2026-11-08T10:00:00.000Z' });
    expect(screen.getByText('OpenRig n’est pas installé')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Comment l’installer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /le daemon$/ })).toBeNull();
  });
  it('offline says so', () => {
    const m = mount(); m.f.error('local', 'offline');
    expect(screen.getByText('Cette machine est hors ligne.')).toBeInTheDocument();
  });
});
