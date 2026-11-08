import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import type { DaemonClient, MachineState } from '@ledge/fleet';
import type { ClientMessage, OpenRigState, Projects, Rig, RigGraph, RigSeat, RigSeatPermission, RigSnapshot, RigSpec, ServerMessage, Session } from '@ledge/protocol';
import { LangProvider } from '../../src/i18n/lang';
import { RigLaunchModal } from '../../src/ide/launch-rig/RigLaunchModal';
import { Modal } from '../../src/shell/Modal';

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

const spec = (name: string, roles: Array<[string, string]>, source = 'builtin'): RigSpec => ({
  name, source, path: `/specs/${name}.yaml`, edges: 0,
  pods: [...new Set(roles.map(r => r[0]))].map(id => ({ id, members: roles.filter(r => r[0] === id).map(r => ({ id: r[1], runtime: 'claude-code', agent: 'x' })) }))
});
const starter = spec('starter', [['dev', 'builder'], ['review', 'reviewer']]);
const factory = spec('factory', [['orch', 'lead'], ['orch', 'advisor'], ['dev', 'build'], ['dev', 'qa']]);
const reviewTeam = spec('review-team', [['review', 'lead'], ['review', 'r1']], 'user');
const rig = (name: string, status: string, running: number): Rig => ({ id: name, name, status, lifecycleState: status, seats: 2, running, attention: 0, uptime: null, snapshot: null, nodes: [] });
const opSeat: RigSeat = { logicalId: 'operator.agent', session: 'operator-agent@kernel', runtime: 'claude-code', model: null, sessionStatus: 'running', lifecycleState: 'running', activity: 'idle', stopped: false, work: 0 };
const kernel = (): Rig => ({ ...rig('kernel', 'running', 1), nodes: [opSeat] });
const up = (o: Partial<OpenRigState> = {}): OpenRigState => ({
  installed: true, version: '0.7.10', daemon: { state: 'running' }, kernel: { state: 'ready' }, at: '2026-11-08T10:00:00.000Z',
  rigs: [kernel(), rig('ledge-dev', 'running', 2), rig('ledge-survey', 'stopped', 0)], ...o
});
const down = (): OpenRigState => up({ daemon: { state: 'stopped' }, kernel: { state: 'stopped' }, rigs: [] });
const surveyGraph: RigGraph = { pods: [{ id: 'dev', label: 'Dev' }], seats: [{ logicalId: 'dev.builder', pod: 'dev', runtime: 'claude-code', status: 'exited', attention: false }], links: [] };
const surveyPerms: RigSeatPermission[] = [{ logicalId: 'dev.builder', session: 'dev-builder@ledge-survey', policy: 'builtin:auto', policySource: 'member_policy', source: 'member_policy' }];
const surveySnaps: RigSnapshot[] = [{ id: 'snap-1', kind: 'manual', status: 'complete', createdAt: '2026-11-08 14:54:01' }];
const projects: Projects = { projects: [{ id: 'p1', name: 'ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w' }, { machine: 'srv', path: '/srv/w' }] }], rules: [] } as unknown as Projects;

