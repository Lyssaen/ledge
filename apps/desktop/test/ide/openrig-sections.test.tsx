import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DaemonClient, MachineState } from '@ledge/fleet';
import type { ClientMessage, HumanAsk, OpenRigState, Rig, RigSeat, RigSeatPermission, ServerMessage, Session } from '@ledge/protocol';
import { LangProvider } from '../../src/i18n/lang';
import { OpenRigView } from '../../src/ide/openrig/OpenRigView';
import { loadDaemonPrefs } from '../../src/ide/openrig/prefs';
import { loadRigsMachine } from '../../src/workspace/prefs';
import type { OpenRigSection } from '../../src/nav/state';
import type { RigOutputEntry } from '../../src/openrig/rigOutput';
import { ROLES } from '../openrig-roles-fixture';

// The six sections of the IDE's OpenRig page (lot 7d Task 5, docs/mockups/ledge-ide-rigs.html `orPageB`, rulings R12–R17).

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

function fake() {
  const listeners = new Set<(m: ServerMessage) => void>(), sent: ClientMessage[] = [];
  const client = { send: (m: ClientMessage) => { sent.push(m); }, onMessage: (f: (m: ServerMessage) => void) => { listeners.add(f); return () => { listeners.delete(f); }; } } as unknown as DaemonClient;
  const emit = (m: ServerMessage) => act(() => listeners.forEach(f => f(m)));
  const last = <T extends ClientMessage['type']>(type: T, ok: (m: Extract<ClientMessage, { type: T }>) => boolean = () => true) =>
    [...sent].reverse().find(m => m.type === type && ok(m as Extract<ClientMessage, { type: T }>)) as Extract<ClientMessage, { type: T }> | undefined;
  return {
    client, sent, emit,
    state: (machineId: string, state: OpenRigState) => emit({ type: 'openrig.state', requestId: last('openrig.status', m => m.machineId === machineId)!.requestId, machineId, state }),
    roles: () => emit({ type: 'openrig.roleList', requestId: last('openrig.roles')!.requestId, roles: ROLES } as ServerMessage),
    permissions: (rig: string, seats: RigSeatPermission[]) => emit({ type: 'openrig.permissionList', requestId: last('openrig.permissions', m => m.rig === rig)!.requestId, rig, seats } as ServerMessage),
    pong: (machineId: string, error?: 'outdated') => emit({ type: 'pong', requestId: last('ping', m => m.machineId === machineId)!.requestId, machineId, ...(error ? { error } : {}) } as ServerMessage),
    acts: () => sent.filter(m => m.type === 'openrig.act') as Array<{ action: { kind: string } }>,
    /** Ends the last action sent, ok or with an error. */
    done: (error?: string) => emit({ type: 'openrig.done', requestId: last('openrig.act')!.requestId, ok: error === undefined, commands: [], ...(error ? { error } : {}) } as ServerMessage)
  };
}
const machine = (id: string, label: string, ssh?: string) => ({ id, label, ...(ssh ? { ssh } : {}), ready: true, status: 'open', recents: [], sessions: [], launcher: null }) as unknown as MachineState;
const seat = (logicalId: string, rig: string, o: Partial<RigSeat> = {}): RigSeat => ({ logicalId, session: `${logicalId.replace('.', '-')}@${rig}`, runtime: 'claude-code', model: null, sessionStatus: 'running', lifecycleState: 'running', activity: 'idle', stopped: false, work: 0, ...o });
const rig = (name: string, status: string, nodes: RigSeat[], o: Partial<Rig> = {}): Rig => ({ id: name, name, status, lifecycleState: status, seats: nodes.length, running: status === 'running' ? nodes.length : 0, attention: 0, uptime: null, snapshot: null, nodes, ...o });
const STARTED = '2026-11-08T09:12:00.000Z';
const state = (o: Partial<OpenRigState> = {}): OpenRigState => ({
  installed: true, version: '0.7.10', daemon: { state: 'running', startedAt: STARTED, port: 7433, pid: 4242 }, kernel: { state: 'ready' }, at: '2026-11-08T10:00:00.000Z',
  rigs: [
    rig('kernel', 'running', [seat('advisor.lead', 'kernel'), seat('operator.agent', 'kernel')]),
    rig('ledge-dev', 'running', [seat('dev.build', 'ledge-dev'), seat('dev.build-2', 'ledge-dev'), seat('dev.review', 'ledge-dev', { runtime: 'codex' })], { snapshot: '2 h' }),
    rig('synapse-review', 'stopped', [seat('r.s1', 'synapse-review', { stopped: true })])
  ], ...o
});
const waitingSession = { id: 'bix', name: 'Bix', tool: 'claude', state: 'waiting_permission', machineId: 'local', rig: { seat: 'dev-build@ledge-dev' } } as unknown as Session;
const entry = (seq: number, machineId: string, cmd: string): RigOutputEntry => ({ seq, at: Date.UTC(2026, 10, 8, 9, seq), machine: machineId, commands: [cmd], ok: true, result: null });

