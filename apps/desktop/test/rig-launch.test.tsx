import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ClientMessage, OpenRigStatus, Project, RigPlan, RigSpecInfo, ServerMessage } from '@ledge/protocol';
import { forgetRigSpecs, type DaemonClient, type MachineState } from '@ledge/fleet';
import { LangProvider } from '../src/i18n/lang';
import { RigLaunch } from '../src/launch/RigLaunch';
import type { Modal, NavAction } from '../src/nav/state';

const PROJECTS: Project[] = [{ id: 'ledge', name: 'Ledge', color: 'blue', description: '', rigs: [], repos: [{ machine: 'local', path: '/w/ledge' }] }];
const machine = (id: string, label: string): MachineState => ({ id, label, status: 'open', ready: true, recents: [], sessions: [], launcher: null } as unknown as MachineState);
const LOCAL = machine('local', 'Local'), EC2 = machine('ec2', 'EC2');
const RUNNING: OpenRigStatus = { machine: 'local', state: 'running', version: '0.6.14', human: 'registered' };
const ABSENT: OpenRigStatus = { machine: 'ec2', state: 'absent', install: 'npm i -g @openrig/cli' };
const specSeat = (address: string, runtime = 'claude-code') => ({ address, member: address.slice(1), pod: 'dev', runtime, model: 'opus', profile: 'demande' });
const SPECS: RigSpecInfo[] = [
  { id: 'starter', name: 'starter', summary: 'une modification bornée', source: 'builtin', seats: [specSeat('@build'), specSeat('@review-a', 'codex')] },
  { id: 'factory', name: 'factory', summary: 'produit dans la durée', source: 'builtin', seats: [specSeat('@lead'), specSeat('@build'), specSeat('@review-a', 'codex')] }
];

let sent: ClientMessage[] = [];
let listeners = new Set<(machine: string, m: ServerMessage) => void>();
let dispatched: NavAction[] = [];
let closed = 0;
const user = userEvent.setup();
const answer = (m: ServerMessage) => { for (const l of [...listeners]) l('local', m); };
const last = <T extends ClientMessage['type']>(type: T) => sent.filter(m => m.type === type).at(-1) as Extract<ClientMessage, { type: T }> | undefined;
const planFor = (p: Extract<ClientMessage, { type: 'rig.prepare' }>, id = 'plan-1'): RigPlan => ({
  id, machine: 'local', spec: p.spec, goal: p.goal, where: p.where,
  cwd: p.where.kind === 'project' ? (p.where.copy ? `${p.where.repo}/.worktrees/rig-${p.spec}` : p.where.repo) : `/home/me/.ledge/rigs/${p.where.name}`,
  seats: [{ address: '@build', runtime: 'claude-code', model: 'opus', autonomy: 'demande' }, { address: '@review-a', runtime: 'codex', autonomy: 'demande' }],
  writes: ['.openrig/', '.mcp.json', 'CLAUDE.md'], command: `rig up ${p.spec} --cwd x --yes --json`, required: p.where.kind === 'project' && !p.where.copy
});