interface Data {
  states: Record<string, OpenRigState>; specs: Record<string, RigSpec[]>;
  launch: { ok: boolean; error?: string }; goal: { ok: boolean; error?: string };
}
function fake(over: Partial<Data> = {}) {
  const data: Data = { states: { local: up(), srv: up({ rigs: [kernel()] }) }, specs: { local: [starter, factory, spec('ledge-survey', [['dev', 'builder']], 'user')], srv: [reviewTeam] }, launch: { ok: true }, goal: { ok: true }, ...over };
  const listeners = new Set<(m: ServerMessage) => void>(), sent: ClientMessage[] = [];
  const held = new Map<string, ServerMessage[]>();
  const emit = (m: ServerMessage) => act(() => listeners.forEach(f => f(m)));
  const reply = (m: ClientMessage): ServerMessage | null => {
    const machineId = (m as { machineId?: string }).machineId ?? 'local';
    const base = { requestId: (m as { requestId: string }).requestId, machineId };
    const st = data.states[machineId]!;
    switch (m.type) {
      case 'openrig.status': return { type: 'openrig.state', ...base, state: st };
      case 'openrig.specs': return { type: 'openrig.specList', ...base, specs: st.daemon.state === 'running' ? data.specs[machineId] ?? [] : [], ...(st.daemon.state === 'running' ? {} : { error: 'daemon_stopped' }) } as ServerMessage;
      case 'openrig.graph': return { type: 'openrig.graphState', ...base, rig: m.rig, graph: surveyGraph };
      case 'openrig.permissions': return { type: 'openrig.permissionList', ...base, rig: m.rig, seats: surveyPerms } as ServerMessage;
      case 'openrig.snapshots': return { type: 'openrig.snapshotList', ...base, rig: m.rig, snapshots: surveySnaps };
      case 'openrig.launch': return { type: 'openrig.launched', ...base, ok: data.launch.ok, plan: m.launch.plan === true, commands: ['rig up starter --cwd /w --plan'], seats: 2, ...(m.launch.plan ? { yaml: 'name: starter\n' } : {}), ...(data.launch.error ? { error: data.launch.error } : {}) } as ServerMessage;
      case 'openrig.goals': return { type: 'openrig.goalsChanged', ...base, goals: [] } as ServerMessage;
      case 'openrig.goal.send': return { type: 'openrig.goal.sent', ...base, goalId: m.goalId, ok: data.goal.ok, ...(data.goal.error ? { error: data.goal.error } : {}) } as ServerMessage;
      default: return null;
    }
  };
  const client = {
    send: (m: ClientMessage) => {
      sent.push(m);
      const r = reply(m);
      if (!r) return;
      const machineId = (m as { machineId?: string }).machineId ?? 'local';
      if (m.type === 'openrig.specs' && held.has(machineId)) { held.get(machineId)!.push(r); return; }
      queueMicrotask(() => emit(r));
    },
    onMessage: (f: (m: ServerMessage) => void) => { listeners.add(f); return () => { listeners.delete(f); }; },
    onStatus: () => () => {}, status: () => 'open'
  } as unknown as DaemonClient;
  const acts = () => sent.filter(m => m.type === 'openrig.act') as Array<{ requestId: string; action: Record<string, unknown>; machineId: string }>;
  const done = (ok = true, error?: string) => emit({ type: 'openrig.done', requestId: acts().at(-1)!.requestId, machineId: 'local', ok, commands: [], ...(error ? { error } : {}) } as ServerMessage);
  return {
    data, client, sent, acts, done, emit,
    hold: (machine: string) => held.set(machine, []),
    release: async (machine: string) => { const rs = held.get(machine) ?? []; held.delete(machine); for (const r of rs) await emit(r); },
    setState: (machine: string, s: OpenRigState) => { data.states[machine] = s; return emit({ type: 'openrig.state', machineId: machine, state: s }); }
  };
}
const machine = (id: string, label: string): MachineState => ({ id, label, ready: true, status: 'open', recents: [], sessions: [], launcher: null, daemon: { version: '0.60.0', install: 'npm', systemd: true, openrigPolicy: true, openrigFresh: true } }) as unknown as MachineState;
const MACHINES = [machine('local', 'WSL'), machine('srv', 'srv-build')];
const operator = (): Session => fakeSession('op1', { name: 'Op', state: 'waiting_input', machineId: 'local', rig: { seat: 'operator-agent@kernel', name: 'kernel' } });

