import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { DaemonClient, MachineState } from '@ledge/fleet';
import type { ClientMessage, OpenRigState, Rig, RigGraph, RigRow, RigSeat, RigSeatPermission, RigSnapshot, ServerMessage, Session } from '@ledge/protocol';
import { LangProvider } from '../../src/i18n/lang';
import { RigView } from '../../src/ide/rig/RigView';

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

const seat = (logicalId: string, rig: string, o: Partial<RigSeat> = {}): RigSeat => ({ logicalId, session: `${logicalId.replace('.', '-')}@${rig}`, runtime: 'claude-code', model: null, sessionStatus: 'running', lifecycleState: 'running', activity: 'idle', stopped: false, work: 0, ...o });
const rig = (name: string, status: string, nodes: RigSeat[]): Rig => ({ id: name, name, status, lifecycleState: status, seats: nodes.length || 2, running: status === 'running' ? nodes.length : 0, attention: 0, uptime: null, snapshot: null, nodes, ...(name === 'ledge-dev' ? { specPath: '/home/gch/.openrig/rigs/ledge-dev.yaml' } : {}) });
const DEV = [seat('dev.build', 'ledge-dev', { activity: 'running' }), seat('dev.review', 'ledge-dev')];
const state = (o: Partial<OpenRigState> = {}): OpenRigState => ({
  installed: true, version: '0.7.10', daemon: { state: 'running' }, kernel: { state: 'ready' }, at: '2026-11-08T10:00:00.000Z',
  rigs: [rig('kernel', 'running', [seat('operator.agent', 'kernel')]), rig('ledge-dev', 'running', DEV), rig('synapse', 'stopped', [])], ...o
});
const graphOf = (name: string, ids: string[]): RigGraph => ({
  pods: [{ id: 'dev', label: 'Project' }],
  seats: ids.map(id => ({ logicalId: id, pod: 'dev', runtime: 'claude-code', status: 'running', session: `${id.replace('.', '-')}@${name}`, attention: false })),
  links: ids.length > 1 ? [{ from: ids[0]!, to: ids[1]!, kind: 'delegates_to' }] : []
});
const perm = (id: string, policy: string | undefined, source = 'member_policy'): RigSeatPermission => ({ logicalId: id, session: `${id.replace('.', '-')}@ledge-dev`, source, policySource: source, summary: `Next launch: ${id} ${policy ?? ''}`, ...(policy ? { policy } : {}) });
const NOW = new Date().toISOString();
const rowOf = (id: string, o: Partial<RigRow> = {}): RigRow => ({ id, state: 'pending', summary: 'Run the build', from: 'operator-human@kernel', to: 'dev-build@ledge-dev', createdAt: NOW, updatedAt: NOW, at: NOW, ...o });

