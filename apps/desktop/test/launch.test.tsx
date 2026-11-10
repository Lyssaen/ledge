import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DaemonClient, MachineState } from '@ledge/fleet';
import type { ClientMessage, ServerMessage } from '@ledge/protocol';
import { LaunchComposer } from '../src/launch/LaunchComposer';
import { forgetModels } from '../src/launch/useModels';
import { declarations, closeDaemons, LAUNCH_PROJECTS, pickAgent } from './helpers';
import { machine } from './fleet-helpers';

beforeEach(() => localStorage.clear());
afterEach(async () => { cleanup(); await closeDaemons(); });

const chipOf = (input: HTMLElement) => input.closest('label')!;

describe('New session', () => {
  // Its App-level paths drove the old form (lot 12b: the IDE's New session modal, covered by test/ide/launch-*.test.tsx).
  it('the stylesheet is the mockup’s composer', () => {
    expect(declarations('launch.css', '.tool-tile.selected')).toContain('border-color:var(--sidebar-primary)');
    expect(declarations('launch.css', '.chip.disabled')).toContain('cursor:not-allowed');
    expect(declarations('launch.css', '.ledge-chat-panel')).toBe('');
    expect(declarations('launch.css', '.composer .composer-bot')).toBe('display:contents');   // the bot's aria-hidden wrapper changes no layout
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
    expect(screen.getByRole('group', { name: 'Folders and repositories on Nas' })).toBeVisible();
    expect(sent.filter(m => m.type === 'repos.inspect').at(-1)).toMatchObject({ type: 'repos.inspect', paths: ['/srv/ledge'], machineId: 'nas' });
    view.rerender(<LaunchComposer {...props(client, [local, down(nas)])} />);
    expect(screen.getByRole('radio', { name: 'Local' })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^Nas/ })).toBeDisabled();
    expect(screen.getByRole('group', { name: 'Folders and repositories on Local' })).toBeVisible();
    view.rerender(<LaunchComposer {...props(client, [down(local), down(nas)])} />);
    await pickAgent(user, screen, /Cursor Agent/);
    await user.type(screen.getByRole('textbox', { name: 'Instruction' }), 'Go');
    await user.click(screen.getByRole('button', { name: /Launch/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('No machine online');
    expect(view.container.querySelector('fieldset[aria-invalid="true"]')!.querySelector('legend')).toHaveTextContent('Machine');
  });

  it('a machine coming back is asked again once the fleet takes it: its branches show and its repositories are chosen again', async () => {
    // Like the fleet: an inspection of a machine it does not take yet (not ready) is answered « not found » at once, without asking it.
    const sent: ClientMessage[] = [];
    const fns = new Set<(m: ServerMessage) => void>();
    let machines: MachineState[] = [local, down(nas)];
    const emit = (m: ServerMessage) => fns.forEach(fn => fn(m));
    const client = {
      send: (m: ClientMessage) => {
        sent.push(m);
        if (m.type === 'repos.inspect' && !machines.find(x => x.id === (m.machineId ?? 'local'))?.ready) emit({ type: 'repos.info', requestId: m.requestId, repos: m.paths.map(path => ({ path, exists: false, branch: null })) });
      },
      onMessage: (fn: (m: ServerMessage) => void) => { fns.add(fn); return () => { fns.delete(fn); }; }
    } as unknown as DaemonClient;
    const asks = () => sent.filter((m): m is Extract<ClientMessage, { type: 'repos.inspect' }> => m.type === 'repos.inspect');
    const answer = async (requestId: string) => act(async () => { emit({ type: 'repos.info', requestId, repos: [{ path: '/w/ledge/app', exists: true, branch: 'desktop' }, { path: '/w/ledge/docs', exists: true, branch: 'main' }] }); });
    const show = (next: MachineState[]) => { machines = next; view.rerender(<LaunchComposer {...props(client, next)} />); };
    const view = render(<LaunchComposer {...props(client, machines)} />);
    expect(asks()).toHaveLength(1);
    await answer(asks()[0]!.requestId);
    expect(screen.getByRole('checkbox', { name: /^app/ })).toBeChecked();
    expect(screen.getByText('⎇ desktop')).toBeVisible();

    show([down(local), down(nas)]);                                         // the chosen machine drops, none other online
    show([{ ...local, ready: false }, down(nas)]);                          // reconnected, its snapshot not there yet
    expect(screen.getByRole('radio', { name: /^Local/ })).toBeDisabled();
    expect(asks()).toHaveLength(1);
    show([local, down(nas)]);                                               // the fleet takes it again
    expect(asks()).toHaveLength(2);
    expect(asks()[1]).toMatchObject({ paths: ['/w/ledge/app', '/w/ledge/docs'], machineId: 'local' });
    await answer(asks()[1]!.requestId);
    expect(screen.getByRole('checkbox', { name: /^app/ })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: /^app/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /^docs/ })).toBeEnabled();
    expect(screen.queryByText('not found')).toBeNull();
    expect(screen.getByText('⎇ desktop')).toBeVisible();
  });

  it('a machine connected but not taken by the fleet yet (no snapshot) is offline: not selectable, not inspected', () => {
    const { client, sent } = fakeClient();
    render(<LaunchComposer {...props(client, [{ ...local, ready: false }, down(nas)])} />);
    expect(screen.getByRole('radio', { name: /^Local/ })).toBeDisabled();
    expect(chipOf(screen.getByRole('radio', { name: /^Local/ }))).toHaveTextContent('offline');
    expect(sent.filter(m => m.type === 'repos.inspect')).toEqual([]);
  });

  it('the inspection sends the repositories\' paths as they are, a newline in one included', () => {
    const { client, sent } = fakeClient();
    const odd = { ...LAUNCH_PROJECTS.projects[0]!, repos: [{ machine: 'local', path: '/w/odd\nname' }, { machine: 'local', path: '/w/ledge/app' }] };
    render(<LaunchComposer {...props(client, [local, down(nas)])} projects={[odd]} />);
    expect(sent.filter(m => m.type === 'repos.inspect')).toEqual([expect.objectContaining({ paths: ['/w/odd\nname', '/w/ledge/app'], machineId: 'local' })]);
  });

  it('an inspection answers only its own request', async () => {
    const { client, sent, emit } = fakeClient();
    render(<LaunchComposer {...props(client, [local, nas])} />);
    const ask = sent.find(m => m.type === 'repos.inspect') as Extract<ClientMessage, { type: 'repos.inspect' }>;
    expect(ask).toMatchObject({ paths: ['/w/ledge/app', '/w/ledge/docs'], machineId: 'local' });
    // Another request's answer (it says docs is missing) is ignored, before and after this one's.
    const stale: ServerMessage = { type: 'repos.info', requestId: 'someone-else', repos: [{ path: '/w/ledge/app', exists: true, branch: 'x' }, { path: '/w/ledge/docs', exists: false, branch: null }] };
    await act(async () => { emit(stale); });
    expect(screen.getByRole('checkbox', { name: /^docs/ })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: /^app/ }).closest('label')).not.toHaveAttribute('title');
    await act(async () => { emit({ type: 'repos.info', requestId: ask.requestId, repos: [{ path: '/w/ledge/app', exists: false, branch: null }, { path: '/w/ledge/docs', exists: true, branch: 'main' }] }); });
    expect(screen.getByRole('checkbox', { name: /^app/ })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /^docs/ })).toBeEnabled();
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /^docs/ })).toBeChecked());
    await act(async () => { emit(stale); });
    expect(screen.getByRole('checkbox', { name: /^docs/ })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: /^docs/ })).toBeChecked();
  });

  it('plain Enter on a tile or a chip sends nothing; only Ctrl / ⌘ Enter and Launch do', async () => {
    const { client } = fakeClient();
    const user = userEvent.setup();
    const p = props(client, [local, nas]);
    render(<LaunchComposer {...p} />);
    await user.type(screen.getByRole('textbox', { name: 'Instruction' }), 'Review{Enter}it');
    expect(screen.getByRole('textbox', { name: 'Instruction' })).toHaveValue('Review\nit');
    await pickAgent(user, screen, /Codex/);
    expect(screen.getByRole('radio', { name: /Codex/ })).toHaveFocus();
    await user.keyboard('{Enter}');
    screen.getByRole('radio', { name: 'Ledge' }).focus();
    await user.keyboard('{Enter}');
    screen.getByRole('radio', { name: /^app/ }).focus();
    await user.keyboard('{Enter}');
    expect(p.onLaunch).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Launch/ }));
    expect(p.onLaunch).toHaveBeenCalledTimes(1);
  });

  it('the bots stay out of the names; they follow Freeze animations', async () => {
    const { client } = fakeClient();
    const user = userEvent.setup();
    const view = render(<LaunchComposer {...props(client, [local, nas])} paused />);
    await user.click(screen.getByRole('button', { name: /Change/ }));
    expect(screen.getByRole('radio', { name: /^Claude Code ?Default Design, review$/ })).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Codex Code and tests' }));
    expect(document.querySelector('.composer-preview')!.textContent).toMatch(/^\w+ will join the Ledge table/);
    const bots = view.container.querySelectorAll('[data-paused]');
    expect(bots).toHaveLength(6);                                          // the agent chosen, four tiles and the preview
    bots.forEach(b => expect(b).toHaveAttribute('data-paused', 'true'));
    view.rerender(<LaunchComposer {...props(client, [local, nas])} />);
    view.container.querySelectorAll('[data-paused]').forEach(b => expect(b).toHaveAttribute('data-paused', 'false'));
  });

  it('with no project, the missing field is the project', async () => {
    const { client } = fakeClient();
    const user = userEvent.setup();
    render(<LaunchComposer {...props(client, [local, nas])} projects={[]} />);
    await pickAgent(user, screen, /Claude Code/);
    await user.type(screen.getByRole('textbox', { name: 'Instruction' }), 'Go');
    await user.click(screen.getByRole('button', { name: /Launch/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('No project yet.');
  });

  it('sends the launch message with the previewed name and table when complete', async () => {
    const { client } = fakeClient();
    const user = userEvent.setup();
    const p = props(client, [local, nas]);
    render(<LaunchComposer {...p} />);
    await pickAgent(user, screen, /Claude Code/);
    await user.click(screen.getByRole('checkbox', { name: /^docs/ }));
    await user.type(screen.getByRole('textbox', { name: 'Instruction' }), ' Review ');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(p.onLaunch).toHaveBeenCalledTimes(1);
    expect(p.onLaunch).toHaveBeenCalledWith({ type: 'session.launch', tool: 'claude', cwd: '/w/ledge/app', dirs: ['/w/ledge/docs'], name: 'Otto', prompt: 'Review', machineId: 'local' }, { name: 'Otto', project: 'Ledge', projectId: 'ledge' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  describe('the model (#58)', () => {
    beforeEach(() => forgetModels());
    const CLAUDE = [{ id: 'fable', label: 'Fable', efforts: ['low', 'high', 'max'] }, { id: 'opus', label: 'Opus', efforts: ['low', 'high', 'max'], isDefault: true }, { id: 'sonnet', label: 'Sonnet', efforts: ['low', 'high', 'max'] }, { id: 'haiku', label: 'Haiku', efforts: ['low', 'high', 'max'] }];
    const asked = (sent: ClientMessage[]) => sent.filter((m): m is Extract<ClientMessage, { type: 'models.list' }> => m.type === 'models.list');
    async function ready(tool: RegExp, models: unknown[], error?: string) {
      const { client, sent, emit } = fakeClient();
      const user = userEvent.setup();
      const p = props(client, [local, nas]);
      render(<LaunchComposer {...p} />);
      await pickAgent(user, screen, tool);
      const ask = asked(sent).at(-1)!;
      expect(ask).toMatchObject({ machineId: 'local' });
      await act(async () => { emit({ type: 'models.listing', requestId: ask.requestId, tool: ask.tool, models, ...(error ? { error } : {}) } as ServerMessage); });
      await user.type(screen.getByRole('textbox', { name: 'Instruction' }), 'Go');
      return { user, p, sent, emit };
    }
    const sentMsg = (p: ReturnType<typeof props>) => p.onLaunch.mock.calls.at(-1)![0];

    const trigger = (agent: string) => screen.getByRole('button', { name: new RegExp(`^${agent} model : `) });
    const menu = () => within(screen.getByRole('dialog', { name: /model$/ }));
    const effortValue = () => within(screen.getByRole('group', { name: 'Effort' })).getByRole('status');

    it('appears under the agents once one is chosen; its default passes nothing, another model and effort are sent and summed up', async () => {
      const { user, p } = await ready(/Claude Code/, CLAUDE);
      const group = within(screen.getByRole('group', { name: 'Claude Code model' }));
      expect(trigger('Claude Code')).toHaveAccessibleName('Claude Code model : Opus');
      expect(group.getByText('default')).toBeVisible();
      expect(effortValue()).toHaveTextContent('—');
      expect(document.querySelector('.preview-model')!.textContent).toBe('Opus');
      await user.click(screen.getByRole('button', { name: /Launch/ }));
      expect(sentMsg(p)).not.toHaveProperty('model'); expect(sentMsg(p)).not.toHaveProperty('effort');
      await user.click(trigger('Claude Code'));
      expect(menu().getAllByRole('option').map(o => o.textContent)).toEqual(['OpusdefaultVery capable, slower', 'FableThe most capable', 'SonnetBalanced, everyday use', 'HaikuFast and economical']);
      expect(menu().getByRole('option', { name: /Opus/ })).toHaveAttribute('aria-selected', 'true');
      await user.click(menu().getByRole('option', { name: /Sonnet/ }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(trigger('Claude Code')).toHaveAccessibleName('Claude Code model : Sonnet');
      await user.click(screen.getByRole('button', { name: 'More effort' }));
      await user.click(screen.getByRole('button', { name: 'More effort' }));
      expect(effortValue()).toHaveTextContent('High');
      expect(screen.getByRole('button', { name: 'More effort' })).toBeEnabled();
      expect(document.querySelector('.preview-model')!.textContent).toBe('Sonnet · high');
      await user.click(screen.getByRole('button', { name: /Launch/ }));
      expect(sentMsg(p)).toMatchObject({ model: 'sonnet', effort: 'high' });
    });

    it('the list is searched; a model the machine does not list is used as is, one that reads as a flag never', async () => {
      const cursor = [{ id: 'auto', label: 'Auto', isDefault: true }, ...Array.from({ length: 8 }, (_, i) => ({ id: `m-${i}`, label: `M ${i}` }))];
      const { user, p } = await ready(/Cursor/, cursor);
      expect(screen.getByText('Effort is in the model name')).toBeVisible();
      expect(screen.queryByRole('group', { name: 'Effort' })).toBeNull();
      await user.click(trigger('Cursor Agent'));
      expect(menu().getAllByRole('option')).toHaveLength(9);
      const search = menu().getByRole('combobox', { name: 'Search a model or type an id' });
      expect(search).toHaveFocus();
      await user.type(search, '-p');
      expect(menu().queryAllByRole('option')).toHaveLength(0);
      expect(menu().getByText('No model matches, and this is not a model id.')).toBeVisible();
      await user.clear(search); await user.type(search, 'm-7{Enter}');
      expect(trigger('Cursor Agent')).toHaveAccessibleName('Cursor Agent model : M 7');
      await user.click(screen.getByRole('button', { name: /Launch/ }));
      expect(sentMsg(p)).toMatchObject({ model: 'm-7' });
      expect(sentMsg(p)).not.toHaveProperty('effort');
      await user.click(trigger('Cursor Agent'));
      await user.type(menu().getByRole('combobox'), 'gpt-9-x');
      await user.click(menu().getByRole('option', { name: /Use as is/ }));
      expect(trigger('Cursor Agent')).toHaveAccessibleName('Cursor Agent model : gpt-9-x');
      await user.click(screen.getByRole('button', { name: /Launch/ }));
      expect(sentMsg(p)).toMatchObject({ model: 'gpt-9-x' });
      await user.click(trigger('Cursor Agent'));
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(trigger('Cursor Agent')).toHaveFocus();
    });

    it('the last pick is kept per project and agent; changing agent takes that agent\'s own', async () => {
      const { user, p, sent, emit } = await ready(/Claude Code/, CLAUDE);
      await user.click(trigger('Claude Code'));
      await user.click(menu().getByRole('option', { name: /Haiku/ }));
      await user.click(screen.getByRole('button', { name: 'More effort' }));
      await user.click(screen.getByRole('button', { name: /Launch/ }));
      cleanup();
      render(<LaunchComposer {...p} />);
      await pickAgent(user, screen, /Codex/);
      const ask = asked(sent).at(-1)!;
      await act(async () => { emit({ type: 'models.listing', requestId: ask.requestId, tool: 'codex', models: [{ id: 'sol', label: 'Sol', isDefault: true }] }); });
      expect(trigger('Codex')).toHaveAccessibleName('Codex model : Sol');
      expect(screen.queryByText('Last choice for this project kept')).toBeNull();
      await pickAgent(user, screen, /Claude Code/);    // known this run: not asked again
      expect(asked(sent).filter(m => m.tool === 'claude')).toHaveLength(1);
      expect(trigger('Claude Code')).toHaveAccessibleName('Claude Code model : Haiku');
      expect(effortValue()).toHaveTextContent('Low');
      expect(screen.getByText('Last choice for this project kept')).toBeVisible();
    });

    it('a machine that cannot list its models still offers the default and Other…; an older daemon offers no model and sends none', async () => {
      const first = await ready(/Codex/, [], 'not installed');
      const group = within(screen.getByRole('group', { name: 'Codex model' }));
      expect(trigger('Codex')).toHaveAccessibleName('Codex model : Default');
      expect(group.getByText(/Model list unavailable \(not installed\)/)).toBeVisible();
      cleanup(); forgetModels();
      const { user, p } = await ready(/Codex/, [], 'outdated');
      expect(screen.queryByRole('group', { name: 'Codex model' })).toBeNull();
      expect(screen.getByText('Update Ledge on this machine to choose the model.')).toBeVisible();
      await user.click(screen.getByRole('button', { name: /Launch/ }));
      expect(sentMsg(p)).not.toHaveProperty('model');
      void first;
    });

    describe('OMP, driven by the daemon (spec 2026-10-20)', () => {
      const OMP = [{ id: 'anthropic/claude-opus-5-5', label: 'Claude Opus 5.5', description: 'anthropic', efforts: ['low', 'high'], isDefault: true }, { id: 'openai-codex/gpt-6.1-sol', label: 'GPT-6.1-Sol', description: 'openai-codex' }];
      it('a fourth tile; the models are the machine\'s, named provider/id in what is sent; several folders go as --add-dir does for Claude', async () => {
        const { user, p } = await ready(/OMP/, OMP);
        expect(trigger('OMP')).toHaveAccessibleName('OMP model : Claude Opus 5.5');
        await user.click(trigger('OMP'));
        await user.click(menu().getByRole('option', { name: /GPT-6.1-Sol/ }));
        await user.click(screen.getByRole('checkbox', { name: /^docs/ }));
        await user.click(screen.getByRole('button', { name: /Launch/ }));
        expect(sentMsg(p)).toMatchObject({ tool: 'omp', model: 'openai-codex/gpt-6.1-sol', dirs: ['/w/ledge/docs'] });
      });
      it('where OMP cannot be reached the launch is blocked with the reason: no other agent is picked for the user', async () => {
        const { user, p } = await ready(/OMP/, [], 'not installed');
        expect(screen.getByRole('alert')).toHaveTextContent('OMP cannot be launched on this machine (not installed)');
        expect(screen.queryByRole('group', { name: 'OMP model' })).toBeNull();
        await user.click(screen.getByRole('button', { name: /Launch/ }));
        expect(p.onLaunch).not.toHaveBeenCalled();
        expect(screen.getByRole('radio', { name: /OMP/ })).toBeChecked();
      });
      it('auto mode: the permissions are chosen for OMP where the daemon takes them, sent only when not « Ask »; an older daemon says it will ask', async () => {
        const { user, p } = await ready(/OMP/, OMP);
        expect(screen.queryByRole('group', { name: 'Permissions' })).toBeNull();
        expect(screen.getByText(/choose OMP’s permissions: it will ask before every write or command/)).toBeVisible();
        await user.click(screen.getByRole('button', { name: /Launch/ }));
        expect(sentMsg(p)).not.toHaveProperty('approval');
        cleanup();
        const { client, emit, sent } = fakeClient();
        const q = props(client, [machine('local', { daemon: { version: '0.14.0', install: 'npm', systemd: true, models: true, omp: true, ompApproval: true } }), nas]);
        render(<LaunchComposer {...q} />);
        await pickAgent(user, screen, /OMP/);
        const ask = asked(sent).at(-1)!;
        await act(async () => { emit({ type: 'models.listing', requestId: ask.requestId, tool: ask.tool, models: OMP } as ServerMessage); });
        const perms = within(screen.getByRole('group', { name: 'Permissions' }));
        expect(perms.getByRole('radio', { name: 'Ask' })).toBeChecked();
        await user.click(perms.getByRole('radio', { name: 'Auto' }));
        expect(perms.getByText('Approves everything, commands included')).toBeVisible();
        await user.type(screen.getByRole('textbox', { name: 'Instruction' }), 'Go');
        await user.click(screen.getByRole('button', { name: /Launch/ }));
        expect(q.onLaunch.mock.calls.at(-1)![0]).toMatchObject({ tool: 'omp', approval: 'yolo' });
        await pickAgent(user, screen, /Claude Code/);
        expect(screen.queryByRole('group', { name: 'Permissions' })).toBeNull();
      });
      it('a daemon that does not know OMP says to update it', async () => {
        await ready(/OMP/, [], 'outdated');
        expect(screen.getByRole('alert')).toHaveTextContent('OMP cannot be launched here: update Ledge on this machine.');
      });
    });
  });
});