function mount(over: Partial<Data> = {}, o: { sessions?: Session[] } = {}) {
  const f = fake(over);
  const onLaunched = vi.fn(), onOperator = vi.fn(), onClose = vi.fn();
  render(<LangProvider lang="fr"><RigLaunchModal client={f.client} machines={MACHINES} machine="local" projects={projects} sessions={o.sessions ?? []} onLaunched={onLaunched} onOperator={onOperator} onClose={onClose} /></LangProvider>);
  return { f, onLaunched, onOperator, onClose };
}
const card = (name: RegExp) => screen.getByRole('button', { name });
const launchButton = () => screen.getByRole('button', { name: /^Lancer/ });
const pickStarter = async () => { await userEvent.click(await screen.findByRole('button', { name: /^starter/ })); await screen.findByRole('textbox', { name: 'Nom' }); };

describe('the « Lancer un rig » modal', () => {
  it('says where it launches and how; lists the cards of « Partir de » in R1 order, a running rig greyed', async () => {
    mount();
    expect(screen.getByText('Sur WSL. Ctrl+Entrée lance, Échap ferme.')).toBeInTheDocument();
    await screen.findByRole('button', { name: /^starter/ });
    const cards = within(screen.getByRole('group', { name: 'Partir de' })).getAllByRole('button');
    expect(cards.map(c => c.querySelector('.an')!.textContent)).toEqual(['ledge-dev', 'ledge-survey', 'starter', 'factory', 'Rig vide', 'Composer avec l’operator']);
    expect(card(/^ledge-dev/)).toBeDisabled();
    expect(card(/^ledge-dev/)).toHaveTextContent('Déjà en marche · gère-le dans sa vue Rig');
    expect(card(/^starter/)).toHaveTextContent('Spec enregistrée · 2 sièges · intégrée');
    expect(card(/^Rig vide/)).toHaveTextContent('Un lead, un siège d’implémentation, à compléter');
    expect(card(/^Composer avec/)).toHaveTextContent('Décris le besoin, il propose l’équipe');
    // The first active card is chosen at once: the stopped rig.
    expect(card(/^ledge-survey/)).toHaveAttribute('aria-pressed', 'true');
  });

  it('a spec shows name, machine, folder, seats, permissions and the command, which follows the seats live', async () => {
    mount();
    await pickStarter();
    expect(screen.getByRole('textbox', { name: 'Nom' })).toHaveValue('starter');
    expect(screen.getByRole('radio', { name: 'WSL' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('combobox', { name: 'Dossier' })).toHaveValue('/w');
    expect(screen.getByText('Sièges')).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Permissions' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Spec' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('rig up starter --cwd /w --yes')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Un siège de plus pour dev.builder' }));
    expect(screen.getByText('rig up ~/.ledge/rigs/starter/rig.yaml --cwd /w --yes')).toBeInTheDocument();
  });

  it('the empty rig is factory with a lead and a builder, the other roles at 0 to fill in', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /^Rig vide/ }));
    expect(await screen.findByRole('textbox', { name: 'Nom' })).toHaveValue('nouveau-rig');
    expect(screen.getByText('rig up ~/.ledge/rigs/nouveau-rig/rig.yaml --cwd /w --yes')).toBeInTheDocument();
    expect(screen.getAllByText('à compléter')).toHaveLength(2);
  });

  it('« Plus d’options » is closed; open, it shows harness, model and permission per role, « garder la spec » and « Vérifier »', async () => {
    const m = mount();
    await pickStarter();
    expect(screen.queryByRole('combobox', { name: 'Harnais · dev.builder' })).toBeNull();
    await userEvent.click(screen.getByText('Plus d’options'));
    expect(screen.getByRole('combobox', { name: 'Harnais · dev.builder' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Modèle · dev.builder' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Permissions · dev.builder' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Enregistrer dans mes specs sous « starter »' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Vérifier' }));
    expect(await screen.findByText('Le plan passe : 2 sièges.')).toBeInTheDocument();
    expect(screen.getByText('name: starter')).toBeInTheDocument();
    expect(m.f.sent.find(x => x.type === 'openrig.launch')).toMatchObject({ machineId: 'local', launch: { spec: 'starter', plan: true } });
  });

  it('Ctrl+Enter in the folder field launches on the chosen machine; success hands the rig over', async () => {
    const m = mount();
    await pickStarter();
    await userEvent.click(screen.getByRole('combobox', { name: 'Dossier' }));
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(m.onLaunched).toHaveBeenCalledWith('local', 'starter'));
    expect(m.f.sent.find(x => x.type === 'openrig.launch')).toMatchObject({ machineId: 'local', launch: { spec: 'starter', cwd: '/w', name: 'starter' } });
    expect((m.f.sent.find(x => x.type === 'openrig.launch') as { launch: object }).launch).not.toHaveProperty('plan');
  });

  it('a failed launch stays open with its error', async () => {
    const m = mount({ launch: { ok: false, error: 'cwd_missing' } });
    await pickStarter();
    await userEvent.click(launchButton());
    expect(await screen.findByText('Ce dossier n’existe pas sur cette machine.')).toBeInTheDocument();
    expect(m.onLaunched).not.toHaveBeenCalled();
  });

  it('a name already taken disables « Lancer » and says so (Review Focus 2)', async () => {
    mount();
    await pickStarter();
    const name = screen.getByRole('textbox', { name: 'Nom' });
    await userEvent.clear(name);
    await userEvent.type(name, 'ledge-dev');
    expect(launchButton()).toBeDisabled();
    expect(screen.getByText('Un rig de ce nom existe déjà sur WSL.')).toBeInTheDocument();
  });

  it('Ctrl+Enter works from the Modal box itself, where the focus lands at opening', async () => {
    const f = fake();
    render(<LangProvider lang="fr"><Modal title="Lancer un rig" onClose={() => {}}><RigLaunchModal client={f.client} machines={MACHINES} machine="local" projects={projects} sessions={[]} onLaunched={() => {}} onOperator={() => {}} onClose={() => {}} /></Modal></LangProvider>);
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /^Reprendre le dernier snapshot/ })).toBeChecked());
    screen.getByRole('dialog').focus();
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(f.acts().at(-1)!.action).toEqual({ kind: 'rig.start', rig: 'ledge-survey' });
  });

  it('a stopped rig relaunches: resume ticked; unticked, its seats start fresh', async () => {
    const m = mount();
    const resume = await screen.findByRole('checkbox', { name: /^Reprendre le dernier snapshot \(\d.+\)$/ });
    await waitFor(() => expect(resume).toBeChecked());
    expect(screen.getByText('ledge-survey', { selector: '.ide-rl-fixed b' })).toBeInTheDocument();
    expect(await screen.findByText('rig up ledge-survey --existing --yes')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(resume);
    expect(screen.getByText('rig up ledge-survey --existing --fresh dev.builder --yes')).toBeInTheDocument();
    await userEvent.click(launchButton());
    expect(m.f.acts().at(-1)!.action).toEqual({ kind: 'rig.start', rig: 'ledge-survey', fresh: ['dev.builder'] });
    await m.f.done(true);
    await waitFor(() => expect(m.onLaunched).toHaveBeenCalledWith('local', 'ledge-survey'));
  });

  it('a relaunch at another level sets the policy first, then starts', async () => {
    const m = mount();
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /^Reprendre le dernier snapshot/ })).toBeChecked());
    await userEvent.click(screen.getByRole('radio', { name: 'Standard' }));
    expect(screen.getByText(/^rig seat set-permissions dev\.builder@ledge-survey .* && rig up ledge-survey --existing --yes$/)).toBeInTheDocument();
    await userEvent.click(launchButton());
    expect(m.f.acts().at(-1)!.action).toMatchObject({ kind: 'rig.policy', rig: 'ledge-survey', policy: 'standard', seats: ['dev.builder@ledge-survey'] });
    await m.f.done(true);
    await waitFor(() => expect(m.f.acts().at(-1)!.action).toEqual({ kind: 'rig.start', rig: 'ledge-survey' }));
  });

  it('another machine reads its own specs and starts again from its cards (Review Focus 1)', async () => {
    const m = mount();
    await pickStarter();
    m.f.hold('srv');
    await userEvent.click(screen.getByRole('radio', { name: 'srv-build' }));
    await waitFor(() => expect(m.f.sent.some(x => x.type === 'openrig.specs' && (x as { machineId?: string }).machineId === 'srv')).toBe(true));
    // While srv's specs are read, nothing of WSL's is left to launch.
    expect(screen.queryByRole('button', { name: /^starter/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Lancer/ })).toBeNull();
    expect(screen.getByText('Sur srv-build. Ctrl+Entrée lance, Échap ferme.')).toBeInTheDocument();
    await m.f.release('srv');
    expect(await screen.findByRole('button', { name: /^review-team/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('combobox', { name: 'Dossier' })).toHaveValue('/srv/w');
    await userEvent.click(launchButton());
    await waitFor(() => expect(m.f.sent.find(x => x.type === 'openrig.launch')).toMatchObject({ machineId: 'srv', launch: { spec: 'review-team', cwd: '/srv/w', name: 'review-team' } }));
  });

  it('a stopped daemon: the notice, its command and « Démarrer OpenRig », which sends the preferred start; the cards come once it runs', async () => {
    const m = mount({ states: { local: down(), srv: up() } });
    expect(await screen.findByText('Le daemon OpenRig est arrêté sur WSL.')).toBeInTheDocument();
    expect(screen.getByText('rig start --last')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Démarrer OpenRig' }));
    expect(m.f.acts().at(-1)!.action).toEqual({ kind: 'daemon.start', restore: 'last' });
    await m.f.done(true);
    await m.f.setState('local', up());
    expect(await screen.findByRole('button', { name: /^starter/ })).toBeInTheDocument();
  });

  it('the daemon stopping while open turns the mode into the notice, with no launch left (Review Focus 3)', async () => {
    const m = mount();
    await pickStarter();
    await m.f.setState('local', down());
    expect(await screen.findByText('Le daemon OpenRig est arrêté sur WSL.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Lancer/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^starter/ })).toBeNull();
  });

  it('a stopped kernel greys the operator; a ready one takes the request and sends it as a goal', async () => {
    const m = mount({ states: { local: up({ kernel: { state: 'stopped' } }), srv: up() } }, { sessions: [operator()] });
    expect(await screen.findByRole('button', { name: /^Composer avec/ })).toBeDisabled();
    expect(card(/^Composer avec/)).toHaveTextContent('Le kernel doit tourner');
    await m.f.setState('local', up());
    await waitFor(() => expect(card(/^Composer avec/)).toBeEnabled());
    await userEvent.click(card(/^Composer avec/));
    const field = screen.getByRole('textbox', { name: 'Ce que tu veux' });
    expect(field).toHaveAttribute('placeholder', 'Ex. : une équipe pour relire la MR !412 de synapse, un lead et deux relecteurs.');
    await userEvent.type(field, 'une équipe de relecture');
    await userEvent.click(screen.getByRole('button', { name: /^Demander à l’operator/ }));
    await waitFor(() => expect(m.onOperator).toHaveBeenCalledWith('op1'));
    expect(m.f.sent.find(x => x.type === 'openrig.goal.send')).toMatchObject({ machineId: 'local', text: 'une équipe de relecture' });
  });

  it('a refused goal stays in the modal', async () => {
    const m = mount({ goal: { ok: false, error: 'no_operator' } });
    await userEvent.click(await screen.findByRole('button', { name: /^Composer avec/ }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Ce que tu veux' }), 'x');
    await userEvent.click(screen.getByRole('button', { name: /^Demander à l’operator/ }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(m.onOperator).not.toHaveBeenCalled();
  });
});