const MACHINES = [machine('local', 'locale'), machine('srv', 'legion', 'legion'), machine('old', 'vieux', 'old')];

function mount(o: { section?: OpenRigSection; machine?: string; sessions?: Session[]; output?: RigOutputEntry[]; role?: string } = {}) {
  const f = fake(), dispatch = vi.fn(), onTab = vi.fn(), onLaunch = vi.fn();
  const output = o.output ?? [entry(1, 'local', 'rig ps'), entry(2, 'srv', 'rig up remote'), entry(3, 'local', 'rig down synapse-review --snapshot')];
  const props = { client: f.client, machines: MACHINES, machine: o.machine ?? 'local', section: o.section ?? 'overview', role: o.role, seat: undefined,
    projects: null, sessions: o.sessions ?? [], asks: [] as HumanAsk[], output, dispatch, onTab, onLaunch } as const;
  const r = render(<LangProvider lang="fr"><OpenRigView {...props} /></LangProvider>);
  const rerender = (section: OpenRigSection) => r.rerender(<LangProvider lang="fr"><OpenRigView {...props} section={section} /></LangProvider>);
  return { f, dispatch, onTab, onLaunch, rerender };
}
const body = (name: string) => screen.getByRole('region', { name });

describe('Vue d’ensemble (R12)', () => {
  it('shows the four tiles with the mockup’s words', () => {
    const m = mount(); m.f.state('local', state());
    const b = body('Vue d’ensemble');
    const since = new Date(STARTED).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const tile = (name: RegExp) => within(b).getByRole('button', { name });
    expect(tile(/^Daemon/)).toHaveTextContent(`Daemonen marche0.7.10 · depuis ${since}`);
    expect(tile(/^Kernel/)).toHaveTextContent('Kernel2 sièges');
    expect(tile(/^Kernel/)).toHaveTextContent('advisor, operator');
    expect(tile(/^Rigs/)).toHaveTextContent('Rigs1 sur 2en marche sur locale');
    expect(tile(/^Sièges/)).toHaveTextContent('Sièges5 actifspersonne n’attend');
    expect(tile(/^Sièges/)).not.toHaveClass('warn');
  });
  it('the Kernel tile opens the kernel’s Rig tab; Daemon and Rigs open their section', async () => {
    const m = mount(); m.f.state('local', state());
    const b = body('Vue d’ensemble');
    await userEvent.click(within(b).getByRole('button', { name: /^Kernel/ }));
    expect(m.onTab).toHaveBeenCalledWith({ kind: 'rig', ref: 'local:kernel' });
    await userEvent.click(within(b).getByRole('button', { name: /^Daemon/ }));
    expect(m.dispatch).toHaveBeenCalledWith({ type: 'openrig', machine: 'local', section: 'daemon' });
    await userEvent.click(within(b).getByRole('button', { name: /^Rigs/ }));
    expect(m.dispatch).toHaveBeenCalledWith({ type: 'openrig', machine: 'local', section: 'rigs' });
  });
  it('a seat waiting for a permission is counted in amber and listed under « T’attendent »; a click opens its session', async () => {
    const m = mount({ sessions: [waitingSession] }); m.f.state('local', state());
    const b = body('Vue d’ensemble');
    const tile = within(b).getByRole('button', { name: /^Sièges/ });
    expect(tile).toHaveTextContent('1 t’attend');
    expect(tile).toHaveClass('warn');
    const waiting = within(b).getByRole('group', { name: 'T’attendent' });
    const row = within(waiting).getByRole('button', { name: /Bix/ });
    expect(row).toHaveTextContent('ledge-dev · build');
    expect(row).toHaveTextContent('permission');
    await userEvent.click(row);
    expect(m.dispatch).toHaveBeenCalledWith({ type: 'open', id: 'bix' });
  });
  it('nobody waiting: no « T’attendent »', () => {
    const m = mount(); m.f.state('local', state());
    expect(screen.queryByRole('group', { name: 'T’attendent' })).toBeNull();
  });
  it('« Dernières commandes » shows this machine’s last commands; « Tout voir » opens the Sortie section', async () => {
    const m = mount(); m.f.state('local', state());
    const recent = within(body('Vue d’ensemble')).getByRole('group', { name: 'Dernières commandes' });
    expect(recent).toHaveTextContent('rig ps');
    expect(recent).toHaveTextContent('rig down synapse-review --snapshot');
    expect(recent).not.toHaveTextContent('rig up remote');
    await userEvent.click(within(recent).getByRole('button', { name: 'Tout voir' }));
    expect(m.dispatch).toHaveBeenCalledWith({ type: 'openrig', machine: 'local', section: 'output' });
  });
});

