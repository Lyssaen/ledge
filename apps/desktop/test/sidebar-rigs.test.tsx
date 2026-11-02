import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DaemonClient, MachineState } from '@ledge/fleet';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { ClientMessage, OpenRigState, ServerMessage, Session } from '@ledge/protocol';
import { LangProvider } from '../src/i18n/lang';
import { initialNav, navReducer } from '../src/nav/state';
import { startMachineOf, summarize, useSidebarOpenRig, type SidebarOpenRig } from '../src/openrig/sidebarState';
import { RigGroups } from '../src/shell/sidebar/RigGroups';

afterEach(() => cleanup());

/** docs/mockups/ledge-sidebar-tidy.html: the Rigs view's order, options, empty states, and the kernel's real state. */
const seat = (id: string, name: string, rig: string, role: string, extra: Partial<Session> = {}) =>
  fakeSession(id, { name, cwd: `/w/${rig}`, state: 'idle', rig: { seat: `${role.replace('.', '-')}@${rig}`, name: rig, role }, ...extra });
const KERNEL = [seat('k1', 'Nova', 'kernel', 'advisor.agent'), seat('k2', 'Max', 'kernel', 'operator.agent'), seat('k3', 'Rex', 'kernel', 'queue.worker')];
const RIG = [seat('r1', 'Bix', 'ledge-dev', 'pilot.lead', { state: 'working' }), seat('r2', 'Lu', 'ledge-dev', 'design.ux')];

const rig = (o: Partial<SidebarOpenRig> = {}): SidebarOpenRig => ({ installed: true, daemonUp: true, kernelState: () => 'ready', starting: false, failed: null, start: vi.fn(), ...o });
function mount(sessions: readonly Session[], openrig: SidebarOpenRig | undefined, lang: 'fr' | 'en' = 'fr') {
  const dispatch = vi.fn(), onToggleDense = vi.fn();
  render(<LangProvider lang={lang}><aside className="st"><RigGroups sessions={sessions} current={null} paused dispatch={dispatch} openrig={openrig} dense={false} onToggleDense={onToggleDense} /></aside></LangProvider>);
  return { dispatch, onToggleDense };
}

