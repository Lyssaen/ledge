import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MachineState } from '@ledge/fleet';
import { LangProvider } from '../src/i18n/lang';
import { LaunchScreen } from '../src/launch/LaunchScreen';
import { LaunchProgress } from '../src/launch/LaunchProgress';
import { useLaunch } from '../src/launch/useLaunch';
import { START, type Flow } from '../src/launch/flow';
import { LAUNCH_KEY, TOOL_KEY } from '../src/launch/form';
import { fakeFleet, machine, recent, type FakeFleet } from './launch-helpers';

const local = machine('local', { recents: [recent('/w/website', '2026-10-14T10:00:00.000Z'), recent('/w/ledge', '2026-10-15T09:00:00.000Z')] });
const devbox = machine('devbox', { recents: [recent('/home/dev/api', '2026-10-15T08:00:00.000Z')] });
const devboxDown = machine('devbox', { ready: false, status: 'unreachable', recents: devbox.recents });

function Harness({ machines, f, onLaunched = () => {} }: { machines: MachineState[]; f: FakeFleet; onLaunched?: (id: string) => void }) {
  const launch = useLaunch(f, machines, onLaunched);
  if (launch.flow.stage === 'closed') return <button type="button" onClick={launch.open}>open</button>;
  return <LaunchScreen launch={launch} machines={machines} fleet={f} notices={<p>notice</p>} />;
}
async function open(machines: MachineState[] = [local, devbox], f = fakeFleet()) {
  const view = render(<Harness machines={machines} f={f} />);
  await userEvent.click(screen.getByRole('button', { name: 'open' }));
  const rerender = (ms: MachineState[]) => view.rerender(<Harness machines={ms} f={f} />);
  return { f, view, rerender };
}
const stored = () => JSON.parse(localStorage.getItem(LAUNCH_KEY) ?? 'null');
const prompt = () => screen.getByRole('textbox', { name: 'First instruction' });
const folder = () => screen.getByRole('textbox', { name: 'Working folder' });

beforeEach(() => localStorage.clear());

