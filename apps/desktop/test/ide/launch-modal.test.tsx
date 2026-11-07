import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import type { DaemonClient, MachineState } from '@ledge/fleet';
import type { ClientMessage, ServerMessage } from '@ledge/protocol';
import { LangProvider } from '../../src/i18n/lang';
import { LaunchModal } from '../../src/launch/LaunchModal';
import { LaunchModalPlace, loadComposer } from '../../src/launch/lazy';
import type { UsageGroup } from '../../src/usage/model';
import { machine } from '../fleet-helpers';
import { LAUNCH_PROJECTS } from '../helpers';

beforeEach(() => localStorage.clear());

function fakeClient() {
  const sent: ClientMessage[] = [];
  const fns = new Set<(m: ServerMessage) => void>();
  const client = { send: (m: ClientMessage) => { sent.push(m); }, onMessage: (fn: (m: ServerMessage) => void) => { fns.add(fn); return () => { fns.delete(fn); }; } } as unknown as DaemonClient;
  return { client, sent, emit: (m: ServerMessage) => fns.forEach(fn => fn(m)) };
}
const down = (m: MachineState): MachineState => ({ ...m, status: 'unreachable', ready: false });
const soon = new Date(Date.now() + 3_600_000).toISOString();
const groups: UsageGroup[] = [{ key: 'c', harness: 'claude', machines: ['local'], status: 'ok', readAt: null, windows: [{ kind: 'five_hour', pct: 84, resetsAt: soon }] }];
type Props = ComponentProps<typeof LaunchModal>;
const props = (over: Partial<Props> = {}): Props => ({
  client: fakeClient().client, projects: LAUNCH_PROJECTS.projects, machines: [machine('local'), down(machine('nas'))], sessions: [], projectIdOf: () => null,
  wanted: {}, usage: { groups, threshold: 0.8 }, where: 'active', launch: { status: 'idle' }, onLaunch: vi.fn(), onNewProject: vi.fn(), onCancel: vi.fn(), ...over
});
const ui = (p: Props) => <LangProvider lang="fr"><LaunchModal {...p} /></LangProvider>;
const labels = () => [...document.querySelectorAll('.launch-modal-fld > .launch-modal-lbl')].map(l => l.textContent);
const projectButton = () => screen.getByRole('button', { name: /^Projet / });
const ctrlEnter = '{Control>}{Enter}{/Control}';

