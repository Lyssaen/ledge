import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DaemonClient, MachineState } from '@ledge/fleet';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { ClientMessage, OpenRigState, ServerMessage, Session } from '@ledge/protocol';
import { LangProvider } from '../src/i18n/lang';
import { initialNav, navReducer } from '../src/nav/state';
import { summarize, useSidebarOpenRig, type SidebarOpenRig } from '../src/openrig/sidebarState';
import { useOpenRig } from '@ledge/fleet/openrig';
import { kernelTagOf, RigGroups } from '../src/shell/sidebar/RigGroups';

afterEach(() => cleanup());

/** docs/mockups/ledge-sidebar-tidy.html: the Rigs view's order, options, empty states, and the kernel's real state. */
const seat = (id: string, name: string, rig: string, role: string, extra: Partial<Session> = {}) =>
  fakeSession(id, { name, cwd: `/w/${rig}`, state: 'idle', rig: { seat: `${role.replace('.', '-')}@${rig}`, name: rig, role }, ...extra });
const KERNEL = [seat('k1', 'Nova', 'kernel', 'advisor.agent'), seat('k2', 'Max', 'kernel', 'operator.agent'), seat('k3', 'Rex', 'kernel', 'queue.worker')];
const RIG = [seat('r1', 'Bix', 'ledge-dev', 'pilot.lead', { state: 'working' }), seat('r2', 'Lu', 'ledge-dev', 'design.ux')];

const rig = (o: Partial<SidebarOpenRig> = {}): SidebarOpenRig => ({ installed: true, daemonUp: true, kernelState: () => 'ready', labelOf: m => ({ local: 'WSL', ec2: 'EC2' })[m] ?? m, canStart: true, starting: false, failed: null, start: vi.fn(), ...o });
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

  it('kernel seats on two machines, ready on one and stopped on the other: « arrêté », each machine in the tooltip (review P2)', () => {
    const two = [KERNEL[0]!, { ...KERNEL[1]!, machineId: 'ec2' }, KERNEL[2]!];
    mount(two, rig({ kernelState: m => (m === 'ec2' ? 'stopped' : 'ready') }));
    const tag = document.querySelector('.st-kernel-tag')!;
    expect(tag).toHaveAttribute('data-state', 'stopped');
    expect(tag).toHaveTextContent('arrêté');
    expect(tag).toHaveAttribute('title', 'WSL · opérationnel\nEC2 · arrêté');
    cleanup();
    // The order of the seats does not matter.
    mount([two[1]!, two[0]!, two[2]!], rig({ kernelState: m => (m === 'ec2' ? 'stopped' : 'ready') }));
    expect(document.querySelector('.st-kernel-tag')).toHaveAttribute('data-state', 'stopped');
  });

  it('a kernel machine unreachable: grey « hors ligne », every machine in the tooltip; one not read yet: « Kernel » alone (review)', () => {
    const two = [KERNEL[0]!, { ...KERNEL[1]!, machineId: 'ec2' }, KERNEL[2]!];
    mount(two, rig({ kernelState: m => (m === 'ec2' ? 'offline' : 'ready') }));
    let tag = document.querySelector('.st-kernel-tag')!;
    expect(tag).toHaveAttribute('data-state', 'offline');
    expect(tag).toHaveTextContent('hors ligne');
    expect(tag).toHaveAttribute('title', 'WSL · opérationnel\nEC2 · hors ligne');
    cleanup();
    mount(two, rig({ kernelState: m => (m === 'ec2' ? undefined : 'ready') }));
    expect(document.querySelector('.st-kernel-tag')).toBeNull();
    expect(screen.getByRole('region', { name: 'Kernel' }).querySelector('.st-label')).toHaveTextContent(/^Kernel$/);
  });

  it('the worst state wins: stopped, then starting, then ready; one machine has no tooltip', () => {
    expect(kernelTagOf(['a', 'b'], m => (m === 'a' ? 'ready' : 'starting'))?.tag).toBe('starting');
    expect(kernelTagOf(['a', 'b'], m => (m === 'a' ? 'starting' : 'skipped'))?.tag).toBe('stopped');
    // Not every machine read yet: no tag, never « opérationnel » from part of them (review, lead's rule).
    expect(kernelTagOf(['a', 'b'], m => (m === 'a' ? 'ready' : undefined))).toBeNull();
    expect(kernelTagOf(['a', 'b'], m => (m === 'a' ? 'ready' : 'offline'))).toEqual({ tag: 'offline', per: [['a', 'ready'], ['b', 'offline']] });
    expect(kernelTagOf(['a', 'b'], m => (m === 'a' ? 'offline' : 'stopped'))?.tag).toBe('stopped');
    expect(kernelTagOf(['a', 'b'], m => (m === 'a' ? 'offline' : 'starting'))?.tag).toBe('offline');
    expect(kernelTagOf(['a'], () => undefined)).toBeNull();
    mount(KERNEL, rig());
    expect(document.querySelector('.st-kernel-tag')).not.toHaveAttribute('title');
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

  it('OpenRig stopped elsewhere but not on this computer: no Start button, only the OpenRig page link (review P1)', async () => {
    const start = vi.fn();
    const { dispatch } = mount([], rig({ daemonUp: false, canStart: false, failed: 'not_installed', start }));
    const box = screen.getByRole('status');
    expect(box).toHaveTextContent(/^OpenRig est arrêté\.Ouvrir la page OpenRig$/);
    expect(within(box).queryByRole('button', { name: /Démarrer|Réessayer/ })).toBeNull();
    await userEvent.click(within(box).getByRole('button', { name: 'Ouvrir la page OpenRig' }));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'openrig', section: 'rigs' });
    expect(start).not.toHaveBeenCalled();
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
    emit({ type: 'openrig.state', requestId: asked.find(m => m.machineId === 'local')!.requestId, machineId: 'local', state: state({ daemon: { state: 'stopped' } }) });
    expect(result.current.canStart).toBe(true);
    act(() => result.current.start());
    const startAct = sent.filter(m => m.type === 'openrig.act').at(-1) as { requestId: string };
    expect(startAct).toMatchObject({ type: 'openrig.act', machineId: 'local', action: { kind: 'daemon.start' } });
    expect(result.current.starting).toBe(true);
    emit({ type: 'openrig.done', requestId: startAct.requestId, machineId: 'local', ok: false, commands: ['rig daemon start'], error: 'port in use' });
    expect(result.current).toMatchObject({ starting: false, failed: 'port in use' });
  });
});

