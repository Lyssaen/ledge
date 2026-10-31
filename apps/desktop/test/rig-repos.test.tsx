import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReducer } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ClientMessage, OpenRigStatus, Projects, Rig, RigRepo, ServerMessage } from '@ledge/protocol';
import { forgetRigSpecs, type DaemonClient } from '@ledge/fleet';
import { LangProvider } from '../src/i18n/lang';
import { RigsTab } from '../src/rigs/RigsTab';
import { useRigControlsHost } from '../src/rigs/StopRig';
import { RigControlsContext } from '../src/rigs/useRigActions';
import { proposeProject } from '../src/rigs/proposal';
import { initialNav, navReducer } from '../src/nav/state';

const PROJECTS: Projects = { projects: [
  { id: 'ledge', name: 'Ledge', color: 'blue', description: '', rigs: [], repos: [{ machine: 'local', path: '/w/ledge' }] },
  { id: 'website', name: 'Website', color: 'green', description: '', rigs: [], repos: [{ machine: 'local', path: '/w/website' }] }
], rules: [] };
const repo = (name: string, extra: Partial<RigRepo> = {}): RigRepo => ({ path: `/home/u/.ledge/rigs/factory/${name}`, name, modified: 0, ...extra });
const rigWith = (repos: RigRepo[], extra: Partial<Rig> = {}): Rig => ({ id: 'r1', name: 'factory', machine: 'local', cwd: '/home/u/.ledge/rigs/factory', projectId: null, offProject: true,
  lifecycle: 'running', kernel: false, repos, seats: [{ ref: 'build@factory', address: '@build', name: 'build', runtime: 'claude-code', state: 'working' }], ...extra });
const THREE = [repo('ledge', { branch: 'feat/rigs', how: 'cloned', by: 'build', modified: 9, remote: 'git@x:ledge.git' }), repo('notes', { how: 'opened', by: 'advisor' }), repo('sketch', { how: 'created', by: 'design' })];
const STATUSES: OpenRigStatus[] = [{ machine: 'local', state: 'running', version: '0.6.14', human: 'registered' }];

describe('proposeProject', () => {
  it('seul ledge est modifié → Ledge (only-modified)', () => {
    expect(proposeProject(rigWith(THREE), PROJECTS)).toEqual({ projectId: 'ledge', why: 'only-modified' });
  });
  it('un seul projet porte le nom d’un dépôt trouvé → name', () => {
    expect(proposeProject(rigWith([repo('website'), repo('ledge', { modified: 2 }), repo('notes', { modified: 1 })]), PROJECTS)).toBeNull();
    expect(proposeProject(rigWith([repo('website'), repo('notes')]), PROJECTS)).toEqual({ projectId: 'website', why: 'name' });
  });
  it('deux dépôts modifiés → aucune proposition ; aucun nom connu → null', () => {
    expect(proposeProject(rigWith([repo('ledge', { modified: 3 }), repo('website', { modified: 1 })]), PROJECTS)).toBeNull();
    expect(proposeProject(rigWith([repo('notes', { modified: 3 })]), PROJECTS)).toBeNull();
    expect(proposeProject(rigWith([]), PROJECTS)).toBeNull();
  });
  it('compare les noms de dossier (basename), pas les chemins entiers', () => {
    const p: Projects = { projects: [{ ...PROJECTS.projects[0]!, repos: [{ machine: 'local', path: 'C:\\code\\ledge\\' }] }], rules: [] };
    expect(proposeProject(rigWith([repo('ledge', { modified: 1 })]), p)).toEqual({ projectId: 'ledge', why: 'only-modified' });
  });
});

let sent: ClientMessage[] = [];
const user = userEvent.setup();