describe('Rigs (R13)', () => {
  const card = (name: string) => screen.getByRole('article', { name });
  it('one card per rig, the kernel first and marked « système », then the dashed launch card', async () => {
    const m = mount({ section: 'rigs' }); m.f.state('local', state());
    const cards = within(body('Rigs')).getAllByRole('article');
    expect(cards.map(c => c.getAttribute('aria-label'))).toEqual(['kernel', 'ledge-dev', 'synapse-review']);
    expect(card('kernel')).toHaveTextContent('système');
    expect(card('kernel')).toHaveTextContent('Le rig d’OpenRig lui-même');
    expect(card('ledge-dev')).not.toHaveTextContent('système');
    await userEvent.click(within(body('Rigs')).getByRole('button', { name: /Lancer un rig…\s*Depuis une spec, un rig vide ou avec l’operator/ }));
    expect(m.onLaunch).toHaveBeenCalledWith('local');
  });
  it('a card shows its roles as chips with their number, its seats and its snapshot', () => {
    const m = mount({ section: 'rigs' }); m.f.state('local', state());
    const chips = within(card('ledge-dev')).getAllByTestId('role-chip').map(c => c.textContent);
    expect(chips).toEqual(['build ×2', 'review']);
    expect(card('ledge-dev')).toHaveTextContent('3 sièges');
    expect(card('ledge-dev')).toHaveTextContent('snapshot 2 h');
    expect(card('ledge-dev')).toHaveTextContent('en marche');
    expect(card('synapse-review')).toHaveTextContent('arrêté');
  });
  it('« Ouvrir la vue Rig → » and the name open the rig’s tab', async () => {
    const m = mount({ section: 'rigs' }); m.f.state('local', state());
    await userEvent.click(within(card('ledge-dev')).getByRole('button', { name: 'Ouvrir la vue Rig →' }));
    expect(m.onTab).toHaveBeenLastCalledWith({ kind: 'rig', ref: 'local:ledge-dev' });
    await userEvent.click(within(card('synapse-review')).getByRole('button', { name: 'synapse-review' }));
    expect(m.onTab).toHaveBeenLastCalledWith({ kind: 'rig', ref: 'local:synapse-review' });
  });
  it('the permission shows once `openrig.permissions` answered, « Mixte » when the seats differ; it is asked once per rig', () => {
    const m = mount({ section: 'rigs' }); m.f.state('local', state());
    expect(card('ledge-dev')).not.toHaveTextContent('Mixte');
    m.f.permissions('ledge-dev', [
      { logicalId: 'dev.build', session: 'dev-build@ledge-dev', policy: 'builtin:auto', policySource: 'member_policy' },
      { logicalId: 'dev.review', session: 'dev-review@ledge-dev', policy: 'builtin:yolo', policySource: 'member_policy' }
    ]);
    expect(card('ledge-dev')).toHaveTextContent('3 sièges · Mixte · snapshot 2 h');
    m.f.permissions('synapse-review', [{ logicalId: 'r.s1', session: 'r-s1@synapse-review', policy: 'builtin:open', policySource: 'member_policy' }]);
    expect(card('synapse-review')).toHaveTextContent('Ouvert');
    // The next poll does not ask again.
    m.f.state('local', state());
    expect(m.f.sent.filter(x => x.type === 'openrig.permissions').map(x => (x as { rig: string }).rig).sort()).toEqual(['ledge-dev', 'synapse-review']);
  });
  it('« Arrêter » on a card asks under its header, then sends rig.stop with the snapshot (preferences)', async () => {
    const m = mount({ section: 'rigs' }); m.f.state('local', state());
    await userEvent.click(within(card('ledge-dev')).getByRole('button', { name: 'Arrêter ledge-dev' }));
    expect(m.f.acts()).toEqual([]);
    const conf = within(card('ledge-dev')).getByRole('group', { name: /ledge-dev/ });
    await userEvent.click(within(conf).getByRole('button', { name: 'Confirmer l’arrêt' }));
    expect(m.f.acts().map(a => a.action)).toEqual([{ kind: 'rig.stop', rig: 'ledge-dev', snapshot: true }]);
  });
  it('« Démarrer » on a stopped rig sends rig.start at once', async () => {
    const m = mount({ section: 'rigs' }); m.f.state('local', state());
    await userEvent.click(within(card('synapse-review')).getByRole('button', { name: 'Démarrer synapse-review' }));
    expect(m.f.acts().map(a => a.action)).toEqual([{ kind: 'rig.start', rig: 'synapse-review' }]);
  });
});