interface Data { state: OpenRigState; graph: RigGraph; policy?: string; perms: RigSeatPermission[]; snaps: RigSnapshot[]; rows: RigRow[]; truncated: boolean; seatsResult: { ok: boolean; error?: string }; permError?: string }
function fake(over: Partial<Data> = {}) {
  const data: Data = { state: state(), graph: graphOf('ledge-dev', ['dev.build', 'dev.review']), policy: 'builtin:auto', perms: [perm('dev.build', undefined, 'rig_policy'), perm('dev.review', undefined, 'rig_policy')], snaps: [], rows: [], truncated: false, seatsResult: { ok: true }, ...over };
  const listeners = new Set<(m: ServerMessage) => void>(), sent: ClientMessage[] = [];
  const emit = (m: ServerMessage) => act(() => listeners.forEach(f => f(m)));
  const reply = (m: ClientMessage): ServerMessage | null => {
    const base = { requestId: (m as { requestId: string }).requestId, machineId: 'local' };
    switch (m.type) {
      case 'openrig.status': return { type: 'openrig.state', ...base, state: data.state };
      case 'openrig.graph': return { type: 'openrig.graphState', ...base, rig: m.rig, graph: data.graph };
      case 'openrig.permissions': return { type: 'openrig.permissionList', ...base, rig: m.rig, ...(data.policy ? { policy: data.policy } : {}), seats: data.perms, ...(data.permError ? { error: data.permError } : {}) } as ServerMessage;
      case 'openrig.snapshots': return { type: 'openrig.snapshotList', ...base, rig: m.rig, snapshots: data.snaps };
      case 'openrig.queue': return { type: 'openrig.queueState', ...base, rig: m.rig, rows: data.rows, truncated: data.truncated } as ServerMessage;
      case 'openrig.seats': return { type: 'openrig.reseated', ...base, ok: data.seatsResult.ok, commands: [], added: [], removed: [], ...(data.seatsResult.error ? { error: data.seatsResult.error } : {}) } as ServerMessage;
      default: return null;
    }
  };
  const client = {
    send: (m: ClientMessage) => { sent.push(m); const r = reply(m); if (r) queueMicrotask(() => emit(r)); },
    onMessage: (f: (m: ServerMessage) => void) => { listeners.add(f); return () => { listeners.delete(f); }; }
  } as unknown as DaemonClient;
  const count = (type: string) => sent.filter(m => m.type === type).length;
  const acts = () => sent.filter(m => m.type === 'openrig.act') as Array<{ requestId: string; action: Record<string, unknown> }>;
  const done = (ok = true, error?: string) => emit({ type: 'openrig.done', requestId: acts().at(-1)!.requestId, machineId: 'local', ok, commands: [], ...(error ? { error } : {}) } as ServerMessage);
  return { data, client, sent, emit, count, acts, done, setState: (s: OpenRigState) => { data.state = s; return emit({ type: 'openrig.state', machineId: 'local', state: s }); } };
}
const local = (daemon: Record<string, unknown> = { openrigPolicy: true }): MachineState => ({ id: 'local', label: 'Local', ready: true, status: 'open', recents: [], sessions: [], launcher: null, daemon: { version: '0.60.0', install: 'npm', systemd: true, ...daemon } }) as unknown as MachineState;
const bix = (): Session => fakeSession('b1', { name: 'Bix', state: 'working', machineId: 'local', rig: { seat: 'dev-build@ledge-dev', name: 'ledge-dev' } });
const operator = (): Session => fakeSession('op1', { name: 'Op', state: 'waiting_input', machineId: 'local', rig: { seat: 'operator-agent@kernel', name: 'kernel' } });

function mount(over: Partial<Data> = {}, o: { rigName?: string; machines?: MachineState[]; sessions?: Session[] } = {}) {
  const f = fake(over), dispatch = vi.fn();
  const ui = () => <LangProvider lang="fr"><RigView client={f.client} machines={o.machines ?? [local()]} sessions={o.sessions ?? []} machine="local" rig={o.rigName ?? 'ledge-dev'} dispatch={dispatch} /></LangProvider>;
  const r = render(ui());
  return { f, dispatch, ...r };
}
const ready = async (m: ReturnType<typeof mount>) => { await screen.findByRole('heading', { level: 3 }); await waitFor(() => expect(m.f.count('openrig.queue')).toBeGreaterThan(0)); await screen.findByText('Réglages'); return m; };