function clientOf(rigs: Rig[]): DaemonClient {
  const listeners = new Set<(m: ServerMessage) => void>();
  const emit = (m: ServerMessage) => queueMicrotask(() => { for (const l of [...listeners]) l(m); });
  return {
    send(m: ClientMessage) {
      sent.push(m);
      if (m.type === 'rig.adopt') emit({ type: 'rig.result', rid: m.rid, ok: true });
      if (m.type === 'rig.specs.request') emit({ type: 'rig.specs', requestId: m.requestId, machine: 'local', specs: [] });
    },
    onMessage(fn: (m: ServerMessage) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    fleet: { subscribe: () => () => {}, rigs: () => rigs, openrig: () => STATUSES, escalations: () => [], seatTerminal: vi.fn(() => null), onMachineMessage: () => () => {} }
  } as unknown as DaemonClient;
}

function Harness({ client, rigs }: { client: DaemonClient; rigs: Rig[] }) {
  const [nav, apply] = useReducer(navReducer, undefined, () => {
    const n = initialNav({ view: 'atelier', helpers: true, paused: true });
    return { ...n, place: { kind: 'home' as const, tab: 'rigs' as const, view: 'atelier' as const, project: 'all' } };
  });
  const host = useRigControlsHost({ client, notify: () => {}, rigs, projects: PROJECTS, dispatch: apply });
  return (
    <RigControlsContext.Provider value={host.controls}>
      <RigsTab nav={nav} dispatch={apply} client={client} sessions={[]} projects={PROJECTS} />
      {host.dialog}
    </RigControlsContext.Provider>
  );
}
const renderTab = (rigs: Rig[]) => render(<LangProvider lang="fr"><Harness client={clientOf(rigs)} rigs={rigs} /></LangProvider>);
const card = () => screen.getByRole('article', { name: 'factory' });

beforeEach(() => { sent = []; forgetRigSpecs(); localStorage.clear(); });
afterEach(() => cleanup());

describe('Dépôts trouvés', () => {
  it('puces : cloné par build · 9 fichiers modifiés, lu par advisor, créé par design · pas encore de dépôt distant', () => {
    renderTab([rigWith(THREE)]);
    const c = card();
    expect(within(c).getByText('Dépôts trouvés · 3')).toBeInTheDocument();
    expect(within(c).getByText('ce que le rig a cloné ou ouvert')).toBeInTheDocument();
    expect(within(c).getByText('ledge ⎇ feat/rigs · cloné par build · 9 fichiers modifiés')).toBeInTheDocument();
    expect(within(c).getByText('notes · lu par advisor')).toBeInTheDocument();
    expect(within(c).getByText('sketch · créé par design · pas encore de dépôt distant')).toBeInTheDocument();
  });

  it('la ligne de Ledge propose Ledge ; « Ranger dans Ledge » → rig.adopt r1 ledge, puis la proposition disparaît', async () => {
    const { rerender } = renderTab([rigWith(THREE)]);
    expect(card()).toHaveTextContent('Je propose de ranger factory dans Ledge : c’est le seul dépôt modifié. Je ne déplace rien sans toi.');
    await user.click(within(card()).getByRole('button', { name: 'Ranger dans Ledge' }));
    expect(sent.filter(m => m.type === 'rig.adopt')).toEqual([expect.objectContaining({ type: 'rig.adopt', machine: 'local', rigId: 'r1', projectId: 'ledge' })]);
    const adopted = rigWith(THREE, { projectId: 'ledge' });
    rerender(<LangProvider lang="fr"><Harness client={clientOf([adopted])} rigs={[adopted]} /></LangProvider>);
    expect(card()).toHaveTextContent('dans Ledge');
    expect(within(card()).queryByText(/Je propose de ranger/)).toBeNull();
    expect(within(card()).queryByRole('button', { name: 'Ranger dans un projet…' })).toBeNull();
  });

  it('deux dépôts modifiés → pas de proposition, « Ranger dans un projet… » reste ; le dialogue range dans le projet choisi', async () => {
    renderTab([rigWith([repo('ledge', { modified: 3, how: 'cloned', by: 'build' }), repo('website', { modified: 1, how: 'cloned', by: 'build' })])]);
    expect(within(card()).queryByText(/Je propose/)).toBeNull();
    await user.click(within(card()).getByRole('button', { name: 'Ranger dans un projet…' }));
    const dialog = screen.getByRole('dialog', { name: 'Ranger factory dans un projet' });
    expect(within(dialog).getByRole('button', { name: 'Ranger' })).toBeDisabled();
    await user.click(within(dialog).getByRole('radio', { name: /Website/ }));
    expect(dialog).toHaveTextContent('Le rig garde sa pièce et ses fichiers ; sa plaque dira « dans Website ».');
    await user.click(within(dialog).getByRole('button', { name: 'Ranger' }));
    expect(sent.filter(m => m.type === 'rig.adopt')).toEqual([expect.objectContaining({ rigId: 'r1', projectId: 'website' })]);
  });

  it('le dialogue présélectionne le projet proposé ; « Annuler » ne range rien', async () => {
    renderTab([rigWith(THREE)]);
    await user.click(within(card()).getByRole('button', { name: 'Ranger dans un projet…' }));
    const dialog = screen.getByRole('dialog', { name: 'Ranger factory dans un projet' });
    expect(within(dialog).getByRole('radio', { name: /Ledge/ })).toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sent.filter(m => m.type === 'rig.adopt')).toEqual([]);
  });

  it('sans dépôt : « Aucun dépôt trouvé pour l’instant. Je regarde toutes les 30 s. »', () => {
    renderTab([rigWith([])]);
    expect(card()).toHaveTextContent('Aucun dépôt trouvé pour l’instant. Je regarde toutes les 30 s.');
  });

  it('un rig rangé ou dans un projet n’a pas de bloc de dépôts', () => {
    renderTab([rigWith(THREE, { projectId: 'ledge' })]);
    expect(within(card()).queryByText(/Dépôts trouvés/)).toBeNull();
  });
});