function fakeClient() {
  const listeners = new Set<(m: ServerMessage) => void>(), sent: ClientMessage[] = [];
  const client = { send: (m: ClientMessage) => { sent.push(m); }, onMessage: (f: (m: ServerMessage) => void) => { listeners.add(f); return () => { listeners.delete(f); }; } } as unknown as DaemonClient;
  return { client, sent, emit: (m: ServerMessage) => act(() => listeners.forEach(f => f(m))) };
}
const machineOf = (id: string, ready = true) => ({ id, label: id, ready, status: ready ? 'open' : 'closed', recents: [], sessions: [], launcher: null }) as unknown as MachineState;
const st = (o: Partial<OpenRigState> = {}): OpenRigState => ({ installed: true, daemon: { state: 'running' }, kernel: { state: 'ready' }, rigs: [], at: '2026-11-02T09:00:00.000Z', ...o });
const statusAsks = (sent: ClientMessage[]) => sent.filter(m => m.type === 'openrig.status') as Array<{ requestId: string; machineId: string }>;

describe('« Démarrer OpenRig » acts on this computer only (review P1)', () => {
  it('the local machine not ready, a remote one ready with OpenRig stopped: no start, and nothing is sent to the remote', () => {
    const { client, sent, emit } = fakeClient();
    const { result } = renderHook(() => useSidebarOpenRig(client, [machineOf('local', false), machineOf('ec2')]));
    expect(statusAsks(sent).map(m => m.machineId)).toEqual(['ec2']);
    emit({ type: 'openrig.state', requestId: statusAsks(sent)[0]!.requestId, machineId: 'ec2', state: st({ daemon: { state: 'stopped' } }) });
    expect(result.current).toMatchObject({ installed: true, daemonUp: false, canStart: false });
    act(() => result.current.start());
    expect(sent.some(m => m.type === 'openrig.act')).toBe(false);
  });

  it('the local machine ready without OpenRig, a remote one with it: no start either', () => {
    const { client, sent, emit } = fakeClient();
    const { result } = renderHook(() => useSidebarOpenRig(client, [machineOf('local'), machineOf('ec2')]));
    const asks = statusAsks(sent);
    emit({ type: 'openrig.state', requestId: asks.find(m => m.machineId === 'local')!.requestId, machineId: 'local', state: st({ installed: false, daemon: { state: 'unknown' } }) });
    emit({ type: 'openrig.state', requestId: asks.find(m => m.machineId === 'ec2')!.requestId, machineId: 'ec2', state: st({ daemon: { state: 'stopped' } }) });
    expect(result.current).toMatchObject({ installed: true, daemonUp: false, canStart: false });
    act(() => result.current.start());
    expect(sent.some(m => m.type === 'openrig.act')).toBe(false);
  });
});

