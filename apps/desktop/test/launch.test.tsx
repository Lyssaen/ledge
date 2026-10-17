import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DaemonClient, MachineState } from '@ledge/fleet';
import type { ClientMessage, ServerMessage } from '@ledge/protocol';
import { LaunchComposer } from '../src/launch/LaunchComposer';
import { declarations, boot, closeDaemons, LAUNCH_PROJECTS, LAUNCH_REPOS, listSessions, openLaunch } from './helpers';
import { machine } from './fleet-helpers';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

const preview = () => document.querySelector('.preview-line')!.textContent;
const chipOf = (input: HTMLElement) => input.closest('label')!;

describe('New session', () => {
  it('instruction first with suggestions; no harness by default; the preview names who joins which table', async () => {
    const { user, form } = await openLaunch();
    expect(form.getByRole('textbox', { name: 'Instruction' })).toHaveFocus();
    expect(form.getByRole('textbox', { name: 'Instruction' })).toHaveAttribute('placeholder', 'What should the agent do? Describe the expected result.');
    expect(form.getByRole('button', { name: 'Review the latest pull request' })).toBeVisible();
    await user.click(form.getByRole('button', { name: 'Fix the failing tests' }));
    expect(form.getByRole('textbox', { name: 'Instruction' })).toHaveValue('Fix the failing tests');
    expect(form.getByRole('textbox', { name: 'Instruction' })).toHaveFocus();
    expect(form.queryByRole('button', { name: 'Review the latest pull request' })).toBeNull();
    // Three tiles, none chosen; the project chips carry their colour.
    expect(form.getAllByRole('radio').filter(r => r.getAttribute('name') === 'tool')).toHaveLength(3);
    expect(form.getAllByRole('radio', { checked: true }).map(r => r.getAttribute('name'))).not.toContain('tool');
    expect(chipOf(form.getByRole('radio', { name: 'Ledge' })).querySelector('.side-swatch')).not.toBeNull();
    expect(form.getByRole('radio', { name: 'Ledge' })).toBeChecked();
    expect(document.querySelector('.composer-preview .preview-empty')).not.toBeNull();
    expect(preview()).toBe('A new agent will join the Ledge table');
    await user.click(form.getByRole('radio', { name: /Codex/ }));
    expect(chipOf(form.getByRole('radio', { name: /Codex/ }))).toHaveClass('selected');
    expect(form.getByRole('radio', { name: /Codex/ })).toBeChecked();
    expect(document.querySelector('.composer-preview .preview-empty')).toBeNull();
    expect(preview()).toMatch(/^\w+ will join the Ledge table$/);
    expect(document.querySelector('.composer-preview small')!.textContent).toMatch(/^Seat \d+ · Local · app$/);
    // The rule seats Otto, Bix and Rio at Ledge: the fourth seat.
    expect(document.querySelector('.composer-preview small')!.textContent).toBe('Seat 4 · Local · app');
  });

  it('Launch with a field missing names it; Ctrl Enter launches when complete', async () => {
    const { user, form } = await openLaunch();
    expect(form.queryByRole('alert')).toBeNull();
    await user.click(form.getByRole('button', { name: /Launch/ }));
    expect(form.getByRole('alert')).toHaveTextContent('Choose an agent');
    expect(form.getByRole('group', { name: 'Agent' })).toHaveAttribute('aria-invalid', 'true');
    await user.click(form.getByRole('radio', { name: /Claude Code/ }));
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(form.getByRole('alert')).toHaveTextContent('Write the instruction');
    expect(form.getByRole('textbox', { name: 'Instruction' })).toHaveAttribute('aria-invalid', 'true');
    expect(form.getByRole('group', { name: 'Agent' })).not.toHaveAttribute('aria-invalid', 'true');
    await user.click(form.getByRole('textbox', { name: 'Instruction' }));
    await user.keyboard('Fix it');
    await user.click(form.getByRole('checkbox', { name: /^app/ }));      // no repository left
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(form.getByRole('alert')).toHaveTextContent('Choose at least one repository');
    expect(form.getByRole('group', { name: 'Repositories on Local' })).toHaveAttribute('aria-invalid', 'true');
    expect(form.getByRole('button', { name: 'Cancel' })).toBeVisible();
    expect(form.getByRole('button', { name: /Launch/ })).toHaveTextContent('Ctrl ↵');
  });

  it('Claude takes several repositories, Codex one; the branch shows', async () => {
    const { user, form } = await openLaunch();
    const repos = within(form.getByRole('group', { name: 'Repositories on Local' }));
    await user.click(form.getByRole('radio', { name: /Claude Code/ }));
    expect(repos.getAllByRole('checkbox')).toHaveLength(2);
    await waitFor(() => expect(chipOf(repos.getByRole('checkbox', { name: /^app/ }))).toHaveAttribute('title', 'desktop'));
    expect(chipOf(repos.getByRole('checkbox', { name: /^docs/ }))).toHaveAttribute('title', 'main');
    await user.click(repos.getByRole('checkbox', { name: /^docs/ }));
    expect(repos.getAllByRole('checkbox', { checked: true })).toHaveLength(2);
    expect(document.querySelector('.chip-note')!.textContent).toBe('⎇ desktop');
    expect(repos.queryByText('One repository only for Claude Code')).toBeNull();
    expect(document.querySelector('.composer-preview small')!.textContent).toBe('Seat 4 · Local · app, docs');
    await user.click(form.getByRole('radio', { name: /Codex/ }));
    expect(repos.queryAllByRole('checkbox')).toHaveLength(0);
    expect(repos.getAllByRole('radio', { checked: true }).map(r => r.closest('label')!.textContent)).toEqual(['app']);
    expect(repos.getByText('One repository only for Codex')).toBeVisible();
    await user.click(repos.getByRole('radio', { name: /^docs/ }));
    expect(repos.getByRole('radio', { name: /^app/ })).not.toBeChecked();
    expect(document.querySelector('.chip-note')!.textContent).toBe('⎇ main');
  });

  it('a missing folder cannot be picked, a folder without Git says so, and the first usable repository is chosen', async () => {
    const { user, form, d } = await openLaunch({ repoInfo: new Map([['/w/ledge/app', { path: '/w/ledge/app', exists: false, branch: null }], ['/w/ledge/docs', { path: '/w/ledge/docs', exists: true, branch: null }]]) });
    const repos = within(form.getByRole('group', { name: 'Repositories on Local' }));
    await waitFor(() => expect(repos.getByRole('checkbox', { name: /^app/ })).toBeDisabled());
    expect(chipOf(repos.getByRole('checkbox', { name: /^app/ }))).toHaveTextContent('not found');
    await waitFor(() => expect(repos.getByRole('checkbox', { name: /^docs/ })).toBeChecked());
    expect(repos.getByRole('checkbox', { name: /^app/ })).not.toBeChecked();
    expect(chipOf(repos.getByRole('checkbox', { name: /^docs/ }))).toHaveAttribute('title', 'Folder without Git');
    expect(document.querySelector('.chip-note')).toBeNull();               // no branch known
    await user.click(chipOf(repos.getByRole('checkbox', { name: /^app/ })));
    expect(repos.getByRole('checkbox', { name: /^app/ })).not.toBeChecked();
    // One inspection, for the project's repositories on the chosen machine.
    expect(d.received.filter(m => m.type === 'repos.inspect').map(m => (m as { paths: string[] }).paths)).toEqual([['/w/ledge/app', '/w/ledge/docs']]);
  });

  it('an offline machine is not selectable; the selected one going offline says none is online', async () => {
    const { d, user, form } = await openLaunch();
    const nas = await form.findByRole('radio', { name: /^NAS/ });
    expect(nas).toBeDisabled();
    expect(chipOf(nas)).toHaveTextContent('offline');
    expect(chipOf(nas)).toHaveAttribute('title', 'Offline: reconnect the machine in Settings');
    expect(form.getByRole('radio', { name: 'Local' })).toBeChecked();
    await user.click(form.getByRole('radio', { name: /Claude Code/ }));
    await user.type(form.getByRole('textbox', { name: 'Instruction' }), 'Fix it');
    await d.close();
    await waitFor(() => expect(form.getByRole('radio', { name: /^Local/ })).toBeDisabled());
    expect(chipOf(form.getByRole('radio', { name: /^Local/ }))).toHaveTextContent('offline');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(form.getByRole('alert')).toHaveTextContent('No machine online');
  });

  it('a project with no repository on the machine says so and offers to edit it', async () => {
    const { user, form } = await openLaunch();
    await user.click(form.getByRole('radio', { name: 'Docs' }));
    expect(form.getByText('No repository of Docs on Local.')).toBeVisible();
    expect(preview()).toBe('A new agent will join the Docs table');
    expect(document.querySelector('.composer-preview small')!.textContent).toBe('Seat 1 · Local · no repository');
    await user.click(form.getByRole('button', { name: 'Edit the project' }));
    expect(screen.getByRole('dialog', { name: 'Edit project' })).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'New session' })).toBeNull();
  });

  it('no project at all offers a new one', async () => {
    const { user } = await boot({ sessions: listSessions(), list: true, projects: { projects: [], rules: [] } });
    await user.keyboard('n');
    const form = within(await screen.findByRole('dialog', { name: 'New session' }));
    expect(form.getByText('No project yet.')).toBeVisible();
    expect(form.getByText('Create a project to launch agents in it.')).toBeVisible();
    expect(form.queryByRole('group', { name: 'Project' })).toBeNull();
    await user.click(form.getByRole('button', { name: 'New project' }));
    expect(screen.getByRole('dialog', { name: 'New project' })).toBeVisible();
  });

  it('a filter or a table opens the form on its project; Escape and Cancel close it', async () => {
    const { side, user } = await openLaunch();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'New session' })).toBeNull();
    await user.click(side.getByRole('button', { name: /^Payment/ }));
    await user.keyboard('n');
    const form = within(await screen.findByRole('dialog', { name: 'New session' }));
    expect(form.getByRole('radio', { name: /^Payment/ })).toBeChecked();
    await user.click(form.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'New session' })).toBeNull();
  });

  it('the stylesheet is the mockup’s composer', () => {
    expect(declarations('launch.css', '.tool-tile.selected')).toContain('border-color:var(--sidebar-primary)');
    expect(declarations('launch.css', '.chip.disabled')).toContain('cursor:not-allowed');
    expect(declarations('launch.css', '.ledge-chat-panel')).toBe('');
  });
});

