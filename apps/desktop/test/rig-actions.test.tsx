import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReducer } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ClientMessage, OpenRigStatus, Projects, Rig, RigSeat, ServerMessage, Session } from '@ledge/protocol';
import { forgetRigSpecs, type DaemonClient } from '@ledge/fleet';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { LangProvider } from '../src/i18n/lang';
import { RigsTab } from '../src/rigs/RigsTab';
import { useRigControlsHost } from '../src/rigs/StopRig';
import { RigControlsContext } from '../src/rigs/useRigActions';
import { SessionMenu } from '../src/manage/SessionMenu';
import type { SessionActions } from '../src/manage/useSessionActions';
import type { Filing } from '../src/atelier/filing';
import { initialNav, navReducer } from '../src/nav/state';

const PROJECTS: Projects = { projects: [{ id: 'ledge', name: 'Ledge', color: 'blue', description: '', rigs: [], repos: [{ machine: 'local', path: '/w/ledge' }] }], rules: [] };
const seat = (name: string, extra: Partial<RigSeat> = {}): RigSeat => ({ ref: `${name}@factory`, address: `@${name}`, name, runtime: 'claude-code', model: 'opus', state: 'working', ...extra });
const FACTORY: Rig = { id: 'r1', name: 'factory', machine: 'local', spec: 'factory', cwd: '/w/ledge', projectId: 'ledge', offProject: false, branch: 'feat/rigs', lifecycle: 'running', kernel: false, repos: [],
  seats: [seat('orch-lead', { address: '@lead' }), seat('dev-build', { address: '@build', sessionId: 'local:build' }), seat('qa', { state: 'ready' })] };
const LAUNCHING: Rig = { ...FACTORY, lifecycle: 'launching',
  launch: { planId: 'p1', goal: 'Reprise après reboot', lead: 'orch-lead@factory', startedAt: '2026-10-31T10:00:00.000Z' },
  seats: [seat('orch-lead', { address: '@lead', state: 'ready' }), seat('advisor', { state: 'ready' }), seat('build', { state: 'ready' }), seat('review-a', { state: 'ready' }),
    seat('review-b', { state: 'starting' }), seat('qa', { state: 'starting' }), seat('design', { state: 'trust' })] };
const RUNNING: OpenRigStatus = { machine: 'local', state: 'running', version: '0.6.14', human: 'registered' };
const STATUSES = [RUNNING];
const paired = fakeSession('local:build', { name: 'dev-build', cwd: '/w/ledge', state: 'working', machineId: 'local', source: 'hook_only',
  rig: { machine: 'local', rigId: 'r1', rigName: 'factory', seat: 'dev-build@factory', pod: 'dev', member: 'build' } });

let sent: ClientMessage[] = [];
let notified: string[] = [];
let refuse: { code: 'failed' | 'openrig_down'; reason: string } | null = null;
const user = userEvent.setup();