describe('the kernel state of each machine, as the sidebar reads it (review)', () => {
  it('not answered yet: undefined; answered: its state; disconnected or unanswerable: offline', () => {
    const { client, sent, emit } = fakeClient();
    const { result, rerender } = renderHook(({ ms }) => useSidebarOpenRig(client, ms), { initialProps: { ms: [machineOf('local'), machineOf('ec2')] } });
    expect(result.current.kernelState('ec2')).toBeUndefined();
    const asks = statusAsks(sent);
    emit({ type: 'openrig.state', requestId: asks.find(m => m.machineId === 'ec2')!.requestId, machineId: 'ec2', state: st() });
    expect(result.current.kernelState('ec2')).toBe('ready');
    // The fleet loses EC2: its seats stay listed, offline.
    rerender({ ms: [machineOf('local'), machineOf('ec2', false)] });
    expect(result.current.kernelState('ec2')).toBe('offline');
    // The local machine answers that it cannot (its daemon too old).
    emit({ type: 'openrig.state', requestId: asks.find(m => m.machineId === 'local')!.requestId, machineId: 'local', error: 'outdated' });
    expect(result.current.kernelState('local')).toBe('offline');
  });
});

describe('one read per machine (review P3)', () => {
  it('the OpenRig page and the sidebar on the same machine send one openrig.status, and keep one loop at the page’s pace', () => {
    vi.useFakeTimers();
    try {
      const { client, sent, emit } = fakeClient();
      const side = renderHook(() => useSidebarOpenRig(client, [machineOf('local')]));
      const page = renderHook(() => useOpenRig(client, 'local')); // the page's 5 s
      expect(statusAsks(sent)).toHaveLength(1);
      emit({ type: 'openrig.state', requestId: statusAsks(sent)[0]!.requestId, machineId: 'local', state: st() });
      expect(page.result.current.state?.daemon.state).toBe('running');
      expect(side.result.current.daemonUp).toBe(true);
      act(() => { vi.advanceTimersByTime(5_000); });
      expect(statusAsks(sent)).toHaveLength(2);
      act(() => { vi.advanceTimersByTime(4_999); });
      expect(statusAsks(sent)).toHaveLength(2);
      // The page closes: the sidebar's 15 s alone.
      page.unmount();
      act(() => { vi.advanceTimersByTime(14_000); });
      expect(statusAsks(sent)).toHaveLength(2);
      act(() => { vi.advanceTimersByTime(2_000); });
      expect(statusAsks(sent)).toHaveLength(3);
      side.unmount();
      act(() => { vi.advanceTimersByTime(120_000); });
      expect(statusAsks(sent)).toHaveLength(3);
    } finally { vi.useRealTimers(); }
  });

  it('OpenRig stopped or absent: read every minute, on a window focus, and right after Start', () => {
    vi.useFakeTimers();
    try {
      const { client, sent, emit } = fakeClient();
      const side = renderHook(() => useSidebarOpenRig(client, [machineOf('local')]));
      emit({ type: 'openrig.state', requestId: statusAsks(sent)[0]!.requestId, machineId: 'local', state: st({ daemon: { state: 'stopped' }, kernel: { state: 'stopped' } }) });
      act(() => { vi.advanceTimersByTime(59_000); });
      expect(statusAsks(sent)).toHaveLength(1);
      act(() => { vi.advanceTimersByTime(1_000); });
      expect(statusAsks(sent)).toHaveLength(2);
      act(() => { vi.advanceTimersByTime(3_000); window.dispatchEvent(new Event('focus')); });
      expect(statusAsks(sent)).toHaveLength(3);
      act(() => side.result.current.start());
      const start = sent.at(-1) as { requestId: string };
      expect(sent.at(-1)).toMatchObject({ type: 'openrig.act', machineId: 'local', action: { kind: 'daemon.start' } });
      emit({ type: 'openrig.done', requestId: start.requestId, machineId: 'local', ok: true, commands: ['rig daemon start'] });
      expect(statusAsks(sent)).toHaveLength(4);
      side.unmount();
    } finally { vi.useRealTimers(); }
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