describe('the page’s one confirmation (rail and cards)', () => {
  const rail = () => document.querySelector<HTMLElement>('.ide-orp-rail')!;
  const card = (name: string) => screen.getByRole('article', { name });
  const BUSY = 'Une autre action OpenRig est en cours sur cette machine.';
  it('a rig started from its card, then a daemon restart that fails: the error shows under the rail only', async () => {
    const m = mount({ section: 'rigs' }); m.f.state('local', state());
    await userEvent.click(within(card('synapse-review')).getByRole('button', { name: 'Démarrer synapse-review' }));
    m.f.done();
    await userEvent.click(within(rail()).getByRole('button', { name: 'Redémarrer le daemon' }));
    await userEvent.click(within(within(rail()).getByRole('group')).getByRole('button', { name: 'Confirmer le redémarrage' }));
    m.f.done('busy');
    expect(within(rail()).getByRole('alert')).toHaveTextContent(BUSY);
    expect(within(card('synapse-review')).queryByRole('alert')).toBeNull();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });
  it('a daemon restart from the rail, then a rig stop that fails: the error shows under the card only', async () => {
    const m = mount({ section: 'rigs' }); m.f.state('local', state());
    await userEvent.click(within(rail()).getByRole('button', { name: 'Redémarrer le daemon' }));
    await userEvent.click(within(within(rail()).getByRole('group')).getByRole('button', { name: 'Confirmer le redémarrage' }));
    m.f.done();
    await userEvent.click(within(card('ledge-dev')).getByRole('button', { name: 'Arrêter ledge-dev' }));
    await userEvent.click(within(within(card('ledge-dev')).getByRole('group')).getByRole('button', { name: 'Confirmer l’arrêt' }));
    m.f.done('busy');
    expect(within(card('ledge-dev')).getByRole('alert')).toHaveTextContent(BUSY);
    expect(within(rail()).queryByRole('alert')).toBeNull();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });
  it('one confirmation at a time: asking on the rail closes the card’s', async () => {
    const m = mount({ section: 'rigs' }); m.f.state('local', state());
    await userEvent.click(within(card('ledge-dev')).getByRole('button', { name: 'Arrêter ledge-dev' }));
    expect(within(card('ledge-dev')).getByRole('group')).toBeInTheDocument();
    await userEvent.click(within(rail()).getByRole('button', { name: 'Arrêter le daemon' }));
    expect(within(card('ledge-dev')).queryByRole('group')).toBeNull();
    expect(screen.getAllByRole('group', { name: /Arrêter/ })).toHaveLength(1);
    expect(within(rail()).getByRole('group')).toHaveTextContent('rig daemon stop');
  });
  it('a confirmation opened in Rigs does not survive a switch to Daemon and back', async () => {
    const m = mount({ section: 'rigs' }); m.f.state('local', state());
    await userEvent.click(within(card('ledge-dev')).getByRole('button', { name: 'Arrêter ledge-dev' }));
    expect(within(card('ledge-dev')).getByRole('group')).toBeInTheDocument();
    m.rerender('daemon');
    m.rerender('rigs');
    expect(screen.queryByRole('group')).toBeNull();
  });
});