function clientOf(rigs: Rig[], seatTerminal = vi.fn(() => null)): DaemonClient {
  const listeners = new Set<(m: ServerMessage) => void>();
  const emit = (m: ServerMessage) => queueMicrotask(() => { for (const l of [...listeners]) l(m); });
  return {
    send(m: ClientMessage) {
      sent.push(m);
      if (m.type === 'rig.act' || m.type === 'rig.adopt') emit(refuse ? { type: 'rig.result', rid: m.rid, ok: false, ...refuse } : { type: 'rig.result', rid: m.rid, ok: true });
      if (m.type === 'rig.specs.request') emit({ type: 'rig.specs', requestId: m.requestId, machine: 'local', specs: [] });
    },
    onMessage(fn: (m: ServerMessage) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    fleet: { subscribe: () => () => {}, rigs: () => rigs, openrig: () => STATUSES, escalations: () => [], seatTerminal, onMachineMessage: () => () => {} }
  } as unknown as DaemonClient;
}

function Harness({ client, rigs, sessions = [paired] }: { client: DaemonClient; rigs: Rig[]; sessions?: Session[] }) {
  const [nav, apply] = useReducer(navReducer, undefined, () => {
    const n = initialNav({ view: 'atelier', helpers: true, paused: true });
    return { ...n, place: { kind: 'home' as const, tab: 'rigs' as const, view: 'atelier' as const, project: 'all' } };
  });
  const host = useRigControlsHost({ client, notify: t => { notified.push(t); }, rigs, dispatch: apply });
  return (
    <RigControlsContext.Provider value={host.controls}>
      <RigsTab nav={nav} dispatch={apply} client={client} sessions={sessions} projects={PROJECTS} notify={t => { notified.push(t); }} />
      {host.dialog}
    </RigControlsContext.Provider>
  );
}

function renderTab(rigs: Rig[], client = clientOf(rigs)) {
  return render(<LangProvider lang="fr"><Harness client={client} rigs={rigs} /></LangProvider>);
}
const card = (name: string) => screen.getByRole('article', { name });
const acts = () => sent.filter(m => m.type === 'rig.act');

beforeEach(() => { sent = []; notified = []; refuse = null; forgetRigSpecs(); localStorage.clear(); });
afterEach(() => cleanup());

describe('actions on rigs and seats', () => {
  it('« Arrêter… » puis « Arrêter le rig » → rig.act down r1', async () => {
    renderTab([FACTORY]);
    await user.click(within(card('factory')).getByRole('button', { name: 'Arrêter…' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Arrêter factory ?' });
    expect(dialog).toHaveTextContent('Ses 3 sièges s’arrêtent. OpenRig garde un instantané pour le reprendre. Les fichiers restent.');
    expect(within(dialog).queryByRole('button', { name: 'Seulement ce siège' })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Arrêter le rig' }));
    expect(acts()).toEqual([expect.objectContaining({ type: 'rig.act', machine: 'local', verb: 'down', rigId: 'r1' })]);
    expect(acts()[0]).not.toHaveProperty('seatRef');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('depuis un siège : « Seulement ce siège » → rig.act stop dev-build@factory', async () => {
    renderTab([FACTORY]);
    const line = within(card('factory')).getByText('dev-build').closest('[data-seat]') as HTMLElement;
    await user.click(within(line).getByRole('button', { name: 'Actions de dev-build' }));
    const menu = screen.getByRole('menu', { name: 'Actions de dev-build' });
    expect(within(menu).getAllByRole('menuitem').map(i => i.textContent)).toEqual(['Relancer ce siège', 'Relève', 'Arrêter…']);
    await user.click(within(menu).getByRole('menuitem', { name: 'Arrêter…' }));
    await user.click(within(screen.getByRole('alertdialog', { name: 'Arrêter factory ?' })).getByRole('button', { name: 'Seulement ce siège' }));
    expect(acts()).toEqual([expect.objectContaining({ machine: 'local', verb: 'stop', rigId: 'r1', seatRef: 'dev-build@factory' })]);
    // « Relancer ce siège » and « Relève » act at once.
    await user.click(within(line).getByRole('button', { name: 'Actions de dev-build' }));
    await user.click(screen.getByRole('menuitem', { name: 'Relève' }));
    expect(acts()[1]).toMatchObject({ verb: 'handover', seatRef: 'dev-build@factory' });
  });

  it('« Annuler » n’envoie rien et rend le focus', async () => {
    renderTab([FACTORY]);
    const stop = within(card('factory')).getByRole('button', { name: 'Arrêter…' });
    await user.click(stop);
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: 'Annuler' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(acts()).toEqual([]);
    expect(stop).toHaveFocus();
  });

  it('lancement : « 4/7 prêts », « Annuler le lancement » → down, « Ouvrir l’invite » ouvre le terminal de design sans rien envoyer', async () => {
    const seatTerminal = vi.fn(() => null);
    renderTab([LAUNCHING], clientOf([LAUNCHING], seatTerminal));
    const factory = within(card('factory'));
    expect(card('factory')).toHaveTextContent('rig · démarre · dans Ledge');
    expect(factory.getByText('4/7 prêts')).toBeVisible();
    expect(factory.queryByRole('button', { name: 'Arrêter…' })).toBeNull();
    expect(card('factory')).toHaveTextContent('Le but attend : je le donne à orch-lead dès que les 7 sièges sont prêts.');
    expect(card('factory')).toHaveTextContent('design attend ta confiance dans le dossier, je ne réponds pas à sa place.');
    const design = factory.getByText('design').closest('[data-seat]') as HTMLElement;
    await user.click(within(design).getByRole('button', { name: 'Ouvrir l’invite' }));
    await vi.waitFor(() => expect(seatTerminal).toHaveBeenCalledWith('local', 'design@factory'));
    expect(sent.filter(m => m.type.startsWith('rig.') && m.type !== 'rig.specs.request')).toEqual([]);
    await user.click(factory.getByRole('button', { name: 'Annuler le lancement' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(acts()).toEqual([expect.objectContaining({ verb: 'down', rigId: 'r1', machine: 'local' })]);
  });

  it('menu d’un siège : ni Terminer ni Supprimer, mais Relancer ce siège', async () => {
    const client = clientOf([FACTORY]);
    const request = vi.fn();
    const actions = { request, resume: vi.fn(), restore: vi.fn(), pending: null, confirm: vi.fn(), cancel: vi.fn(), allowed: () => true } as SessionActions;
    function Menu() {
      const host = useRigControlsHost({ client, notify: t => { notified.push(t); }, rigs: [FACTORY], dispatch: () => {} });
      return (
        <RigControlsContext.Provider value={host.controls}>
          <SessionMenu session={paired} at={{ x: 0, y: 0 }} actions={actions} filing={{ file: vi.fn() } as unknown as Filing} projects={PROJECTS.projects} current="ledge"
            onOpen={() => {}} onTerminal={() => {}} onRename={() => {}} onClose={() => {}} />
          {host.dialog}
        </RigControlsContext.Provider>
      );
    }
    render(<LangProvider lang="fr"><Menu /></LangProvider>);
    const menu = screen.getByRole('menu');
    const labels = within(menu).getAllByRole('menuitem').map(i => i.getAttribute('aria-label') ?? i.textContent);
    expect(labels).not.toContain('Terminer');
    expect(labels).not.toContain('Archiver');
    expect(labels).not.toContain('Supprimer');
    expect(labels).toEqual(expect.arrayContaining(['Relancer ce siège', 'Relève', 'Arrêter…']));
    await user.click(within(menu).getByRole('menuitem', { name: 'Relancer ce siège' }));
    expect(acts()).toEqual([expect.objectContaining({ machine: 'local', verb: 'restart', rigId: 'r1', seatRef: 'dev-build@factory' })]);
    expect(request).not.toHaveBeenCalled();
    expect(sent.filter(m => m.type.startsWith('session.'))).toEqual([]);
  });

  it('refus rig.result failed → toast avec la raison', async () => {
    refuse = { code: 'failed', reason: 'seat not found' };
    renderTab([{ ...FACTORY, lifecycle: 'stopped' }]);
    await user.click(within(card('factory')).getByRole('button', { name: 'Reprendre' }));
    expect(acts()).toEqual([expect.objectContaining({ verb: 'up', rigId: 'r1' })]);
    await vi.waitFor(() => expect(notified).toEqual([expect.stringContaining('seat not found')]));
    refuse = { code: 'openrig_down', reason: 'connect ECONNREFUSED' };
    await user.click(within(card('factory')).getByRole('button', { name: 'Plus d’actions pour factory' }));
    await user.click(screen.getByRole('menuitem', { name: 'Reprendre depuis le dernier instantané' }));
    expect(acts()[1]).toMatchObject({ verb: 'restore', rigId: 'r1' });
    await vi.waitFor(() => expect(notified[1]).toBe('OpenRig ne répond pas sur local'));
  });
});