function clientOf(openrig: OpenRigStatus[]): DaemonClient {
  const route = (m: ClientMessage) => {
    sent.push(m);
    if (m.type === 'rig.specs.request') queueMicrotask(() => answer({ type: 'rig.specs', requestId: m.requestId, machine: m.machineId ?? 'local', specs: SPECS }));
  };
  const plain = new Set<(m: ServerMessage) => void>();
  return {
    send: route,
    onMessage(fn: (m: ServerMessage) => void) {
      // The fleet hands every local message to onMessage too; rig.specs only there (useRigSpecs).
      const wrap = (_: string, m: ServerMessage) => { if (m.type === 'rig.specs') fn(m); };
      listeners.add(wrap); plain.add(fn); return () => { listeners.delete(wrap); plain.delete(fn); };
    },
    fleet: {
      subscribe: () => () => {}, rigs: () => [], openrig: () => openrig, escalations: () => [],
      onMachineMessage(fn: (machine: string, m: ServerMessage) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
      sendTo(_machine: string, m: ClientMessage) { route(m); return true; }
    }
  } as unknown as DaemonClient;
}

function show({ wanted = {}, machines = [LOCAL], openrig = [RUNNING] }: { wanted?: Omit<Extract<Modal, { kind: 'rig-launch' }>, 'kind'>; machines?: MachineState[]; openrig?: OpenRigStatus[] } = {}) {
  return render(
    <LangProvider lang="fr">
      <RigLaunch client={clientOf(openrig)} projects={PROJECTS} machines={machines} wanted={{ kind: 'rig-launch', ...wanted }}
        dispatch={a => { dispatched.push(a); }} onClose={() => { closed++; }} />
    </LangProvider>
  );
}

beforeEach(() => { sent = []; listeners = new Set(); dispatched = []; closed = 0; forgetRigSpecs(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('RigLaunch', () => {
  it('projet + copie : « Lancer le rig » à l’étape 1 envoie rig.prepare puis rig.launch', async () => {
    show({ wanted: { project: 'ledge', goal: 'Corriger les tests qui échouent' } });
    await screen.findByText('Recommandé par Ledge');
    await user.click(screen.getByRole('button', { name: /^Lancer le rig/ }));
    const prepare = last('rig.prepare')!;
    expect(prepare).toMatchObject({ machine: 'local', spec: 'starter', goal: 'Corriger les tests qui échouent',
      where: { kind: 'project', projectId: 'ledge', repo: '/w/ledge', branch: 'feat/starter', copy: true } });
    answer({ type: 'rig.plan', rid: prepare.rid, plan: planFor(prepare) });
    await waitFor(() => expect(last('rig.launch')).toMatchObject({ planId: 'plan-1' }));
    answer({ type: 'rig.result', rid: last('rig.launch')!.rid, ok: true });
    await waitFor(() => expect(closed).toBe(1));
    expect(dispatched).toContainEqual({ type: 'ledge', tab: 'rigs', rigs: 'live' });
  });

  it('copie décochée : pas de « Lancer le rig » à l’étape 1, « Voir le plan » principal ; « Lancer » à l’étape 2', async () => {
    show({ wanted: { project: 'ledge', goal: 'Corriger les tests qui échouent' } });
    await screen.findByText('Recommandé par Ledge');
    await user.click(screen.getByRole('button', { name: 'Travailler dans une copie' }));
    expect(screen.queryByRole('button', { name: /^Lancer le rig/ })).toBeNull();
    const see = screen.getByRole('button', { name: 'Voir le plan' });
    expect(see.dataset.variant).toBe('primary');
    await user.click(see);
    const prepare = last('rig.prepare')!;
    expect(prepare.where).toMatchObject({ kind: 'project', copy: false });
    answer({ type: 'rig.plan', rid: prepare.rid, plan: planFor(prepare) });
    expect(await screen.findByRole('heading', { name: 'Plan du rig starter' })).toBeTruthy();
    expect(screen.getByText('Ce qui démarre · 2 sièges')).toBeTruthy();
    expect(last('rig.launch')).toBeUndefined();
    await user.click(screen.getByRole('button', { name: /^Lancer le rig/ }));
    expect(last('rig.launch')).toMatchObject({ planId: 'plan-1' });
  });

  it('hors projet : le nom suit le but, puis reste quand on l’a modifié', async () => {
    show();
    const goal = screen.getByLabelText('But donné au lead');
    await user.type(goal, 'Prototyper la reprise des rigs après un reboot de WSL');
    const name = screen.getByLabelText('Espace de travail') as HTMLInputElement;
    expect(name.value).toBe('reboot-wsl');
    await user.clear(name); await user.type(name, 'reprise-wsl');
    await user.type(goal, ' et comparer');
    expect(name.value).toBe('reprise-wsl');
    await screen.findByText('Recommandé par Ledge');
    await user.click(screen.getByRole('button', { name: /^Lancer le rig/ }));
    expect(last('rig.prepare')?.where).toEqual({ kind: 'off-project', name: 'reprise-wsl' });
  });

  it('nom « ../x » : « Nom invalide » sous le champ, rien envoyé', async () => {
    show({ wanted: { goal: 'Explorer un dépôt inconnu' } });
    await screen.findByText('Recommandé par Ledge');
    const name = screen.getByLabelText('Espace de travail');
    await user.clear(name); await user.type(name, '../x');
    expect(screen.getByText('Nom invalide')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^Lancer le rig/ }));
    await user.click(screen.getByRole('button', { name: 'Voir le plan' }));
    expect(last('rig.prepare')).toBeUndefined();
  });

  it('machine distante sans OpenRig : puce désactivée avec la raison', async () => {
    show({ wanted: { goal: 'Explorer un dépôt inconnu' }, machines: [LOCAL, EC2], openrig: [RUNNING, ABSENT] });
    const ec2 = screen.getByRole('radio', { name: /EC2/ }) as HTMLInputElement;
    expect(ec2.disabled).toBe(true);
    expect(screen.getByText('OpenRig n’est pas installé sur EC2')).toBeTruthy();
    expect(screen.getByText('npm i -g @openrig/cli')).toBeTruthy();
    expect((screen.getByRole('radio', { name: /Local/ }) as HTMLInputElement).disabled).toBe(false);
  });

  it('pendant le lancement, « Retour » est inactif : le rig lancé ferme quand même la fenêtre sur Rigs › En cours', async () => {
    show({ wanted: { project: 'ledge', goal: 'Corriger les tests qui échouent' } });
    await screen.findByText('Recommandé par Ledge');
    await user.click(screen.getByRole('button', { name: 'Voir le plan' }));
    const prepare = last('rig.prepare')!;
    answer({ type: 'rig.plan', rid: prepare.rid, plan: planFor(prepare) });
    await screen.findByRole('heading', { name: 'Plan du rig starter' });
    await user.click(screen.getByRole('button', { name: /^Lancer le rig/ }));
    const back = screen.getByRole('button', { name: 'Retour' });
    expect(back.getAttribute('aria-disabled')).toBe('true');
    await user.click(back);
    expect(screen.getByRole('heading', { name: 'Plan du rig starter' })).toBeTruthy();
    answer({ type: 'rig.result', rid: last('rig.launch')!.rid, ok: true });
    await waitFor(() => expect(closed).toBe(1));
    expect(dispatched).toContainEqual({ type: 'ledge', tab: 'rigs', rigs: 'live' });
  });

  it('refus « plan already launched » : dit dans la fenêtre, à l’étape du plan', async () => {
    show({ wanted: { project: 'ledge', goal: 'Corriger les tests qui échouent' } });
    await screen.findByText('Recommandé par Ledge');
    await user.click(screen.getByRole('button', { name: 'Voir le plan' }));
    const prepare = last('rig.prepare')!;
    answer({ type: 'rig.plan', rid: prepare.rid, plan: planFor(prepare) });
    await screen.findByRole('heading', { name: 'Plan du rig starter' });
    await user.click(screen.getByRole('button', { name: /^Lancer le rig/ }));
    answer({ type: 'rig.result', rid: last('rig.launch')!.rid, ok: false, code: 'failed', reason: 'plan already launched' });
    expect(await screen.findByText(/plan already launched/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Plan du rig starter' })).toBeTruthy();
    expect(closed).toBe(0);
    // A failed launch keeps the plan taken: trying again makes a new plan, never resends the old one.
    const before = sent.filter(m => m.type === 'rig.prepare').length;
    await user.click(screen.getByRole('button', { name: /^Lancer le rig/ }));
    expect(sent.filter(m => m.type === 'rig.prepare')).toHaveLength(before + 1);
    expect(sent.filter(m => m.type === 'rig.launch')).toHaveLength(1);
  });
});