describe('Machines (R15)', () => {
  const row = (label: string) => screen.getByRole('listitem', { name: label });
  it('one row per machine: kind, OpenRig version, rigs, latency', () => {
    const m = mount({ section: 'machines' }); m.f.state('local', state()); m.f.state('srv', state({ version: '0.7.9' }));
    m.f.pong('srv'); m.f.pong('old', 'outdated');
    expect(row('locale')).toHaveTextContent('local');
    expect(row('locale')).toHaveTextContent('OpenRig 0.7.10');
    expect(row('locale')).toHaveTextContent('1 rig');
    expect(row('legion')).toHaveTextContent('ssh · legion');
    expect(row('legion')).toHaveTextContent('OpenRig 0.7.9');
    expect(row('legion')).toHaveTextContent(/\d+ ms/);
    expect(row('vieux')).toHaveTextContent('—');
    // The local machine is never pinged.
    expect(m.f.sent.some(x => x.type === 'ping' && x.machineId === 'local')).toBe(false);
  });
  it('a machine without OpenRig says « non installé », a stopped daemon « arrêté »', () => {
    const m = mount({ section: 'machines' }); m.f.state('local', state({ daemon: { state: 'stopped' }, rigs: [] }));
    m.f.state('srv', { installed: false, daemon: { state: 'unknown' }, kernel: { state: 'absent' }, rigs: [], at: '2026-11-08T10:00:00.000Z' });
    expect(row('locale')).toHaveTextContent('arrêté');
    expect(row('legion')).toHaveTextContent('non installé');
  });
  it('the displayed machine says « affichée »; « Afficher » changes it and opens its tab', async () => {
    const m = mount({ section: 'machines' }); m.f.state('local', state());
    expect(row('locale')).toHaveTextContent('affichée');
    await userEvent.click(within(row('legion')).getByRole('button', { name: 'Afficher legion' }));
    expect(loadRigsMachine()).toBe('srv');
    expect(m.onTab).toHaveBeenCalledWith({ kind: 'openrig', ref: 'srv' });
    expect(row('legion')).toHaveTextContent('affichée');
  });
  it('« Ajouter une machine » opens Settings › Machines, with the mockup’s sentence', async () => {
    const m = mount({ section: 'machines' });
    expect(body('Machines')).toHaveTextContent('La machine affichée pilote l’explorateur Rigs, cette page et la fenêtre de lancement.');
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter une machine' }));
    expect(m.dispatch).toHaveBeenCalledWith({ type: 'settings', section: 'machines' });
  });
});