describe('the Rigs view of the sidebar', () => {
  it('shows the Kernel first, in its box, then the Rigs', () => {
    mount([...RIG, ...KERNEL], rig());
    const sections = [...document.querySelectorAll('section')];
    expect(sections.map(s => s.getAttribute('aria-label'))).toEqual(['Kernel', 'Rigs']);
    expect(sections[0]).toHaveClass('st-kernel-box');
    expect(within(sections[0]!).getAllByRole('treeitem').map(r => r.querySelector('strong')!.textContent)).toEqual(['Nova', 'Max', 'Rex']);
  });

  it.each([
    ['ready', 'ready', 'opérationnel', 'operational'],
    ['starting', 'starting', 'démarrage', 'starting'],
    ['stopped', 'stopped', 'arrêté', 'stopped'],
    ['unknown', 'stopped', 'arrêté', 'stopped'],
    ['skipped', 'stopped', 'arrêté', 'stopped']
  ] as const)('the kernel tag follows its real state: %s → %s', (state, shown, fr, en) => {
    mount(KERNEL, rig({ kernelState: () => state }));
    let tag = document.querySelector('.st-kernel-tag')!;
    expect(tag).toHaveAttribute('data-state', shown);
    expect(tag).toHaveTextContent(fr);
    cleanup();
    mount(KERNEL, rig({ kernelState: () => state }), 'en');
    tag = document.querySelector('.st-kernel-tag')!;
    expect(tag).toHaveTextContent(en);
  });

  it('no tag while the kernel’s state is not read yet', () => {
    mount(KERNEL, rig({ kernelState: () => undefined }));
    expect(document.querySelector('.st-kernel-tag')).toBeNull();
  });

  it('the Rigs header: compact, fold all, Launch a rig…; a rig row’s + changes its seats', async () => {
    const { dispatch, onToggleDense } = mount([...RIG, ...KERNEL], rig());
    const rigs = screen.getByRole('region', { name: 'Rigs' });
    await userEvent.click(within(rigs).getByRole('button', { name: 'Mode compact (D)' }));
    expect(onToggleDense).toHaveBeenCalled();
    expect(within(rigs).getByText('Bix')).toBeInTheDocument();
    await userEvent.click(within(rigs).getByRole('button', { name: 'Tout replier' }));
    expect(within(rigs).queryByText('Bix')).toBeNull();
    await userEvent.click(within(rigs).getByRole('button', { name: 'Lancer un rig…' }));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'openrig', section: 'rigs', open: { launch: true } });
    await userEvent.click(within(rigs).getByRole('button', { name: 'Changer les sièges de ledge-dev' }));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'openrig', machine: 'local', section: 'rigs', open: { reseat: 'ledge-dev' } });
    // The kernel header has no options.
    expect(within(screen.getByRole('region', { name: 'Kernel' })).queryAllByRole('button', { name: /compact|replier|Lancer/ })).toEqual([]);
  });

  it('daemon up, no rig: the kernel, then « Aucun rig » naming the operator, and its button launches', async () => {
    const { dispatch } = mount(KERNEL, rig());
    const empty = within(screen.getByRole('region', { name: 'Rigs' })).getByRole('status');
    expect(empty).toHaveTextContent('Aucun rig pour l’instant.');
    expect(empty).toHaveTextContent('Un rig est une équipe d’agents. Max, l’opérateur du kernel, peut t’aider à en composer un.');
    await userEvent.click(within(empty).getByRole('button', { name: 'Lancer un rig…' }));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'openrig', section: 'rigs', open: { launch: true } });
  });

  it('no operator seat: the second sentence is left out', () => {
    mount([], rig());
    expect(screen.getByRole('status')).toHaveTextContent(/^Aucun rig pour l’instant\.Un rig est une équipe d’agents\.Lancer un rig…$/);
  });

  it('OpenRig stopped: « Démarrer OpenRig » starts it', async () => {
    const start = vi.fn();
    mount([], rig({ daemonUp: false, start }));
    const box = screen.getByRole('status');
    expect(box).toHaveTextContent('OpenRig est arrêté.');
    expect(box).toHaveTextContent('Le démarrer lance aussi le kernel : l’opérateur, l’advisor et la file.');
    await userEvent.click(within(box).getByRole('button', { name: 'Démarrer OpenRig' }));
    expect(start).toHaveBeenCalled();
    expect(document.querySelector('section')).toBeNull();
  });

  it('starting: the button is disabled with « Démarrage d’OpenRig… »', () => {
    mount([], rig({ daemonUp: false, starting: true }));
    expect(screen.getByRole('button', { name: 'Démarrage d’OpenRig…' })).toBeDisabled();
  });

  it('failed: the reason in red, Retry, and a link to the OpenRig page', async () => {
    const start = vi.fn();
    const { dispatch } = mount([], rig({ daemonUp: false, failed: 'le port 7433 est déjà utilisé', start }));
    expect(document.querySelector('.st-empty p.err')).toHaveTextContent('Échec : le port 7433 est déjà utilisé');
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(start).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Ouvrir la page OpenRig' }));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'openrig', section: 'rigs' });
  });

  it('OpenRig absent or unknown: nothing', () => {
    mount([], rig({ installed: false, daemonUp: false }));
    expect(document.querySelector('.st-empty, section')).toBeNull();
    cleanup();
    mount([], undefined);
    expect(document.querySelector('.st-empty, section')).toBeNull();
  });

  it('English empty states', () => {
    mount([], rig({ daemonUp: false }), 'en');
    expect(screen.getByRole('status')).toHaveTextContent('OpenRig is stopped.Starting it also starts the kernel: the operator, the advisor and the queue.Start OpenRig');
  });
});

