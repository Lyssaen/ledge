import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReducer } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ClientMessage, OpenRigStatus, Projects, Rig, RigSeat, RigSpecInfo, ServerMessage, Session } from '@ledge/protocol';
import { forgetRigSpecs, type DaemonClient } from '@ledge/fleet';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { LangProvider } from '../src/i18n/lang';
import { RigsTab, visibleRigs } from '../src/rigs/RigsTab';
import { initialNav, navReducer, type NavAction, type NavState } from '../src/nav/state';

const PROJECTS: Projects = { projects: [{ id: 'ledge', name: 'Ledge', color: 'blue', description: '', repos: [{ machine: 'local', path: '/w/ledge' }] }], rules: [] };
const seat = (name: string, extra: Partial<RigSeat> = {}): RigSeat => ({ ref: `${name}@factory`, address: `@${name}`, name, runtime: 'claude-code', model: 'opus', state: 'working', ...extra });
const FACTORY: Rig = { id: 'r1', name: 'factory', machine: 'local', spec: 'factory', cwd: '/w/ledge', projectId: 'ledge', offProject: false, branch: 'feat/rigs', lifecycle: 'running', kernel: false, repos: [],
  seats: [seat('orch-lead', { address: '@lead', contextPct: 41 }), seat('build', { contextPct: 63, sessionId: 'local:build' }),
    seat('review-a', { runtime: 'codex', model: 'gpt-5.5', contextPct: 28 }), seat('review-b', { runtime: 'codex', model: 'gpt-5.5-mini', state: 'ready', contextPct: 12 }),
    seat('qa', { model: 'sonnet', contextPct: 55 }), seat('design', { state: 'ready', contextPct: 9 })] };
const STARTER: Rig = { id: 'r2', name: 'starter', machine: 'local', spec: 'starter', cwd: '/w/ledge', projectId: 'ledge', offProject: false, branch: 'fix/notch', lifecycle: 'running', kernel: false, repos: [],
  seats: [seat('dev-build', { ref: 'dev-build@starter', address: '@build', contextPct: 33 }), seat('dev-review', { ref: 'dev-review@starter', address: '@review-a', runtime: 'codex', model: 'gpt-5.5', state: 'ready', contextPct: 7 })] };
const KERNEL: Rig = { id: 'k', name: 'openrig-kernel', machine: 'local', cwd: '/w', projectId: null, offProject: false, lifecycle: 'running', kernel: true, repos: [],
  seats: [seat('operator', { ref: 'operator@kernel', address: '@operator', runtime: 'codex', state: 'ready' }), seat('queue', { ref: 'queue@kernel', address: '@queue', runtime: 'codex', state: 'idle' }),
    seat('advisor-lead', { ref: 'advisor-lead@kernel', state: 'idle' }), seat('human', { ref: 'human@kernel', runtime: 'terminal', state: 'idle' })] };
const RUNNING: OpenRigStatus = { machine: 'local', state: 'running', version: '0.6.14', human: 'registered' };
const specSeat = (address: string, pod: string, extra: Partial<RigSpecInfo['seats'][number]> = {}) => ({ address, member: address.slice(1), pod, runtime: 'claude-code', model: 'opus', effort: 'high', profile: 'demande', ...extra });
const SPECS: RigSpecInfo[] = [
  { id: 'starter', name: 'starter', source: 'builtin', seats: [specSeat('@build', 'dev'), specSeat('@review-a', 'review', { runtime: 'codex', model: 'gpt-5.5' })] },
  { id: 'factory', name: 'factory', source: 'library', path: '~/.openrig/specs/rigs/factory/rig.yaml', seats: [specSeat('@lead', 'Lead'), specSeat('@advisor', 'Advisor'), specSeat('@build', 'Builder', { profile: 'éditions' }),
    specSeat('@qa', 'QA', { model: 'sonnet', effort: 'medium' }), specSeat('@design', 'Design'), specSeat('@review-a', 'Relecteur A', { runtime: 'codex', model: 'gpt-5.5' }), specSeat('@review-b', 'Relecteur B', { runtime: 'codex', model: 'gpt-5.5-mini', effort: 'medium' })] }
];
const build = fakeSession('local:build', { name: 'build', cwd: '/w/ledge', state: 'working', machineId: 'local' });

let dispatched: NavAction[] = [];
let sent: ClientMessage[] = [];
let notified: string[] = [];
const user = userEvent.setup();