describe('LaunchModal', () => {
  it('the mockup’s fields in order; Permissions only for omp, with its three modes', async () => {
    const user = userEvent.setup();
    const local = machine('local', { daemon: { version: '0.50.0', install: 'npm', systemd: true, models: true, omp: true, ompApproval: true } });
    render(ui(props({ machines: [local] })));
    expect(labels()).toEqual(['Projet', 'Où travailler', 'Agent', 'Modèle', 'Premier message', 'Ouvrir']);
    expect(screen.getByRole('textbox', { name: 'Premier message' })).toHaveFocus();
    expect(screen.getByRole('button', { name: /^Claude Code/ })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: /^OMP/ }));
    expect(screen.getByRole('button', { name: /^OMP/ })).toHaveAttribute('aria-pressed', 'true');
    expect(labels()).toEqual(['Projet', 'Où travailler', 'Agent', 'Modèle', 'Permissions', 'Premier message', 'Ouvrir']);
    const modes = within(screen.getByRole('radiogroup', { name: 'Permissions' }));
    expect(modes.getAllByRole('radio').map(r => r.closest('label')!.textContent)).toEqual(['Demander', 'Fichiers auto', 'Auto']);
    expect(screen.getByRole('button', { name: /Lancer/ })).toHaveTextContent('Ctrl Entrée');
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeVisible();
  });

  it('each agent’s 5 h limit on the chosen machine, amber past the threshold; none read says so', () => {
    render(ui(props()));
    const claude = screen.getByRole('button', { name: /^Claude Code/ });
    expect(claude).toHaveTextContent('Anthropic');
    expect(claude).toHaveTextContent(/Limite 5 h 84 % · réinit\. \S/);
    expect(within(claude).getByText('84 %').tagName).toBe('B');
    expect(within(claude).getByText('84 %')).toHaveClass('amber');
    expect(screen.getByRole('button', { name: /^OMP/ })).toHaveTextContent('Limite non lue');
    expect(screen.getByRole('button', { name: /^Codex/ })).toHaveTextContent('OpenAI');
    expect(screen.getByRole('button', { name: /^Cursor/ })).toHaveTextContent('Cursor');
  });

  it('under the threshold the percent is not amber', () => {
    render(ui(props({ usage: { groups, threshold: 0.9 } })));
    expect(within(screen.getByRole('button', { name: /^Claude Code/ })).getByText('84 %')).not.toHaveClass('amber');
  });

  it('« Ouvrir » starts from `where`, its choice changes the help line; « Nouvelle fenêtre » is not offered', async () => {
    const user = userEvent.setup();
    render(ui(props({ where: 'right' })));
    expect(screen.getByText('S’ouvre dans un groupe à droite. Ctrl+Entrée lance, Échap ferme.')).toBeVisible();
    expect(screen.getByRole('radio', { name: 'À droite' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Dans le groupe actif' }));
    expect(screen.getByText('S’ouvre dans le groupe actif. Ctrl+Entrée lance, Échap ferme.')).toBeVisible();
    expect(screen.queryByText(/Nouvelle fenêtre/)).toBeNull();
  });

  it('« Où travailler » says the folder’s branch, the project folder alone while it is unknown', async () => {
    const { client, sent, emit } = fakeClient();
    const { container } = render(ui(props({ client })));
    const where = () => container.querySelector('.launch-modal-txt')!;
    expect(where()).toHaveTextContent(/^Dans le dossier du projet$/);
    const ask = sent.find(m => m.type === 'repos.inspect') as Extract<ClientMessage, { type: 'repos.inspect' }>;
    expect(ask).toMatchObject({ paths: ['/w/ledge/app', '/w/ledge/docs'], machineId: 'local' });
    await act(async () => { emit({ type: 'repos.info', requestId: ask.requestId, repos: [{ path: '/w/ledge/app', exists: true, branch: 'desktop' }, { path: '/w/ledge/docs', exists: true, branch: null }] }); });
    expect(where()).toHaveTextContent(/^Sur ⎇ desktop, dans le dossier du projet$/);
  });

  it('a chosen folder the machine does not find is let go for one it finds', async () => {
    const { client, sent, emit } = fakeClient();
    render(ui(props({ client })));
    const ask = sent.find(m => m.type === 'repos.inspect') as Extract<ClientMessage, { type: 'repos.inspect' }>;
    await act(async () => { emit({ type: 'repos.info', requestId: ask.requestId, repos: [{ path: '/w/ledge/app', exists: false, branch: null }, { path: '/w/ledge/docs', exists: true, branch: 'main' }] }); });
    expect(projectButton()).toHaveTextContent('/w/ledge/docs');
  });

  it('LaunchModalPlace renders the modal from the New session chunk', async () => {
    await loadComposer();
    render(<LangProvider lang="fr"><LaunchModalPlace {...props()} /></LangProvider>);
    expect(screen.getByRole('textbox', { name: 'Premier message' })).toBeVisible();
  });

  it('Ctrl+Entrée sends once, with the row’s folder and where it opens; a launch in flight sends nothing more', async () => {
    const user = userEvent.setup();
    const p = props({ where: 'right' });
    const view = render(ui(p));
    await user.keyboard('Corrige les tests');
    await user.keyboard(ctrlEnter);
    expect(p.onLaunch).toHaveBeenCalledTimes(1);
    const [msg, preview, where] = vi.mocked(p.onLaunch).mock.calls[0]!;
    expect(msg).toMatchObject({ type: 'session.launch', tool: 'claude', cwd: '/w/ledge/app', prompt: 'Corrige les tests', machineId: 'local' });
    expect(preview).toMatchObject({ project: 'Ledge', projectId: 'ledge' });
    expect(where).toBe('right');
    view.rerender(ui({ ...p, launch: { status: 'launching' } }));
    expect(screen.getByRole('button', { name: /Lancement…/ })).toBeVisible();
    await user.keyboard(ctrlEnter);
    expect(p.onLaunch).toHaveBeenCalledTimes(1);
  });

  it('an empty message is named and marked, nothing is sent; Enter alone in the textarea is a newline', async () => {
    const user = userEvent.setup();
    const p = props();
    render(ui(p));
    await user.keyboard(ctrlEnter);
    expect(p.onLaunch).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Premier message' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Écrivez la consigne');
    await user.keyboard('a{Enter}b');
    expect(screen.getByRole('textbox', { name: 'Premier message' })).toHaveValue('a\nb');
    expect(p.onLaunch).not.toHaveBeenCalled();
  });

  it('the Project menu: rows « projet · dossier · machine », an offline one disabled, choosing one moves the folder', async () => {
    const user = userEvent.setup();
    const p = props();
    render(ui(p));
    expect(projectButton()).toHaveTextContent('Ledge· /w/ledge/app · Local');
    await user.click(projectButton());
    const menu = within(screen.getByRole('menu'));
    const offline = menu.getByRole('menuitem', { name: /\/srv\/ledge/ });
    expect(offline).toBeDisabled();
    expect(offline).toHaveTextContent('hors ligne');
    await user.click(menu.getByRole('menuitem', { name: /\/w\/ledge\/docs/ }));
    expect(projectButton()).toHaveTextContent('/w/ledge/docs');
    await user.click(screen.getByRole('textbox', { name: 'Premier message' }));
    await user.keyboard('Go' + ctrlEnter);
    expect(vi.mocked(p.onLaunch).mock.calls[0]![0]).toMatchObject({ cwd: '/w/ledge/docs', machineId: 'local' });
  });

  it('the chosen machine going offline moves the form to a row online, in the same project first', async () => {
    const user = userEvent.setup();
    const p = props({ machines: [machine('local'), machine('nas')] });
    const view = render(ui(p));
    await user.click(projectButton());
    await user.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: /\/srv\/ledge/ }));
    expect(projectButton()).toHaveTextContent('Ledge· /srv/ledge · Nas');
    view.rerender(ui({ ...p, machines: [machine('local'), down(machine('nas'))] }));
    expect(projectButton()).toHaveTextContent('Ledge· /w/ledge/app · Local');
  });

  it('Escape with the Project menu open closes the menu only, not the modal', async () => {
    const user = userEvent.setup();
    const p = props();
    // The app's global keys (routeNav 'escape') close the Modal: played here by a window listener.
    const global = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onCancel(); };
    window.addEventListener('keydown', global);
    try {
      render(ui(p));
      await user.click(projectButton());
      expect(screen.getByRole('menu')).toBeVisible();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('menu')).toBeNull();
      expect(p.onCancel).not.toHaveBeenCalled();
      await user.keyboard('{Escape}');
      expect(p.onCancel).toHaveBeenCalledTimes(1);
    } finally { window.removeEventListener('keydown', global); }
  });

  it('no project: the existing text and « Nouveau projet »', async () => {
    const user = userEvent.setup();
    const p = props({ projects: [] });
    render(ui(p));
    expect(screen.getByText('Aucun projet pour l’instant.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Nouveau projet' }));
    expect(p.onNewProject).toHaveBeenCalled();
  });
});
