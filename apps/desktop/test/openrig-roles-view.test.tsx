import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DaemonClient, MachineState } from '@ledge/fleet';
import type { ClientMessage, OpenRigState, RoleDetail, ServerMessage } from '@ledge/protocol';
import { LangProvider } from '../src/i18n/lang';
import { OpenRigPage } from '../src/openrig/OpenRigPage';
import { forgetRoleFiles } from '../src/openrig/roles/bits';
import { DEVELOPER, FILES, ROLES } from './openrig-roles-fixture';

afterEach(() => { cleanup(); forgetRoleFiles(); });

/** A client whose daemon answers the roles from the fixture (and `roleError` / `listError` when given). */
function fake(o: { listError?: string; details?: Record<string, RoleDetail>; state?: OpenRigState } = {}) {
  const listeners = new Set<(m: ServerMessage) => void>(), sent: ClientMessage[] = [];
  const emit = (m: ServerMessage) => queueMicrotask(() => act(() => listeners.forEach(f => f(m))));
  const client = {
    send: (m: ClientMessage) => {
      sent.push(m);
      if (m.type === 'openrig.roles') emit({ type: 'openrig.roleList', requestId: m.requestId, machineId: 'local', roles: o.listError ? [] : ROLES, openrigVersion: '0.7.7', ...(o.listError ? { error: o.listError } : {}) });
      if (m.type === 'openrig.role') { const d = (o.details ?? { u1: DEVELOPER })[m.roleId]; emit({ type: 'openrig.roleDetail', requestId: m.requestId, machineId: 'local', roleId: m.roleId, ...(d ? { role: d } : { error: 'role_not_found' }) }); }
      if (m.type === 'openrig.roleFile') emit({ type: 'openrig.roleFileContent', requestId: m.requestId, machineId: 'local', roleId: m.roleId, path: m.path, ...(FILES[m.path] !== undefined ? { content: FILES[m.path], size: FILES[m.path]!.length } : { error: 'missing' }) });
      if (m.type === 'openrig.status' && o.state) emit({ type: 'openrig.state', requestId: m.requestId, machineId: 'local', state: o.state });
    },
    onMessage: (f: (m: ServerMessage) => void) => { listeners.add(f); return () => { listeners.delete(f); }; }
  } as unknown as DaemonClient;
  return { client, sent };
}
const MACHINES = [{ id: 'local', label: 'Local', ready: true, status: 'open', recents: [], sessions: [], launcher: null }] as unknown as MachineState[];
const mount = (client: DaemonClient, props: { role?: string; seat?: string; section?: 'rigs' | 'roles' } = {}, dispatch = vi.fn()) =>
  render(<LangProvider lang="fr"><OpenRigPage client={client} machines={MACHINES} section="roles" {...props} dispatch={dispatch} /></LangProvider>);