function clientOf(rigs: Rig[], openrig: OpenRigStatus[], specs: RigSpecInfo[]): DaemonClient {
  const listeners = new Set<(m: ServerMessage) => void>();
  return {
    send(m: ClientMessage) {
      sent.push(m);
      if (m.type === 'rig.specs.request') queueMicrotask(() => { for (const l of [...listeners]) l({ type: 'rig.specs', requestId: m.requestId, machine: m.machineId ?? 'local', specs }); });
    },
    onMessage(fn: (m: ServerMessage) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    fleet: { subscribe: () => () => {}, rigs: () => rigs, openrig: () => openrig, escalations: () => [], seatTerminal: () => null }
  } as unknown as DaemonClient;
}

function Harness({ client, start }: { client: DaemonClient; start?: Partial<Extract<NavState['place'], { kind: 'home' }>> }) {
  const [nav, apply] = useReducer(navReducer, undefined, () => {
    const n = initialNav({ view: 'atelier', helpers: true, paused: true });
    return { ...n, place: { kind: 'home' as const, tab: 'rigs' as const, view: 'atelier' as const, project: 'all', ...start } };
  });
  return <RigsTab nav={nav} dispatch={a => { dispatched.push(a); apply(a); }} client={client} sessions={[build]} projects={PROJECTS} notify={t => { notified.push(t); }} />;
}

const RIGS = [KERNEL, FACTORY, STARTER];
function renderTab({ rigs = RIGS, openrig = [RUNNING], specs = SPECS, start }: { rigs?: Rig[]; openrig?: OpenRigStatus[]; specs?: RigSpecInfo[]; start?: Partial<Extract<NavState['place'], { kind: 'home' }>> } = {}) {
  const client = clientOf(rigs, openrig, specs);
  return render(<LangProvider lang="fr"><Harness client={client} {...(start ? { start } : {})} /></LangProvider>);
}
const card = (name: string) => screen.getByRole('article', { name });

beforeEach(() => { dispatched = []; sent = []; notified = []; forgetRigSpecs(); localStorage.clear(); });
afterEach(() => cleanup());

describe('the Rigs tab of the Ledge screen', () => {
  it('En cours : factory 4/6 au travail, starter 1/2, noyau au repos en dernier', async () => {
    renderTab();
    await screen.findByRole('tab', { name: 'Specs · 2' });
    const tabs = screen.getByRole('tablist', { name: 'Vues des rigs' });
    expect(within(tabs).getAllByRole('tab').map(t => t.textContent)).toEqual(['En cours · 3', 'Specs · 2', 'Agents · 8']);
    expect(within(tabs).getByRole('tab', { name: 'En cours · 3' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('article').map(a => a.getAttribute('aria-label'))).toEqual(['factory', 'starter', 'Noyau OpenRig']);
    const factory = within(card('factory'));
    expect(card('factory')).toHaveTextContent('rig · 6 sièges · dans Ledge · ⎇ feat/rigs · spec factory');
    expect(factory.getByText('4/6 au travail')).toBeVisible();
    expect(card('factory')).not.toHaveTextContent('sur ');
    const lead = factory.getByText('orch-lead').closest('[data-seat]') as HTMLElement;
    expect(lead).toHaveTextContent('@lead');
    expect(lead).toHaveTextContent(/Au travail\s*· Claude Code · opus · contexte 41 %/);
    expect(factory.getByText('review-b').closest('[data-seat]')).toHaveTextContent(/Disponible\s*· Codex · gpt-5.5-mini · contexte 12 %/);
    expect(within(card('starter')).getByText('1/2 au travail')).toBeVisible();
    const kernel = card('Noyau OpenRig');
    expect(kernel).toHaveTextContent('la mécanique · operator et queue · toujours allumé');
    expect(within(kernel).getByText('au repos')).toBeVisible();
    expect(within(kernel).queryByText('advisor-lead')).toBeNull();
    await user.click(within(kernel).getByRole('button', { name: '+2' }));
    expect(within(kernel).getByText('advisor-lead')).toBeVisible();
    await user.click(within(kernel).getByRole('button', { name: 'Santé' }));
    expect(kernel).toHaveTextContent('OpenRig 0.6.14');
    expect(kernel).toHaveTextContent('humain inscrit');
  });

  it('Table navigue vers la pièce du rig', async () => {
    renderTab();
    await user.click(within(card('factory')).getByRole('button', { name: 'Table' }));
    expect(dispatched).toContainEqual({ type: 'home', project: 'rig:local/r1' });
  });

  it('un siège apparié ouvre sa session ; un siège sans session ne fait rien', async () => {
    renderTab();
    const factory = within(card('factory'));
    await user.click(factory.getByRole('button', { name: 'Ouvrir la session de build' }));
    expect(dispatched).toEqual([{ type: 'open', id: 'local:build' }]);
    expect(factory.queryByRole('button', { name: /^design/ })).toBeNull();
  });

  it('Terminaux déplie les sièges du rig', async () => {
    renderTab();
    await user.click(within(card('starter')).getByRole('button', { name: 'Terminaux' }));
    const menu = within(screen.getByRole('menu', { name: 'Terminaux de starter' }));
    expect(menu.getAllByRole('menuitem').map(m => m.textContent)).toEqual(['dev-build', 'dev-review']);
  });

  it('un terminal de siège qui ne s’ouvre pas le dit (toast), comme l’atelier', async () => {
    renderTab();
    await user.click(within(card('starter')).getByRole('button', { name: 'Terminaux' }));
    await user.click(within(screen.getByRole('menu', { name: 'Terminaux de starter' })).getByRole('menuitem', { name: 'dev-build' }));
    await vi.waitFor(() => expect(notified).toEqual(['Le terminal de dev-build n’a pas pu s’ouvrir.']));
  });

  it('un siège arrêté ne compte nulle part : ni « n sièges », ni le dénominateur, ni la liste, ni « +n » du noyau', async () => {
    const half: Rig = { ...STARTER, seats: [...STARTER.seats, seat('dev-qa', { ref: 'dev-qa@starter', state: 'stopped' })] };
    const kernel: Rig = { ...KERNEL, seats: [...KERNEL.seats, seat('advisor-old', { ref: 'advisor-old@kernel', state: 'stopped' })] };
    renderTab({ rigs: [kernel, half] });
    expect(card('starter')).toHaveTextContent('rig · 2 sièges');
    expect(within(card('starter')).getByText('1/2 au travail')).toBeVisible();
    expect(within(card('starter')).queryByText('dev-qa')).toBeNull();
    await user.click(within(card('Noyau OpenRig')).getByRole('button', { name: '+2' }));
    expect(within(card('Noyau OpenRig')).queryByText('advisor-old')).toBeNull();
  });

  it('visibleRigs : les rigs d’une machine où OpenRig ne répond pas ne comptent pas', () => {
    const remote: Rig = { ...STARTER, id: 'r9', machine: 'dev' };
    expect(visibleRigs([FACTORY, remote], [RUNNING, { machine: 'dev', state: 'stopped' }])).toEqual([FACTORY]);
  });

  it('lancement en cours : « 4/7 prêts » et « attend ta confiance dans le dossier »', () => {
    const launching: Rig = { ...FACTORY, lifecycle: 'launching', seats: [...FACTORY.seats.slice(0, 3), seat('review-b', { state: 'ready' }), seat('qa', { state: 'trust' }), seat('design', { state: 'starting' }), seat('advisor', { state: 'starting' })] };
    renderTab({ rigs: [launching] });
    const factory = within(card('factory'));
    expect(factory.getByText('4/7 prêts')).toBeVisible();
    expect(factory.queryByText(/au travail$/)).toBeNull();
    expect(factory.getByText('qa').closest('[data-seat]')).toHaveTextContent('attend ta confiance dans le dossier');
    expect(factory.getByText('design').closest('[data-seat]')).toHaveTextContent('démarre…');
  });

  it('un rig distant dit « sur {machine} »', () => {
    renderTab({ rigs: [{ ...STARTER, machine: 'ec2-build' }] });
    expect(card('starter')).toHaveTextContent('sur ec2-build');
  });

  it('Specs : factory sélectionnée, 7 lignes de siège, « Lancer ce rig… » ouvre rig-launch avec spec factory', async () => {
    renderTab();
    await user.click(await screen.findByRole('tab', { name: 'Specs · 2' }));
    expect(dispatched).toContainEqual({ type: 'ledge', tab: 'rigs', rigs: 'specs' });
    const list = within(screen.getByRole('listbox', { name: 'Specs' }));
    expect(screen.getByText('Bibliothèque · ~/.openrig/specs')).toBeVisible();
    expect(screen.getByText('Registre · openrig.dev/rigs')).toBeVisible();
    expect(screen.getByText('Rien de lu depuis le registre')).toBeVisible();
    const factoryItem = list.getByRole('option', { name: /factory/ });
    expect(factoryItem).toHaveTextContent('7 sièges');
    expect(factoryItem).toHaveTextContent('@review-b');
    await user.click(factoryItem);
    expect(dispatched).toContainEqual({ type: 'ledge', tab: 'rigs', rigs: 'specs', spec: 'factory' });
    expect(list.getByRole('option', { name: /factory/ })).toHaveAttribute('aria-selected', 'true');
    const detail = within(screen.getByRole('region', { name: 'Spec factory' }));
    expect(screen.getByRole('region', { name: 'Spec factory' })).toHaveTextContent('Spec OpenRig · 7 sièges · bibliothèque');
    const rows = detail.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(7);
    expect(rows[2]).toHaveTextContent(/@build\s*Builder\s*Claude Code · opus · high\s*éditions/);
    expect(detail.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Siège', 'Rôle', 'Outil · modèle · effort', 'Autonomie']);
    expect(detail.getByText('~/.openrig/specs/rigs/factory/rig.yaml')).toBeVisible();
    expect(detail.getByRole('button', { name: 'Copier' })).toBeVisible();
    expect(detail.getByText('factory', { selector: '.rs-born-name' }).closest('li')).toHaveTextContent('active');
    await user.click(detail.getByRole('button', { name: 'Lancer ce rig…' }));
    expect(dispatched).toContainEqual({ type: 'modal', modal: { kind: 'rig-launch', spec: 'factory' } });
    expect(sent.filter(m => m.type === 'rig.specs.request')).toHaveLength(1);
  });

  it('Specs : une liste de machines quand plusieurs ont OpenRig', async () => {
    renderTab({ openrig: [RUNNING, { machine: 'ec2-build', state: 'running', version: '0.6.14' }, { machine: 'dev', state: 'stopped' }], start: { rigs: 'specs' } });
    const pick = await screen.findByRole('combobox', { name: 'Machine' });
    expect(within(pick).getAllByRole('option').map(o => o.textContent)).toEqual(['local', 'ec2-build']);
    await user.selectOptions(pick, 'ec2-build');
    expect(sent.filter(m => m.type === 'rig.specs.request').map(m => (m as { machineId?: string }).machineId)).toEqual(['local', 'ec2-build']);
  });

  it('Agents : 8 sièges triés au travail d’abord, sans operator ni queue', async () => {
    renderTab();
    await user.click(screen.getByRole('tab', { name: 'Agents · 8' }));
    const table = within(screen.getByRole('table', { name: 'Agents' }));
    const rows = table.getAllByRole('row').slice(1);
    expect(rows.map(r => r.querySelector('.ra-name')?.textContent)).toEqual(['build', 'dev-build', 'orch-lead', 'qa', 'review-a', 'design', 'dev-review', 'review-b']);
    expect(rows[1]).toHaveTextContent(/@build\s*dev-build\s*starter\s*Au travail\s*Claude Code · opus\s*33 %/);
    expect(table.queryByText('operator')).toBeNull();
    expect(table.queryByText('queue')).toBeNull();
    await user.click(rows[0]!);
    expect(dispatched).toContainEqual({ type: 'open', id: 'local:build' });
  });

  it('OpenRig non pris en charge : bandeau « OpenRig 0.7.0 non pris en charge », aucune carte', () => {
    renderTab({ rigs: [FACTORY], openrig: [{ machine: 'local', state: 'unsupported', version: '0.7.0' }] });
    expect(screen.getByRole('status')).toHaveTextContent('OpenRig 0.7.0 non pris en charge');
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });

  it('OpenRig absent : le bandeau donne la commande d’installation', () => {
    renderTab({ rigs: [], openrig: [{ machine: 'local', state: 'absent', install: 'npm i -g @openrig/cli' }] });
    expect(screen.getByRole('status')).toHaveTextContent('OpenRig n’est pas installé');
    expect(screen.getByRole('status')).toHaveTextContent('npm i -g @openrig/cli');
  });

  it('lecture seule : aucun rig.act', async () => {
    renderTab();
    await user.click(await screen.findByRole('tab', { name: 'Specs · 2' }));
    await user.click(screen.getByRole('tab', { name: 'Agents · 8' }));
    expect(sent.filter(m => m.type.startsWith('rig.act'))).toEqual([]);
  });
});