describe('what the sidebar knows of OpenRig', () => {
  const state = (o: Partial<OpenRigState> = {}): OpenRigState => ({ installed: true, daemon: { state: 'running' }, kernel: { state: 'ready' }, rigs: [], at: '2026-11-02T09:00:00.000Z', ...o });
  const machine = (id: string, ready = true) => ({ id, label: id, ready, status: ready ? 'open' : 'closed', recents: [], sessions: [], launcher: null }) as unknown as MachineState;

  it('installed / daemon up across machines', () => {
    expect(summarize([])).toEqual({ installed: false, daemonUp: false });
    expect(summarize([state({ installed: false, daemon: { state: 'unknown' } })])).toEqual({ installed: false, daemonUp: false });
    expect(summarize([state({ daemon: { state: 'stopped' } })])).toEqual({ installed: true, daemonUp: false });
    expect(summarize([state({ daemon: { state: 'stopped' } }), state()])).toEqual({ installed: true, daemonUp: true });
  });

  it('« Démarrer OpenRig » acts on the local machine, else the first that answers', () => {
    expect(startMachineOf([machine('ec2'), machine('local')])).toBe('local');
    expect(startMachineOf([machine('local', false), machine('ec2')])).toBe('ec2');
    expect(startMachineOf([machine('local', false)])).toBeNull();
  });

  it('asks every ready machine, and starts the local one with daemon.start', () => {
    const listeners = new Set<(m: ServerMessage) => void>(), sent: ClientMessage[] = [];
    const client = { send: (m: ClientMessage) => { sent.push(m); }, onMessage: (f: (m: ServerMessage) => void) => { listeners.add(f); return () => { listeners.delete(f); }; } } as unknown as DaemonClient;
    const emit = (m: ServerMessage) => act(() => listeners.forEach(f => f(m)));
    const { result } = renderHook(() => useSidebarOpenRig(client, [machine('local'), machine('ec2'), machine('pi', false)]));
    const asked = sent.filter(m => m.type === 'openrig.status') as Array<{ requestId: string; machineId: string }>;
    expect(asked.map(m => m.machineId).sort()).toEqual(['ec2', 'local']);
    expect(result.current.installed).toBe(false);
    emit({ type: 'openrig.state', requestId: asked.find(m => m.machineId === 'ec2')!.requestId, machineId: 'ec2', state: state({ kernel: { state: 'starting' } }) });
    expect(result.current).toMatchObject({ installed: true, daemonUp: true });
    expect(result.current.kernelState('ec2')).toBe('starting');
    act(() => result.current.start());
    expect(sent.at(-1)).toMatchObject({ type: 'openrig.act', machineId: 'local', action: { kind: 'daemon.start' } });
    expect(result.current.starting).toBe(true);
    emit({ type: 'openrig.done', requestId: (sent.at(-1) as { requestId: string }).requestId, machineId: 'local', ok: false, commands: ['rig daemon start'], error: 'port in use' });
    expect(result.current).toMatchObject({ starting: false, failed: 'port in use' });
  });
});

describe('opening an OpenRig dialog from the sidebar', () => {
  it('the openrig action carries the dialog to open, not on the roles view', () => {
    const nav = initialNav({ view: 'atelier', helpers: true, paused: false });
    expect(navReducer(nav, { type: 'openrig', section: 'rigs', open: { launch: true } }).place).toMatchObject({ kind: 'openrig', open: { launch: true } });
    expect(navReducer(nav, { type: 'openrig', machine: 'ec2', open: { reseat: 'ledge-dev' } }).place).toMatchObject({ kind: 'openrig', machine: 'ec2', open: { reseat: 'ledge-dev' } });
    expect(navReducer(nav, { type: 'openrig', section: 'roles', open: { launch: true } }).place).not.toHaveProperty('open');
    expect(navReducer(nav, { type: 'openrig' }).place).not.toHaveProperty('open');
  });
});