describe('launch form', () => {
  it('follows the mockup: heading, machines, latest project, default agent, focus on the machine', async () => {
    await open([local, devboxDown]);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('New session');
    expect(document.querySelector('header.view-heading.settings-heading [data-launch-back]')).toHaveTextContent('Back to sessions');
    expect(screen.getByText('notice')).toBeInTheDocument();
    const machineSelect = screen.getByRole('combobox', { name: 'Machine' });
    expect(machineSelect).toHaveFocus();
    expect(within(machineSelect).getAllByRole('option').map(o => [o.textContent, (o as HTMLOptionElement).disabled]))
      .toEqual([['Local · WSL', false], ['Devbox · SSH · disconnected', true]]);
    expect(screen.getByText('Devbox · SSH is disconnected. You can start a session on Local · WSL.')).toBeInTheDocument();
    const project = screen.getByRole('combobox', { name: 'Project' });
    expect(within(project).getAllByRole('option').map(o => o.textContent)).toEqual(['ledge', 'website', 'Other folder…']);
    expect(project).toHaveValue('/w/ledge');
    expect(folder()).toHaveValue('/w/ledge');
    expect(screen.getByRole('radio', { name: 'Claude Code' })).toBeChecked();
    expect(document.querySelector('.launch-scroll > form#launch-form.launch-form')).not.toBeNull();
    expect(document.querySelector('[data-session]')).toBeNull();
    expect(stored()).toBeNull();   // nothing written before the first edit
  });
  it('opens on the default harness from desktop.tool, and a choice in the form never writes it', async () => {
    localStorage.setItem(TOOL_KEY, JSON.stringify('codex'));
    await open();
    expect(screen.getByRole('radio', { name: 'Codex' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Cursor Agent' }));
    expect(localStorage.getItem(TOOL_KEY)).toBe('"codex"');
    expect(stored()).toMatchObject({ tool: 'cursor' });
  });
  it('validates in the mockup\'s order and names the problem', async () => {
    const { f } = await open();
    await userEvent.click(screen.getByRole('button', { name: 'Start the session' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Write a first instruction.');
    expect(prompt()).toHaveFocus();
    await userEvent.type(prompt(), 'Fix it');
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.clear(folder());
    await userEvent.type(folder(), 'w/relative');
    await userEvent.click(screen.getByRole('button', { name: 'Start the session' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter an absolute folder (/…) or one starting with ~.');
    expect(folder()).toHaveFocus();
    expect(f.sent).toEqual([]);
  });
  it('a machine change takes that machine\'s latest project; the request goes to it, trimmed; the draft follows each edit', async () => {
    const { f } = await open();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Machine' }), 'devbox');
    expect(folder()).toHaveValue('/home/dev/api');
    await userEvent.click(screen.getByRole('radio', { name: 'Codex' }));
    await userEvent.type(prompt(), '  Run the tests  ');
    expect(stored()).toEqual({ machine: 'devbox', cwd: '/home/dev/api', tool: 'codex', prompt: '  Run the tests  ' });
    await userEvent.click(screen.getByRole('button', { name: 'Start the session' }));
    expect(f.sent).toEqual([{ machine: 'devbox', msg: { type: 'session.launch', tool: 'codex', cwd: '/home/dev/api', prompt: 'Run the tests' } }]);
  });
  it('« Other folder… » empties the field and focuses it; a ~ path is accepted', async () => {
    const { f } = await open();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Project' }), 'custom');
    expect(folder()).toHaveValue('');
    expect(folder()).toHaveFocus();
    await userEvent.type(folder(), '~/w/new');
    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveValue('custom');
    await userEvent.type(prompt(), 'Go');
    await userEvent.click(screen.getByRole('button', { name: 'Start the session' }));
    expect(f.sent[0]!.msg).toMatchObject({ cwd: '~/w/new' });
  });
  it('restores the last unlaunched form, and survives a corrupted one', async () => {
    localStorage.setItem(LAUNCH_KEY, JSON.stringify({ machine: 'devbox', cwd: '~/w/api', tool: 'cursor', prompt: 'Keep me' }));
    await open();
    expect(screen.getByRole('combobox', { name: 'Machine' })).toHaveValue('devbox');
    expect(folder()).toHaveValue('~/w/api');
    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveValue('custom');
    expect(prompt()).toHaveValue('Keep me');
    expect(screen.getByRole('radio', { name: 'Cursor Agent' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Back to sessions' }));
    expect(screen.getByRole('button', { name: 'open' })).toBeInTheDocument();
    expect(stored()).toMatchObject({ prompt: 'Keep me' });
  });
  it('shows the default harness changed in Settings when the kept form never chose one (final review M1)', async () => {
    const { view } = await open();
    await userEvent.type(prompt(), 'Keep me');
    expect(screen.getByRole('radio', { name: 'Claude Code' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Back to sessions' }));
    localStorage.setItem(TOOL_KEY, JSON.stringify('codex'));   // Settings › Display › default harness
    view.unmount();
    await open();
    expect(prompt()).toHaveValue('Keep me');
    expect(screen.getByRole('radio', { name: 'Codex' })).toBeChecked();
  });
  it('opens on the defaults when desktop.launch is corrupted', async () => {
    localStorage.setItem(LAUNCH_KEY, '{');
    await open();
    expect(folder()).toHaveValue('/w/ledge');
    expect(prompt()).toHaveValue('');
  });
  it('never sends a folder typed for a machine that fell to another one', async () => {
    localStorage.setItem(LAUNCH_KEY, JSON.stringify({ machine: 'devbox', cwd: '~/w/api', tool: 'codex', prompt: 'Go' }));
    const { f, rerender } = await open();
    rerender([local, devboxDown]);
    expect(screen.getByRole('combobox', { name: 'Machine' })).toHaveValue('local');
    expect(folder()).toHaveValue('/w/ledge');
    await userEvent.click(screen.getByRole('button', { name: 'Start the session' }));
    expect(f.sent).toEqual([{ machine: 'local', msg: { type: 'session.launch', tool: 'codex', cwd: '/w/ledge', prompt: 'Go' } }]);
  });
  it('says when no machine is connected, and refuses to start', async () => {
    const { f } = await open([machine('local', { ready: false, status: 'connecting' })]);
    expect(screen.getByText('No machine is connected. Restore a connection to start a session.')).toBeInTheDocument();
    await userEvent.type(prompt(), 'Go');
    await userEvent.click(screen.getByRole('button', { name: 'Start the session' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a connected machine.');
    expect(f.sent).toEqual([]);
  });
  it('browses the chosen machine\'s folders and takes the one chosen', async () => {
    const { f } = await open();
    await userEvent.click(screen.getByRole('button', { name: 'Browse…' }));
    expect(f.sent.at(-1)).toEqual({ machine: 'local', msg: { type: 'folder.list', path: '/w/ledge' } });
    act(() => f.emit('local', { type: 'folder.listing', path: '/w/ledge', parent: '/w', entries: [] }));
    await userEvent.click(screen.getByRole('button', { name: 'Choose this folder' }));
    expect(screen.queryByRole('region', { name: /Folders on/ })).toBeNull();
    expect(folder()).toHaveValue('/w/ledge');
    expect(folder()).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Browse…' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Machine' }), 'devbox');
    expect(screen.queryByRole('region', { name: /Folders on/ })).toBeNull();
  });
  it('speaks French', async () => {
    render(<LangProvider lang="fr"><Harness machines={[local, devboxDown]} f={fakeFleet()} /></LangProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Nouvelle session');
    expect(screen.getByRole('option', { name: 'Devbox · SSH · déconnectée' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Démarrer la session' })).toBeInTheDocument();
  });
});

describe('starting and failure', () => {
  async function started(f = fakeFleet()) {
    localStorage.setItem(LAUNCH_KEY, JSON.stringify({ machine: 'devbox', cwd: '/home/dev/api', tool: 'codex', prompt: 'Run the tests\nthen report' }));
    const r = await open([local, devbox], f);
    await userEvent.click(screen.getByRole('button', { name: 'Start the session' }));
    return r;
  }
  it('shows the start with its summary, focus on the title, Cancel in the heading', async () => {
    await started();
    const section = screen.getByRole('region', { name: 'Starting the session' });
    expect(within(section).getByRole('heading', { level: 3 })).toHaveTextContent('Starting your agent');
    expect(within(section).getByRole('heading', { level: 3 })).toHaveFocus();
    expect(within(section).getByRole('status')).toHaveTextContent('Preparing the session on Devbox · SSH…');
    expect([...section.querySelectorAll('.launch-summary dd')].map(d => d.textContent)).toEqual(['Devbox · SSH', 'Codex', '/home/dev/api']);
    expect(section.querySelector('blockquote.launch-prompt')).toHaveTextContent('Run the tests then report');
    expect(section.querySelector('[aria-current="step"]')).toHaveTextContent('Starting Codex');
    expect(screen.getByRole('button', { name: 'Cancel launch' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('a daemon error fails with its message; Edit returns to the form with everything kept; Retry sends again', async () => {
    const { f } = await started();
    act(() => f.emit('devbox', { type: 'error', message: 'no such folder: /home/dev/api' }));
    const section = screen.getByRole('region', { name: 'Launch failed' });
    expect(section).toHaveClass('launch-progress', 'launch-failed');
    expect(within(section).getByRole('heading', { level: 3 })).toHaveTextContent('The agent could not start');
    expect(within(section).getByRole('heading', { level: 3 })).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent('The daemon refused: no such folder: /home/dev/api');
    expect(screen.getByText('Your instruction is kept.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to sessions' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(f.sent).toHaveLength(2);
    expect(f.sent[1]).toEqual(f.sent[0]);
    act(() => f.emit('devbox', { type: 'error', message: 'still no' }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit settings' }));
    expect(screen.getByRole('combobox', { name: 'Machine' })).toHaveValue('devbox');
    expect(folder()).toHaveValue('/home/dev/api');
    expect(prompt()).toHaveValue('Run the tests\nthen report');
  });
  it('Cancel closes the screen and keeps the draft', async () => {
    await started();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel launch' }));
    expect(screen.getByRole('button', { name: 'open' })).toBeInTheDocument();
    expect(stored()).toMatchObject({ prompt: 'Run the tests\nthen report' });
  });
});

describe('LaunchProgress messages', () => {
  const request = { machine: 'devbox', tool: 'claude' as const, cwd: '~/w', prompt: 'Go' };
  const failed = (error: Flow['error']): Flow => ({ ...START, stage: 'failed', request, error, attempt: 1 });
  it.each([
    [{ kind: 'offline' } as const, 'Devbox · SSH is not connected: nothing was sent.'],
    [{ kind: 'lost' } as const, 'The connection to Devbox · SSH was lost during the start. The session may have started: check the list before retrying.'],
    [{ kind: 'timeout' } as const, 'The daemon did not answer in time. No new session was confirmed.']
  ])('explains %j', (error, text) => {
    render(<LaunchProgress flow={failed(error)} machines={[local, devbox]} onEdit={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent(text);
  });
  it('names a machine that left the fleet by its id', () => {
    render(<LaunchProgress flow={failed({ kind: 'offline' })} machines={[local]} onEdit={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('devbox is not connected');
  });
});

describe('local-down notice inside the launch screen', () => {
  it('is a status there, an alert by default', async () => {
    const { LocalDownNotice } = await import('../src/shell/OfflineNotice');
    const { unmount } = render(<LocalDownNotice role="status" />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('.local-down')).toHaveAttribute('role', 'status');
    unmount();
    render(<LocalDownNotice />);
    expect(screen.getByRole('alert')).toHaveClass('local-down');
  });
});