describe('Daemon (R16)', () => {
  it('shows the address and pid, then the three rows', () => {
    const m = mount({ section: 'daemon' }); m.f.state('local', state());
    const b = body('Daemon');
    expect(b).toHaveTextContent('127.0.0.1:7433 · pid 4242');
    for (const l of ['Relancer les rigs qui tournaient', 'Démarrer sans le kernel', 'Prendre un snapshot du rig', 'Demander confirmation si un siège travaille']) expect(within(b).getByRole('checkbox', { name: l })).toBeInTheDocument();
    expect(within(b).getByRole('checkbox', { name: 'Relancer les rigs qui tournaient' })).toBeChecked();
    expect(within(b).getByRole('radiogroup', { name: 'Permissions au lancement' })).toBeInTheDocument();
    expect(b).toHaveTextContent('Valeur proposée quand tu lances un rig. Chaque rig garde la sienne.');
  });
  it('unticking « Prendre un snapshot du rig » writes snapshotBeforeStop: false for the shown machine only', async () => {
    const m = mount({ section: 'daemon' }); m.f.state('local', state());
    await userEvent.click(screen.getByRole('checkbox', { name: 'Prendre un snapshot du rig' }));
    expect(loadDaemonPrefs('local').snapshotBeforeStop).toBe(false);
    expect(loadDaemonPrefs('srv').snapshotBeforeStop).toBe(true);
    expect(screen.getByRole('checkbox', { name: 'Prendre un snapshot du rig' })).not.toBeChecked();
  });
  it('the permission segment writes `perm`; « Relancer » and « Demander confirmation » write theirs', async () => {
    const m = mount({ section: 'daemon' }); m.f.state('local', state());
    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Permissions au lancement' })).getByRole('radio', { name: 'YOLO' }));
    expect(loadDaemonPrefs('local').perm).toBe('yolo');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Demander confirmation si un siège travaille' }));
    expect(loadDaemonPrefs('local').askAlways).toBe(false);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Relancer les rigs qui tournaient' }));
    expect(loadDaemonPrefs('local').relaunch).toBe(false);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Démarrer sans le kernel' }));
    expect(loadDaemonPrefs('local').noKernel).toBe(true);
  });
  it('« Démarrer sans le kernel » is off while « Relancer » is ticked (it applies only to a start that brings nothing back)', () => {
    const m = mount({ section: 'daemon' }); m.f.state('local', state());
    expect(screen.getByRole('checkbox', { name: 'Démarrer sans le kernel' })).toBeDisabled();
  });
});

describe('Rôles (R14) and Sortie (R17)', () => {
  it('Rôles shows RolesView on the shell’s one read of the roles', () => {
    const m = mount({ section: 'roles' }); m.f.state('local', state()); m.f.roles();
    expect(within(body('Rôles')).getByRole('listbox', { name: 'Rôles de la machine' })).toBeInTheDocument();
    expect(m.f.sent.filter(x => x.type === 'openrig.roles')).toHaveLength(1);
  });
  it('the page’s `role` opens that role, and a role picked in the list stays on this machine', async () => {
    const m = mount({ section: 'roles', machine: 'srv', role: 'b2' }); m.f.state('srv', state()); m.f.roles();
    expect(m.f.sent.some(x => x.type === 'openrig.role' && x.roleId === 'b2' && x.machineId === 'srv')).toBe(true);
    await userEvent.click(within(screen.getByRole('listbox', { name: 'Rôles de la machine' })).getByRole('option', { name: /ledge-lead/ }));
    expect(m.dispatch).toHaveBeenCalledWith({ type: 'openrig', machine: 'srv', section: 'roles', role: 'u2' });
  });
  it('Sortie shows every machine’s entries', () => {
    mount({ section: 'output' });
    const log = within(body('Sortie')).getByRole('log');
    expect(log).toHaveTextContent('rig ps');
    expect(log).toHaveTextContent('rig up remote');
    expect(body('Sortie')).toHaveTextContent('les commandes rig lancées depuis Ledge');
  });
});

describe('a machine removed while its tab is open', () => {
  it('says « Machine inconnue » instead of loading forever', () => {
    mount({ machine: 'gone' });
    expect(screen.getByText(/Machine inconnue/)).toBeInTheDocument();
    expect(screen.queryByText('Lecture d’OpenRig…')).toBeNull();
  });
  it('the Machines and Sortie sections still show', () => {
    const m = mount({ machine: 'gone', section: 'machines' });
    expect(screen.getByRole('listitem', { name: 'legion' })).toBeInTheDocument();
    m.rerender('output');
    expect(within(body('Sortie')).getByRole('log')).toHaveTextContent('rig ps');
  });
});