describe('the Roles view', () => {
  it('lists the machine’s roles, opens the first one on its role.md, read-only', async () => {
    const f = fake();
    mount(f.client);
    expect(await screen.findByRole('option', { name: /ledge-developer/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: /Rôles/ })).toHaveTextContent('Rôles5');
    expect(screen.getByText('Lecture seule')).toBeInTheDocument();
    // OpenRig's roles are folded under their group.
    expect(screen.queryByRole('option', { name: /^pm/ })).toBeNull();
    expect(screen.getByRole('tab', { name: /Rôle/, selected: true })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Rôle : développeur de ledge-dev' })).toBeInTheDocument();
    expect(screen.getByText('Les consignes du rôle')).toBeInTheDocument();
    expect(screen.getByText('tapé dans le terminal')).toBeInTheDocument();
    expect(screen.getByText(/= dépôt ~\/Workspace\/ledge\/openrig\/agents\/developer\/agent.yaml · identique/)).toBeInTheDocument();
    // Read-only: no button changes a spec.
    expect(screen.queryByRole('button', { name: /Modifier|Enregistrer|Supprimer/ })).toBeNull();
  });

  it('marks each parameter with its provenance: here, inherited, not declared, unknown', async () => {
    const f = fake();
    mount(f.client, { role: 'u1' });
    await userEvent.click(await screen.findByRole('tab', { name: 'Paramètres' }));
    const model = screen.getByText('Modèle').closest('.orr-row')!;
    expect(model).toHaveClass('orr-abs');
    expect(model).toHaveTextContent('Le rôle ne fixe pas de modèle.');
    expect(model).toHaveTextContent('Ses sièges aujourd’hui : claude-opus-5-5 (dev.front, dev.back)');
    // A list written empty is « vide », one not written is « non déclaré ».
    expect(screen.getByText('Sous-agents').closest('.orr-row')).toHaveTextContent('vide');
    expect(screen.getByText('Guidance').closest('.orr-row')).toHaveClass('orr-abs');
    expect(screen.getByText('Plugins').closest('.orr-row')).toHaveTextContent('hérité · import shared');
    expect(screen.getByText('Réglages effectifs après fusion').closest('.orr-sub')).toHaveTextContent('inconnu · non exposé par OpenRig');
    await userEvent.click(screen.getByRole('button', { name: 'Voir le fragment' }));
    expect(await screen.findByText('{ "mcpServers": {} }')).toBeInTheDocument();
  });

  it('seen from a seat: what OpenRig resolved, the seat’s own file after role.md', async () => {
    const f = fake();
    const dispatch = vi.fn();
    mount(f.client, { role: 'u1', seat: 'ledge-dev/dev.front' }, dispatch);
    expect(await screen.findByRole('button', { name: 'depuis dev.front' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Ce qu’OpenRig a résolu au lancement de dev-front@ledge-dev (OpenRig 0.7.7).')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Ton périmètre : front-end' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'guidance/scope-front.md' }).closest('article')).toHaveTextContent('hérité · membre dev.front');
    await userEvent.click(screen.getByRole('button', { name: 'selon la spec' }));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'openrig', section: 'roles', role: 'u1' });
  });

  it('the startup context: no single prompt, OpenRig’s order, the harness and a missing block said as such', async () => {
    const f = fake();
    mount(f.client, { role: 'u1', seat: 'ledge-dev/dev.front' });
    await userEvent.click(await screen.findByRole('tab', { name: /Contexte de démarrage/ }));
    expect(screen.getByText('Il n’y a pas de prompt système unique.')).toBeInTheDocument();
    const list = screen.getByRole('listbox', { name: 'Pièces du contexte de démarrage' });
    expect(within(list).getAllByRole('option').map(o => o.querySelector('.orr-t')!.firstChild!.textContent)).toEqual(['Prompt de base du harnais', 'Rôle', 'Culture OpenRig par défaut', 'Périmètre du siège', 'Skills du siège', 'Identité du siège']);
    await userEvent.click(within(list).getByRole('option', { name: /Prompt de base/ }));
    expect(screen.getByText('Non lisible depuis Ledge')).toBeInTheDocument();
    await userEvent.click(within(list).getByRole('option', { name: /Skills du siège/ }));
    expect(screen.getByText('Prévue, mais pas trouvée')).toBeInTheDocument();
    // ↓ moves to the next piece.
    await userEvent.keyboard('{ArrowDown}');
    expect(within(list).getByRole('option', { name: /Identité du siège/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/OpenRig session identity:/)).toBeInTheDocument();
    expect(screen.getByText(/Pas montré ici/)).toBeInTheDocument();
  });

  it('YAML source: the file as is, its import and the seat’s member block', async () => {
    const f = fake();
    mount(f.client, { role: 'u1', seat: 'ledge-dev/dev.front' });
    await userEvent.click(await screen.findByRole('tab', { name: 'YAML source' }));
    const panel = screen.getByRole('tabpanel');
    expect(await within(panel).findByText('ledge-developer')).toHaveClass('orr-v');
    expect(within(panel).getByText(/Membre dev.front dans ~?\/home\/u\/.ledge\/rigs\/ledge-dev\/rig.yaml/)).toBeInTheDocument();
    expect(await within(panel).findByText('shared')).toHaveClass('orr-v');
  });

  it('←/→ moves across the tabs; the search narrows the list and says when nothing matches', async () => {
    const f = fake();
    mount(f.client, { role: 'u1' });
    const role = await screen.findByRole('tab', { name: /Rôle/ });
    role.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Paramètres' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.type(screen.getByLabelText('Chercher un rôle'), 'terraform');
    expect(screen.getByRole('option', { name: /^pm/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /ledge-developer/ })).toBeNull();
    await userEvent.type(screen.getByLabelText('Chercher un rôle'), 'zz');
    expect(screen.getByText('Aucun rôle ne contient « terraformzz »')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Effacer la recherche' }));
    expect(screen.getByRole('option', { name: /ledge-developer/ })).toBeInTheDocument();
  });

  it('states: the daemon stopped sends to Rigs; an invalid spec says where', async () => {
    const stopped = fake({ listError: 'daemon_stopped' });
    const dispatch = vi.fn();
    mount(stopped.client, {}, dispatch);
    expect(await screen.findByText('Le daemon OpenRig est arrêté sur Local')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Aller à Rigs' }));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'openrig', section: 'rigs' });
    cleanup();
    const invalid = fake({ details: { u1: { ...DEVELOPER, error: { kind: 'invalid', message: 'indentation inattendue', line: 4, col: 3 }, profiles: [], seats: [] } } });
    mount(invalid.client, { role: 'u1' });
    expect(await screen.findByText('agent.yaml ne se lit pas : ligne 4, colonne 3 — indentation inattendue')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'YAML source' }));
    expect((await screen.findByText('defaults')).closest('.orr-line')).toHaveClass('orr-hl');
  });

  it('on the Rigs page, a seat’s role is a link to that role seen from the seat', async () => {
    const seat = { logicalId: 'dev.front', session: 'dev-front@ledge-dev', runtime: 'claude-code', model: 'claude-opus-5-5', sessionStatus: 'running', lifecycleState: 'running', activity: 'running', stopped: false, work: 0 };
    const state: OpenRigState = { installed: true, version: '0.7.7', daemon: { state: 'running', pid: 1, port: 7433 }, kernel: { state: 'ready' }, at: new Date().toISOString(),
      rigs: [{ id: 'r1', name: 'ledge-dev', status: 'running', lifecycleState: 'running', seats: 1, running: 1, attention: 0, uptime: null, snapshot: null, nodes: [seat] }] };
    const f = fake({ state });
    const dispatch = vi.fn();
    mount(f.client, { section: 'rigs' }, dispatch);
    await userEvent.click(await screen.findByRole('button', { name: 'Voir les sièges de ledge-dev' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Voir le rôle ledge-developer depuis dev.front' }));
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'openrig', section: 'roles', role: 'u1', seat: 'ledge-dev/dev.front' });
  });
});