describe('the Rig tab', () => {
  it('shows the header of a running rig; Stop confirms under it and sends rig.stop', async () => {
    const m = mount();
    expect(await screen.findByRole('heading', { level: 3, name: 'ledge-dev' })).toBeInTheDocument();
    expect(screen.getByText('en marche')).toBeInTheDocument();
    expect(screen.getByText('2 sièges · Local')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Redémarrer' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Arrêter' }));
    const box = screen.getByRole('group', { name: /Arrêter le rig « ledge-dev »/ });
    expect(box).toHaveTextContent('rig down ledge-dev');
    expect(box.closest('.ide-rig-head, .ide-rig')).not.toBeNull();
    await userEvent.click(within(box).getByRole('button', { name: 'Confirmer l’arrêt' }));
    expect(m.f.acts().at(-1)!.action).toMatchObject({ kind: 'rig.stop', rig: 'ledge-dev' });
  });

  it('a permission level sends rig.policy for every seat, then reads the permissions again; Spec sends spec', async () => {
    const m = await ready(mount());
    const before = m.f.count('openrig.permissions');
    await userEvent.click(screen.getByRole('radio', { name: 'Standard' }));
    expect(m.f.acts().at(-1)!.action).toEqual({ kind: 'rig.policy', rig: 'ledge-dev', policy: 'standard', seats: ['dev-build@ledge-dev', 'dev-review@ledge-dev'] });
    await m.f.done();
    await waitFor(() => expect(m.f.count('openrig.permissions')).toBe(before + 1));
    await userEvent.click(screen.getByRole('radio', { name: 'Spec' }));
    expect(m.f.acts().at(-1)!.action).toMatchObject({ kind: 'rig.policy', policy: 'spec' });
  });
  it('shows the current level, the spec policy and the next-launch line', async () => {
    await ready(mount({ perms: [perm('dev.build', 'builtin:yolo'), perm('dev.review', 'builtin:yolo')] }));
    expect(screen.getByRole('radio', { name: 'YOLO' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Spec : builtin:auto')).toBeInTheDocument();
    expect(screen.getByText(/au prochain lancement/)).toBeInTheDocument();
  });
  it('Spec is disabled when the spec policy is unknown; the whole segment when the daemon is outdated', async () => {
    const m = await ready(mount({}, {}));
    expect(screen.getByRole('radio', { name: 'Spec' })).toBeEnabled();
    m.unmount();
    const m2 = await ready(mount({ policy: undefined }));
    expect(screen.getByRole('radio', { name: 'Spec' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Standard' })).toBeEnabled();
    m2.unmount();
    await ready(mount({}, { machines: [local({})] }));
    expect(screen.getByRole('radio', { name: 'Standard' })).toBeDisabled();
    expect(screen.getByText(/trop ancien/)).toBeInTheDocument();
  });
  it('mixed seats show « Mixte » with each seat’s summary and no active level', async () => {
    await ready(mount({ perms: [perm('dev.build', 'builtin:yolo'), perm('dev.review', 'builtin:standard')] }));
    expect(screen.getByText('Mixte')).toBeInTheDocument();
    expect(screen.getByText(/Next launch: dev.build builtin:yolo/)).toBeInTheDocument();
    expect(screen.getAllByRole('radio').filter(r => r.getAttribute('aria-checked') === 'true')).toHaveLength(0);
  });
  it('a permissions error shows its text, never the raw code', async () => {
    await ready(mount({ permError: 'unknown_rig' }));
    expect(await screen.findByText('Ce rig n’existe plus sur cette machine.')).toBeInTheDocument();
    expect(screen.queryByText(/unknown_rig/)).toBeNull();
  });
  it('a daemon refusal shows under the segment', async () => {
    const m = await ready(mount());
    await userEvent.click(screen.getByRole('radio', { name: 'Spec' }));
    await m.f.done(false, 'spec_no_policy');
    expect(await screen.findByRole('alert')).toHaveTextContent('La spec de ce rig ne donne aucune politique');
  });

  it('+ on a role shows Apply and the plan; Apply sends openrig.seats and reads again; − stops at 1', async () => {
    const m = await ready(mount());
    expect(screen.getByRole('button', { name: 'Un siège de moins pour dev.review' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Appliquer' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Un siège de plus pour dev.build' }));
    expect(screen.getByText(/Ajoute build-2/)).toBeInTheDocument();
    const before = m.f.count('openrig.graph');
    await userEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
    expect(m.f.sent.find(x => x.type === 'openrig.seats')).toMatchObject({ rig: 'ledge-dev', seats: { 'dev.build': 2, 'dev.review': 1 } });
    await waitFor(() => expect(m.f.count('openrig.graph')).toBeGreaterThan(before));
  });
  it('removing a working seat flags it in the plan', async () => {
    const f = fake({ state: state({ rigs: [rig('ledge-dev', 'running', [seat('dev.build', 'ledge-dev'), seat('dev.build-2', 'ledge-dev', { activity: 'running' }), seat('dev.review', 'ledge-dev')])] }) });
    render(<LangProvider lang="fr"><RigView client={f.client} machines={[local()]} sessions={[]} machine="local" rig="ledge-dev" dispatch={vi.fn()} /></LangProvider>);
    await userEvent.click(await screen.findByRole('button', { name: 'Un siège de moins pour dev.build' }));
    expect(screen.getByText(/Retire dev.build-2/)).toBeInTheDocument();
    expect(screen.getByText(/dev.build-2 travaille/)).toBeInTheDocument();
  });
  it('a seat count that changes elsewhere resets the draft to the real state', async () => {
    const m = await ready(mount());
    await userEvent.click(screen.getByRole('button', { name: 'Un siège de plus pour dev.review' }));
    expect(screen.getByRole('button', { name: 'Appliquer' })).toBeInTheDocument();
    await m.f.setState(state({ rigs: [rig('ledge-dev', 'running', [seat('dev.build', 'ledge-dev'), seat('dev.build-2', 'ledge-dev'), seat('dev.build-3', 'ledge-dev'), seat('dev.review', 'ledge-dev')])] }));
    expect(screen.queryByRole('button', { name: 'Appliquer' })).toBeNull();
    const row = screen.getByText('dev.build', { selector: '.ide-rig-role *, .ide-rig-role' }).closest('.ide-rig-role') as HTMLElement;
    expect(within(row).getByText('3')).toBeInTheDocument();
  });

  it('Snapshot now sends rig.snapshot and reads the list again; the last snapshot is in local time', async () => {
    const iso = '2026-11-08T14:52:23.000Z';
    const m = await ready(mount({ snaps: [{ id: 's1', kind: 'manual', status: 'complete', createdAt: iso }] }));
    expect(screen.getByText(new Date(iso).toLocaleString('fr', { dateStyle: 'short', timeStyle: 'short' }))).toBeInTheDocument();
    const before = m.f.count('openrig.snapshots');
    await userEvent.click(screen.getByRole('button', { name: 'Snapshot maintenant' }));
    expect(m.f.acts().at(-1)!.action).toEqual({ kind: 'rig.snapshot', rig: 'ledge-dev' });
    await m.f.done();
    await waitFor(() => expect(m.f.count('openrig.snapshots')).toBe(before + 1));
  });
  it('without a snapshot, says so', async () => {
    await ready(mount());
    expect(screen.getByText('Aucun snapshot')).toBeInTheDocument();
  });

  it('the queue shows a « ! » on a row that needs input, the Ledge names, the age; no row, no section', async () => {
    const m = await ready(mount({ rows: [rowOf('qitem-1', { needsInput: { count: 1, reason: null } })], truncated: true }, { sessions: [bix()] }));
    const q = await screen.findByRole('region', { name: 'File OpenRig' });
    expect(q).toHaveTextContent('!');
    expect(q).toHaveTextContent('Run the build');
    expect(q).toHaveTextContent('operator-human@kernel → Bix');
    expect(q).toHaveTextContent('< 1 min');
    expect(q).toHaveTextContent('Les plus anciennes ne sont pas montrées');
    m.unmount();
    await ready(mount());
    expect(screen.queryByRole('region', { name: 'File OpenRig' })).toBeNull();
  });

  it('a stopped rig has no ± nor Snapshot now, and offers Start', async () => {
    const m = mount({ state: state({ rigs: [rig('synapse', 'stopped', [])] }), graph: graphOf('synapse', ['dev.build']) }, { rigName: 'synapse' });
    expect(await screen.findByText('arrêté')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Démarrer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Snapshot maintenant' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Un siège de/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Démarrer' }));
    expect(m.f.acts().at(-1)!.action).toMatchObject({ kind: 'rig.start', rig: 'synapse' });
  });
  it('a rig that stops while its confirmation is open closes it and drops the controls', async () => {
    const m = await ready(mount());
    await userEvent.click(screen.getByRole('button', { name: 'Arrêter' }));
    expect(screen.getByRole('group', { name: /Arrêter le rig/ })).toBeInTheDocument();
    await m.f.setState(state({ rigs: [rig('ledge-dev', 'stopped', [])] }));
    expect(screen.queryByRole('group', { name: /Arrêter le rig/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Snapshot maintenant' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Démarrer' })).toBeInTheDocument();
  });

  it('the kernel: a « Rôle » block, no settings, and Talk to the operator opens the operator’s session', async () => {
    const m = mount({ graph: graphOf('kernel', ['operator.agent']) }, { rigName: 'kernel', sessions: [operator()] });
    expect(await screen.findByText('Rôle')).toBeInTheDocument();
    expect(screen.queryByText('Réglages')).toBeNull();
    expect(m.f.count('openrig.permissions')).toBe(0);
    await userEvent.click(screen.getByRole('button', { name: 'Parler à l’operator' }));
    expect(m.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'open', id: 'op1' }));
  });
  it('Talk to the operator is disabled while Ledge does not follow that session', async () => {
    mount({ graph: graphOf('kernel', ['operator.agent']) }, { rigName: 'kernel' });
    expect(await screen.findByRole('button', { name: 'Parler à l’operator' })).toBeDisabled();
  });

  it('a rig that is not on the machine says so, with no action', async () => {
    mount({}, { rigName: 'gone' });
    expect(await screen.findByText(/n’existe plus sur cette machine/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('a stopped OpenRig daemon says so (not that the rig is gone) and offers « Démarrer OpenRig », which sends daemon.start', async () => {
    const m = mount({ state: state({ daemon: { state: 'stopped' }, rigs: [] }) });
    expect(await screen.findByText('Le daemon OpenRig est arrêté.')).toBeInTheDocument();
    expect(screen.queryByText(/n’existe plus sur cette machine/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Démarrer OpenRig' }));
    expect(m.f.acts().at(-1)!.action).toEqual({ kind: 'daemon.start' });
  });
  it('the kernel tab of a stopped daemon says the same', async () => {
    mount({ state: state({ daemon: { state: 'stopped' }, rigs: [] }) }, { rigName: 'kernel' });
    expect(await screen.findByText('Le daemon OpenRig est arrêté.')).toBeInTheDocument();
  });
  it('an offline machine says so', async () => {
    const f = fake();
    render(<LangProvider lang="fr"><RigView client={f.client} machines={[{ ...local(), ready: false }]} sessions={[]} machine="local" rig="ledge-dev" dispatch={vi.fn()} /></LangProvider>);
    expect(await screen.findByText('Cette machine est hors ligne.')).toBeInTheDocument();
  });

  it('a failed Snapshot now shows its failure under the snapshot row', async () => {
    const m = await ready(mount());
    await userEvent.click(screen.getByRole('button', { name: 'Snapshot maintenant' }));
    await m.f.done(false, 'busy');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Une autre action OpenRig est en cours');
    expect(alert.previousElementSibling).toHaveTextContent('Snapshot maintenant');
  });
  it('OpenRig’s zone-less snapshot date is UTC, shown in local time', async () => {
    await ready(mount({ snaps: [{ id: 's1', kind: 'manual', status: 'complete', createdAt: '2026-11-08 14:54:01' }] }));
    expect(screen.getByText(new Date('2026-11-08T14:54:01Z').toLocaleString('fr', { dateStyle: 'short', timeStyle: 'short' }))).toBeInTheDocument();
  });
  it('a running rig without known seats has its whole permission segment disabled and sends nothing', async () => {
    const m = await ready(mount({ state: state({ rigs: [rig('ledge-dev', 'running', [])] }) }));
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(6);
    for (const r of radios) expect(r).toBeDisabled();
    expect(radios[2]).toHaveAttribute('title', 'Aucun siège connu : rien à régler pour l’instant.');
    await userEvent.click(radios[2]!);
    expect(m.f.acts()).toHaveLength(0);
  });
  it('a draft is dropped when the seats change, and does not come back when they return', async () => {
    const m = await ready(mount());
    const a = state(), b = state({ rigs: [rig('ledge-dev', 'running', [seat('dev.build', 'ledge-dev'), seat('dev.build-2', 'ledge-dev'), seat('dev.review', 'ledge-dev')])] });
    await userEvent.click(screen.getByRole('button', { name: 'Un siège de plus pour dev.review' }));
    await m.f.setState(b);
    await m.f.setState(a);
    expect(screen.queryByRole('button', { name: 'Appliquer' })).toBeNull();
  });
  it('reads the graph, permissions and snapshots once on mount, again only when the rig’s state changes', async () => {
    const m = await ready(mount());
    const n = () => [m.f.count('openrig.graph'), m.f.count('openrig.permissions'), m.f.count('openrig.snapshots')];
    expect(n()).toEqual([1, 1, 1]);
    await m.f.setState(state({ at: '2026-11-08T10:00:05.000Z' }));
    expect(n()).toEqual([1, 1, 1]);
    await m.f.setState(state({ rigs: [rig('ledge-dev', 'stopped', [])] }));
    await waitFor(() => expect(n()).toEqual([2, 2, 2]));
  });
});