describe('LaunchComposer and its machines', () => {
  /** A client that records its sends and plays daemon messages. */
  function fakeClient() {
    const sent: ClientMessage[] = [];
    const fns = new Set<(m: ServerMessage) => void>();
    const client = { send: (m: ClientMessage) => { sent.push(m); }, onMessage: (fn: (m: ServerMessage) => void) => { fns.add(fn); return () => { fns.delete(fn); }; } } as unknown as DaemonClient;
    return { client, sent, emit: (m: ServerMessage) => fns.forEach(fn => fn(m)) };
  }
  const local = machine('local'), nas = machine('nas');
  const down = (m: MachineState): MachineState => ({ ...m, status: 'unreachable', ready: false });
  const props = (client: DaemonClient, machines: MachineState[]) => ({
    client, projects: LAUNCH_PROJECTS.projects, machines, sessions: [], projectIdOf: () => null, wanted: {},
    onEditProject: vi.fn(), onNewProject: vi.fn(), launch: { status: 'idle' as const }, onLaunch: vi.fn(), onCancel: vi.fn()
  });

  it('the chosen machine going offline moves the choice to one online; none online is said after a try', async () => {
    const { client, sent } = fakeClient();
    const user = userEvent.setup();
    const view = render(<LaunchComposer {...props(client, [local, nas])} />);
    await user.click(screen.getByRole('radio', { name: 'Nas' }));
    expect(screen.getByRole('group', { name: 'Repositories on Nas' })).toBeVisible();
    expect(sent.at(-1)).toMatchObject({ type: 'repos.inspect', paths: ['/srv/ledge'], machineId: 'nas' });
    view.rerender(<LaunchComposer {...props(client, [local, down(nas)])} />);
    expect(screen.getByRole('radio', { name: 'Local' })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^Nas/ })).toBeDisabled();
    expect(screen.getByRole('group', { name: 'Repositories on Local' })).toBeVisible();
    view.rerender(<LaunchComposer {...props(client, [down(local), down(nas)])} />);
    await user.click(screen.getByRole('radio', { name: /Cursor Agent/ }));
    await user.type(screen.getByRole('textbox', { name: 'Instruction' }), 'Go');
    await user.click(screen.getByRole('button', { name: /Launch/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('No machine online');
    expect(view.container.querySelector('fieldset[aria-invalid="true"]')!.querySelector('legend')).toHaveTextContent('Machine');
  });

  it('an inspection answers only its own request', async () => {
    const { client, sent, emit } = fakeClient();
    render(<LaunchComposer {...props(client, [local, nas])} />);
    const ask = sent.find(m => m.type === 'repos.inspect') as Extract<ClientMessage, { type: 'repos.inspect' }>;
    expect(ask).toMatchObject({ paths: ['/w/ledge/app', '/w/ledge/docs'], machineId: 'local' });
    emit({ type: 'repos.info', requestId: 'someone-else', repos: [{ path: '/w/ledge/app', exists: false, branch: null }] });
    await Promise.resolve();
    expect(screen.getByRole('checkbox', { name: /^app/ })).toBeEnabled();
    emit({ type: 'repos.info', requestId: ask.requestId, repos: [{ path: '/w/ledge/app', exists: false, branch: null }, { path: '/w/ledge/docs', exists: true, branch: 'main' }] });
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /^app/ })).toBeDisabled());
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /^docs/ })).toBeChecked());
  });

  it('sends the launch message with the previewed name and table when complete', async () => {
    const { client } = fakeClient();
    const user = userEvent.setup();
    const p = props(client, [local, nas]);
    render(<LaunchComposer {...p} />);
    await user.click(screen.getByRole('radio', { name: /Claude Code/ }));
    await user.click(screen.getByRole('checkbox', { name: /^docs/ }));
    await user.type(screen.getByRole('textbox', { name: 'Instruction' }), ' Review ');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(p.onLaunch).toHaveBeenCalledTimes(1);
    expect(p.onLaunch).toHaveBeenCalledWith({ type: 'session.launch', tool: 'claude', cwd: '/w/ledge/app', dirs: ['/w/ledge/docs'], name: 'Otto', prompt: 'Review', machineId: 'local' }, { name: 'Otto', project: 'Ledge' });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
